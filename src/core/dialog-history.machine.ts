import { assign, emit, setup } from "xstate";

/* 다이얼로그 히스토리 엔트리 수명주기 머신(에픽 #77 이슈 #82) — 옛 `src/app/games/dialog-history.ts`
   의 모듈 스코프 변수 셋(`entryState`·`entryOwner`·`entryToken`)과 그 위 20여 줄의 손으로 짠
   분기를 대체한다. **문서 하나에 히스토리가 하나뿐이라 이 머신도 전역 싱글턴이다** — 컴포넌트
   지역으로 만들면 "엔트리가 있다"와 "지금 자리다"를 가르는 계약이 쪼개진다(옛 파일의 ENTRY_MARK
   주석과 같은 이유).

   **부수효과는 이 파일 밖이다.** `window.history.pushState`·`popstate` 리스너·`ENTRY_MARK` 읽기는
   전부 `src/app/games/dialog-history.actor.ts` 가 한다 — 이 파일은 "무엇을 해야 하는가"를
   `emit` 으로만 내보낸다(`pushEntry`·`goBack`·`askOwner`). 그래야 workerd 단위 테스트가 DOM 없이
   돈다.

   **소유자는 콜백이 아니라 `hasOwner` 불리언이다.** 옛 코드는 `entryOwner: PopHandler | null` 을
   직접 쥐고 불러 그 반환값으로 분기했다. 이 머신은 그 호출 자체(그리고 호출 도중 벌어지는
   재진입 — 아래 `askOwner` 주석)를 actor.ts 로 넘긴다: 소유자 콜백의 **정체**(어느 다이얼로그가
   지금 엔트리를 쥐고 있는가)는 actor.ts 의 모듈 변수가 들고, 이 머신은 "누가 있긴 하다"만
   안다. */

type DialogHistoryContext = {
  hasOwner: boolean;
  /* 우리가 쌓은 엔트리에 박는 표식 값. actor.ts 가 `window.history.pushState` 의 state 에
     `{ [ENTRY_MARK]: token }` 으로 실어, 나중에 "지금 서 있는 엔트리가 우리 것인가"(atOurEntry)
     를 비교한다 — 옛 파일의 ENTRY_MARK 토큰과 같은 자리, 정본만 여기로 옮겼다. */
  token: number;
};

type DialogHistoryEvent =
  /* 다이얼로그가 엔트리를 요청한다(`claimEntry`). `atOurEntry` 는 actor.ts 가 미리 읽어 실어
     보낸다(DOM 읽기라 이 머신이 직접 못 한다) — "지금 서 있는 엔트리가 우리가 마지막으로 쌓은
     그것인가"만 다르면 결과가 갈린다(live 상태의 재청구, 아래 주석). */
  | { type: "CLAIM"; atOurEntry: boolean }
  /* 다이얼로그가 닫히지 **않은 채** 사라졌다(StrictMode 정리 · 모달 안 링크로 이탈).
     되돌리지 않는다 — 소유자만 놓는다(옛 abandonEntry). */
  | { type: "ABANDON" }
  /* 사용자가 직접 닫았다(X·배경·Esc) — 쌓아 둔 엔트리를 되돌린다(옛 releaseEntry). */
  | { type: "RELEASE" }
  /* 브라우저 popstate 가 왔다(actor.ts 의 리스너). */
  | { type: "POP" }
  /* `askOwner` 뒤 actor.ts 가 돌려주는 답 — 소유자가 닫기를 받아들였다/거절했다. */
  | { type: "OWNER_ACCEPTED" }
  | { type: "OWNER_REJECTED" };

type DialogHistoryEmitted =
  /* actor.ts 가 `window.history.pushState({...state, [ENTRY_MARK]: token}, "")` 를 부를 차례다. */
  | { type: "pushEntry"; token: number }
  /* actor.ts 가 `window.history.back()` 을 부를 차례다. */
  | { type: "goBack" }
  /* actor.ts 가 지금 소유자에게 "닫아도 되냐"를 물어 `OWNER_ACCEPTED`/`OWNER_REJECTED` 로
     답할 차례다 — 실제 호출(과 그 도중의 재진입)은 actor.ts 몫이다. */
  | { type: "askOwner" };

export const dialogHistoryMachine = setup({
  types: {} as {
    context: DialogHistoryContext;
    events: DialogHistoryEvent;
    emitted: DialogHistoryEmitted;
  },
}).createMachine({
  id: "dialogHistory",
  // 함수로 준다 — 정적 리터럴을 두면 이 머신에서 만든 액터 여럿이 같은 context 객체를 공유해
  // 한 액터의 assign 이 다른(이미 끝난) 액터의 값까지 바꾼다(실측 — 테스트 간 token 이 샜다).
  context: () => ({ hasOwner: false, token: 0 }),
  initial: "none",
  states: {
    /* 엔트리가 없다 — 열린 다이얼로그가 하나도 없거나, 있던 게 방금 다 닫혔다. */
    none: {
      on: {
        // "none" 에서의 청구는 **항상** 새 엔트리를 쌓는다 — atOurEntry 를 볼 이유가 없다
        // (없던 엔트리와 같을 리 없다).
        CLAIM: {
          target: "live",
          actions: [
            assign({ hasOwner: true, token: ({ context }) => context.token + 1 }),
            // context 는 바로 위 assign 이 이미 반영한 뒤라 여기선 +1 없이 그대로 읽는다
            // (실측: +1 을 또 하면 이중 증가로 토큰이 한 칸씩 어긋난다).
            emit(({ context }) => ({ type: "pushEntry", token: context.token })),
          ],
        },
      },
    },
    /* 엔트리가 쌓여 있고 소유자가 있을 수도 없을 수도 있다(hasOwner). "없다"는 abandon 뒤
       아직 아무도 다시 청구하지 않은 상태 — 옛 파일의 "버려진 엔트리" 한계(1)이 그대로다. */
    live: {
      on: {
        CLAIM: [
          /* 이미 이 엔트리에 서 있다 — dev StrictMode 의 effect 두 번째 셋업이 이 경로다.
             다시 쌓으면 엔트리가 둘이 돼 뒤로가기 한 번이 안 닫힌다(옛 claimEntry 주석). */
          { guard: ({ event }) => event.atOurEntry, actions: assign({ hasOwner: true }) },
          // 버려진 엔트리를 물려받지 않고 새로 쌓는다(ENTRY_MARK 계약 — 적대적 리뷰가 잡은 자리).
          {
            actions: [
              assign({ hasOwner: true, token: ({ context }) => context.token + 1 }),
              // context 는 바로 위 assign 이 이미 반영한 뒤라 여기선 +1 없이 그대로 읽는다
              // (실측: +1 을 또 하면 이중 증가로 토큰이 한 칸씩 어긋난다).
              emit(({ context }) => ({ type: "pushEntry", token: context.token })),
            ],
          },
        ],
        ABANDON: { actions: assign({ hasOwner: false }) },
        RELEASE: {
          target: "popping",
          actions: [assign({ hasOwner: false }), emit({ type: "goBack" })],
        },
        POP: [
          /* 소유자가 없다 — 버려진 엔트리를 지나가는 이동이거나(옛 한계 (1)) 우리 엔트리가
             현재도 아닌 남의 이동이다. 어느 쪽이든 조용히 none 으로 내린다(재청구 없이). */
          { guard: ({ context }) => !context.hasOwner, target: "none" },
          /* 소유자가 있다 — **actor.ts 에게 묻는다.** hasOwner 를 여기서 미리 내려 두는 이유는
             `askOwner` 가 (owner() 호출이 다이얼로그를 닫히면 그 close 이벤트가 곧장
             releaseEntry 를 재진입시킬 수 있어서다 — 그때 이미 hasOwner=false·state=checkingOwner
             (RELEASE 핸들러 없음)면 재진입은 조용히 무시된다. 판정을 부르기 **전에** 내려야
             하는 이유가 옛 dialog-history.ts 의 "판정을 부르기 전에 상태를 내린다" 그대로다. */
          {
            target: "checkingOwner",
            actions: [assign({ hasOwner: false }), emit({ type: "askOwner" })],
          },
        ],
      },
    },
    /* `askOwner` 의 답을 기다리는 자리 — 실제로는 actor.ts 가 동기로 답하므로 한 틱도 안
       머물지만, 이름을 둔 이유는 "여기 갇히면 결함이다"를 테스트가 잡게 하기 위해서다: 응답
       이벤트가 하나도 안 오면(actor.ts 가 답을 안 보내면) 다음 CLAIM 이 여기서 조용히 씹혀
       그 뒤로 모든 모달의 뒤로가기가 죽는다 — 응답을 보장하는 건 actor.ts 의 책임이다(owner()
       가 던져도 try/catch 로 OWNER_ACCEPTED 를 보낸다). */
    checkingOwner: {
      on: {
        OWNER_ACCEPTED: { target: "none" },
        // 거절(busy·covered·dirty) — 엔트리를 다시 쌓고 소유자를 되돌린다(옛 "entryOwner = owner; pushEntry(); entryState = live").
        OWNER_REJECTED: {
          target: "live",
          actions: [
            assign({ hasOwner: true, token: ({ context }) => context.token + 1 }),
            // context 는 바로 위 assign 이 이미 반영한 뒤라 여기선 +1 없이 그대로 읽는다
            // (실측: +1 을 또 하면 이중 증가로 토큰이 한 칸씩 어긋난다).
            emit(({ context }) => ({ type: "pushEntry", token: context.token })),
          ],
        },
      },
    },
    /* 우리가 부른 `history.back()` 이 도착하길 기다린다. 이 사이 새 다이얼로그가 청구할 수
       있다(옛 "popping 중이면 지금 쌓지 않는다") — 그러면 back 이 걷어낸 자리에 도로 한 칸
       쌓아 새 소유자에게 넘긴다(POP 핸들러). */
    popping: {
      on: {
        CLAIM: { actions: assign({ hasOwner: true }) },
        ABANDON: { actions: assign({ hasOwner: false }) },
        POP: [
          {
            guard: ({ context }) => context.hasOwner,
            target: "live",
            actions: [
              assign({ token: ({ context }) => context.token + 1 }),
              // context 는 바로 위 assign 이 이미 반영한 뒤라 여기선 +1 없이 그대로 읽는다
              // (실측: +1 을 또 하면 이중 증가로 토큰이 한 칸씩 어긋난다).
              emit(({ context }) => ({ type: "pushEntry", token: context.token })),
            ],
          },
          { target: "none" },
        ],
      },
    },
  },
});
