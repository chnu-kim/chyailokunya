import { assign, fromPromise, setup } from "xstate";
import { REQUEST_TIMEOUT_MS } from "./error-message";

/* 제안함 목록 로드 머신(에픽 #77 이슈 #84) — `items`(null=로딩 중) + `error` 로 "불러오는 중"을
   흉내내던 suggestion-inbox.tsx 의 상태를 대체한다. **거절 자체(항목별 제출)는 여기 안 들어온다**
   — 그건 이미 submit.machine.ts(줄마다 독립 액터, 이슈 #80)가 맡고 있다. 이 머신이 대체하는 건
   그 결과를 받아 목록을 갱신하는 쪽뿐이다.

   **화면 대비 타입은 제네릭이다**(submit.machine.ts·board-overlay.machine.ts 와 같은 이유 —
   `core` 는 `features` 에 의존하지 않는다, 불변식 1). `SuggestionListItem` 은 features 레이어에
   살아 호출자(suggestion-inbox.tsx)가 구체 타입으로 인스턴스화한다. `id: number` 만 제약으로
   건다 — itemRemoved 가 항목을 골라내는 유일한 열쇠라서다.

   **resolvedIds 를 이 머신이 소유한다.** 원본(suggestion-inbox.tsx)은 이 집합을 useRef 로 밖에
   뒀는데, 그러면 이 머신은 setState 세 개를 이벤트로 감싼 것에 지나지 않는다 — "낡은 재조회가
   이미 처리된 항목을 되살릴 수 없다"는 불변식 자체가 여기서 사라진다. `itemRemoved` 가 항목을
   빼는 시점에 그 id 를 resolvedIds 에 함께 넣고(원본 onItemRejected 의 "resolvedIds.current.add
   와 filter 가 같은 시점"을 그대로 원자화한다), `itemsReplaced` 는 그 집합으로 직접 걸러 넣는다 —
   호출자는 서버 응답을 그대로 실어 보내면 되고 dedup 규칙을 몰라도 된다.

   **seq(가장 최근에 던진 재조회만 반영) 는 이 머신 밖(호출자)에 그대로 둔다.** resolvedIds 는
   "이미 처리된 항목이 되살아나는" 결함만 막고, seq 는 "resolved 와 무관한 최신 스냅샷이 낡은
   응답에 덮이는" 별개의 드리프트(새로 들어온 제안이 일시적으로 안 보임)를 막는다 — 그 축은
   요청 발신 순서·응답 도착 순서의 어긋남을 다루는 통신 계층의 관심사라 이 머신의 상태가 아니다.
   동시 재조회 두 개가 정상 경로이므로(항목마다 독립 액터가 동시에 wasCapped 로 정착할 수 있다)
   단일 invoke 슬롯으로 이 재조회 자체를 흡수하지도 않는다 — 재조회는 여전히 호출자가 던지고,
   정착된 결과만 itemsReplaced/itemError 로 보고한다. */

export type InboxLoadInput<TItem> = {
  /** 최초 목록 조회. signal 은 이 머신이 만든다(REQUEST_TIMEOUT_MS). */
  run: (signal: AbortSignal) => Promise<TItem[]>;
  /** 최초 조회 실패 → 사용자에게 보일 문구. */
  mapError: (error: unknown) => string;
};

type InboxLoadContext<TItem> = InboxLoadInput<TItem> & {
  items: TItem[];
  error: string;
  resolvedIds: ReadonlySet<number>;
};

type InboxLoadEvent<TItem> =
  // 항목 하나가 처리됐다(거절 성공 — resolved 여부와 무관하게 목록에서는 뺀다, 원본 onItemRejected).
  | { type: "itemRemoved"; id: number }
  // 넘친 큐 재조회 성공 — 서버 응답을 그대로 싣는다. resolvedIds 로 거르는 건 이 머신이 한다.
  | { type: "itemsReplaced"; items: TItem[] }
  // 넘친 큐 재조회 실패 — items 는 그대로 두고 배너만 세운다.
  | { type: "itemError"; message: string };

export function createInboxLoadMachine<TItem extends { id: number }>() {
  return setup({
    types: {} as {
      context: InboxLoadContext<TItem>;
      events: InboxLoadEvent<TItem>;
      input: InboxLoadInput<TItem>;
    },
    actors: {
      run: fromPromise<TItem[], { run: InboxLoadInput<TItem>["run"] }>(({ input }) =>
        input.run(AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
      ),
    },
  }).createMachine({
    id: "inboxLoad",
    context: ({ input }) => ({ ...input, items: [], error: "", resolvedIds: new Set() }),
    initial: "loading",
    states: {
      loading: {
        invoke: {
          src: "run",
          input: ({ context }) => ({ run: context.run }),
          onDone: {
            target: "loaded",
            actions: assign({ items: ({ event }) => event.output }),
          },
          onError: {
            target: "failed",
            actions: assign({ error: ({ context, event }) => context.mapError(event.error) }),
          },
        },
      },
      loaded: {
        on: {
          itemRemoved: {
            actions: assign({
              items: ({ context, event }) => context.items.filter((i) => i.id !== event.id),
              resolvedIds: ({ context, event }) => new Set([...context.resolvedIds, event.id]),
            }),
          },
          itemsReplaced: {
            actions: assign({
              items: ({ context, event }) =>
                event.items.filter((i) => !context.resolvedIds.has(i.id)),
              error: "",
            }),
          },
          itemError: {
            actions: assign({ error: ({ event }) => event.message }),
          },
        },
      },
      // 최초 조회 실패 — 재시도 이벤트가 없다(닫았다 다시 열면 새 액터가 다시 시도한다).
      failed: {},
    },
  });
}
