import { assign, sendTo, setup } from "xstate";
import {
  addEntry,
  draftEntryInputs,
  makeDraftEntry,
  newEntryKey,
  removeEntry,
  updateEntry,
  type DraftEntryInput,
  type WeekDraft,
} from "./schedule-editor";
import { createSubmitMachine, type SubmitInput } from "./submit.machine";

/* 주간 편집기 저장 머신(에픽 #77 이슈 #85) — `schedule-editor.tsx` 가 들고 있던
   `draft`·`baseline`·`revision`·`error`·`announcement`·`saving`(useTransition)·`seqRef` 를
   대체한다. **유일하게 낙관적 동시성(CAS)이 걸린 머신이고, `submit` 머신을 자식으로 감싼다**
   (schedule-editor 는 submit 이 필요한 6번째 자리인데, 앞 단계(#80)에서 따로 배선하면
   schedule-editor.tsx 를 두 번 만지므로 여기서 한 번에 한다).

   ── submit 을 어떻게 자식으로 감쌌나 ────────────────────────────────────────────────
   submit.machine 은 idle/submitting/done 세 상태를 오가며 **top-level final 이 없다**(done 도
   재사용을 위해 다시 submit 을 받는다) — 그래서 XState 의 `invoke.onDone`(액터가 종료할 때만
   발화)으로는 이 자식의 성공·실패를 못 듣는다. 대신 `invoke.onSnapshot`(자식이 스냅샷을 낼 때마다
   발화, 액터 종료를 요구하지 않는다)으로 매 전이를 관찰해 "done" 이면 저장 성공, "idle"인데
   error 가 있으면 실패로 판정한다. submit.machine.ts 자체는 한 글자도 안 고친다 — 이미 5곳이
   그 파일을 직접 쓰고 있어(games-composer 등) parent 참조를 넣으면 그 5곳까지 흔드는 결합이
   생긴다. invoke 를 **루트**에 둔 이유: submit 자식은 화면이 사는 동안 죽지 않아야 하는데(여러
   번 저장), 특정 리프 상태 안에 두면 그 상태를 벗어날 때 XState 가 액터를 멈춘다. 루트에 두면
   board-overlay 머신의 루트 `on`(어느 리프에 있든 받는 이벤트)과 같은 자리에서, "어느 리프에
   있든 살아있는 액터"가 된다 — `ready`/`saving` 은 그 자식에게 이벤트를 보내고 결과를 받는
   **판정**일 뿐, 자식의 생명주기와는 무관하다.

   ── 왜 편집 이벤트가 루트 `on` 인가 ──────────────────────────────────────────────────
   원본은 저장 중에도 입력을 잠그지 않는다(버튼만 `disabled`) — 그래서 NOTE_CHANGED 류는 `ready`·
   `saving` 어느 쪽에 있든 받아야 한다. `SAVE` 만 `ready` 안에 둬 저장 중 재제출을 막는다(submit
   머신 자신의 "그 잠금이 유일한 방어선이 되면 안 된다" 원칙과 같다 — 버튼 disabled 가 유일한
   방어선이 아니다).

   ── 저장 중 편집이 끼면 서버 응답이 이긴다 ────────────────────────────────────────────
   저장이 성공하면 draft·baseline 을 **서버가 되돌려준 값으로 통째로 교체**한다(원본 onSave 의
   `setDraft(next); setBaseline(next)` 와 동일) — 저장이 날아간 사이 사용자가 입력을 더 고쳤어도
   그 편집은 서버 응답에 덮인다. 편집을 잠그지 않기로 한 선택의 대가이고, 원본부터 있던 동작이라
   이 리팩토링이 새로 들이는 게 아니다.

   ── revision 은 다음 저장에 그대로 실린다 ────────────────────────────────────────────
   성공 액션이 `revision` 을 서버가 준 새 값으로 갈아 끼운다 — 안 갈면 두 번째 저장이 옛 revision
   을 들고 나가 자기 자신과 충돌한다(D1 CAS, [[d1-no-interactive-transactions-concurrency-boundary]]
   와 같은 결의 CAS). */

/* saveWeek 뮤테이션 입력의 shape 만 미러링한다(core 는 features/schema.ts 의 Zod 타입을 못
   본다 — schedule-editor.ts 의 "core 경계 때문에 shape 만 맞춘다" 와 같은 이유). */
export type SaveWeekValues = {
  weekStartDate: string;
  revision: number | null;
  note: string;
  published: boolean;
  entries: DraftEntryInput[];
};

/* run 의 반환 shape. 실제 tRPC 응답(WeekView, features 타입)을 core 가 못 보므로, 호출자가
   `weekToDraft` 로 변환한 뒤 이 shape 로 넘긴다 — 머신은 WeekView 를 몰라도 된다. */
export type SaveWeekResult = {
  draft: WeekDraft;
  revision: number | null;
};

// 제네릭 인자를 고정해 한 번만 만든다 — schedule-editor 는 하나뿐이라 board-overlay 처럼 화면마다
// 인스턴스화할 이유가 없다(WeekDraft 가 이미 core 소유 타입이라 games 쪽과 달리 제네릭도 필요 없다).
const saveSubmitMachine = createSubmitMachine<SaveWeekValues, SaveWeekResult>();

export type ScheduleSaveInput = SubmitInput<SaveWeekValues, SaveWeekResult> & {
  weekStartDate: string;
  initialDraft: WeekDraft;
  initialRevision: number | null;
};

type ScheduleSaveContext = ScheduleSaveInput & {
  draft: WeekDraft;
  baseline: WeekDraft;
  revision: number | null;
  error: string;
  announcement: string;
  // 새 항목 키의 단조 카운터 — core 는 순수라 이 값 자체가 상태다(원본의 useRef 를 대신한다).
  seq: number;
};

type ScheduleSaveEvent =
  | { type: "NOTE_CHANGED"; note: string }
  | { type: "PUBLISHED_CHANGED"; published: boolean }
  | { type: "ENTRY_ADDED"; date: string }
  | { type: "ENTRY_REMOVED"; key: string }
  | { type: "ENTRY_PATCHED"; key: string; patch: Parameters<typeof updateEntry>[2] }
  | { type: "SAVE" };

// SAVE 가 자식에게 실어 보낼 값. revision 은 **그 순간 context 의 값**이어야 한다 — 성공 뒤
// 갈아 끼워진 새 revision 이 다음 저장에 실리는 게 CAS 의 핵심이다.
function saveValues(context: ScheduleSaveContext): SaveWeekValues {
  return {
    weekStartDate: context.weekStartDate,
    revision: context.revision,
    note: context.draft.note,
    published: context.draft.published,
    entries: draftEntryInputs(context.draft),
  };
}

export const scheduleSaveMachine = setup({
  types: {} as {
    context: ScheduleSaveContext;
    events: ScheduleSaveEvent;
    input: ScheduleSaveInput;
  },
  actors: { submit: saveSubmitMachine },
}).createMachine({
  id: "scheduleSave",
  context: ({ input }) => ({
    ...input,
    draft: input.initialDraft,
    baseline: input.initialDraft,
    revision: input.initialRevision,
    error: "",
    announcement: "",
    seq: 0,
  }),
  // 화면이 사는 동안 죽지 않는 자식 — 파일 상단 "왜 루트인가" 참고.
  invoke: {
    id: "submit",
    src: "submit",
    input: ({ context }) => ({ run: context.run, mapError: context.mapError }),
    onSnapshot: [
      {
        guard: ({ event }) => event.snapshot.matches("done"),
        target: ".ready",
        actions: assign(({ event }) => {
          // matches("done") 이 서라는 건 submit.machine.ts 의 onDone 이 이미 result 를 채웠다는
          // 뜻이다(그 파일의 "done 은 항상 result 를 갖고 진입한다" 계약) — non-null 이 안전하다.
          const result = event.snapshot.context.result!;
          return {
            draft: result.draft,
            baseline: result.draft,
            revision: result.revision,
            error: "",
            /* 요청에 실었던 published 가 아니라 **서버가 되돌려준** 값을 쓴다 — saveWeek 은
               publishedAt 을 정확히 input.published 여부로만 켜고 끄므로(service.saveWeek)
               둘은 항상 같다. 굳이 요청 값을 따로 들고 다니지 않는다(정본 하나). */
            announcement: result.draft.published
              ? "일정을 저장하고 발행했습니다"
              : "일정을 저장했습니다(초안)",
          };
        }),
      },
      {
        // idle 로 돌아왔는데 error 가 있다 = submit.machine 의 onError 갈래(submit.machine.ts
        // 참고) — 처음 invoke 될 때도 idle 스냅샷이 한 번 오지만 그때는 error 가 "" 라 안 걸린다.
        guard: ({ event }) => event.snapshot.matches("idle") && event.snapshot.context.error !== "",
        target: ".ready",
        // announcement 는 안 건드린다 — 원본이 실패 시 error 만 세우고 이전 성공 문구를 그대로
        // 두던 것과 같다(다시 라이브 리전이 읽을 이유가 없다, error 문단이 role="alert" 로 이미 뜬다).
        actions: assign({ error: ({ event }) => event.snapshot.context.error }),
      },
    ],
  },
  /* 편집 이벤트 다섯은 `ready`·`saving` 어느 쪽에 있든 받는다 — 원본이 저장 중에도 입력을 안
     잠그기 때문이다(파일 상단 주석). */
  on: {
    NOTE_CHANGED: {
      actions: assign({ draft: ({ context, event }) => ({ ...context.draft, note: event.note }) }),
    },
    PUBLISHED_CHANGED: {
      actions: assign({
        draft: ({ context, event }) => ({ ...context.draft, published: event.published }),
      }),
    },
    ENTRY_ADDED: {
      actions: assign(({ context, event }) => ({
        draft: addEntry(context.draft, makeDraftEntry(newEntryKey(context.seq), event.date)),
        seq: context.seq + 1,
      })),
    },
    ENTRY_REMOVED: {
      actions: assign({ draft: ({ context, event }) => removeEntry(context.draft, event.key) }),
    },
    ENTRY_PATCHED: {
      actions: assign({
        draft: ({ context, event }) => updateEntry(context.draft, event.key, event.patch),
      }),
    },
  },
  initial: "ready",
  states: {
    ready: {
      on: {
        SAVE: {
          target: "saving",
          /* error 를 먼저 지운다 — 안 지우면 실패 뒤 재시도가 (새 요청이 아직 안 끝났는데도)
             옛 실패 문구를 그대로 보여준다(원본 onSave 의 `setError("")` 와 같다, 적대적 리뷰가
             잡은 자리). */
          actions: [
            assign({ error: "" }),
            sendTo("submit", ({ context }) => ({
              type: "submit",
              values: saveValues(context),
            })),
          ],
        },
      },
    },
    // submit 자식이 "submitting" 인 동안 머문다 — 위 onSnapshot 이 결론(done/실패)에서 .ready 로
    // 돌려보낸다. 이 상태 자체엔 on 이 없다 — SAVE 를 다시 보내도 무시된다(submit.machine.ts 의
    // "submitting 상태에선 submit 이벤트를 무시한다" 와 같은 방어).
    saving: {},
  },
});
