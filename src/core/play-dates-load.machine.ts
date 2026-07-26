import { assign, fromPromise, setup } from "xstate";
import { REQUEST_TIMEOUT_MS } from "./error-message";

/* 게임 수정 모달의 일정 날짜 조회 머신(에픽 #77 이슈 #84) — `dates`(null=로딩 중)·`loadedDate`·
   `loadFailed` 셋으로 "불러오는 중"을 흉내내던 game-editor.tsx 의 상태를 대체한다. `loadedDate`
   는 여기 안 둔다 — `dates.length === 1 ? dates[0] : ""` 로 매 렌더 유도되는 순수값이라 context
   에 저장할 이유가 없다(호출자가 `state.context.dates` 로부터 그대로 계산한다).

   **mapError 를 안 받는다.** 이 경로는 실패 원인과 무관하게 고정 문구("일정을 못 불러와서
   저장할 수 없습니다")를 보여주는 게 기존 계약이다 — 날짜를 모르는 채로 저장하면 빈 입력이
   그대로 나가 멀쩡한 일정 항목이 지워지므로, 저장을 막는다는 사실만 중요하고 원인은 안 갈린다
   (submit.machine.ts 의 mapError 주입과 다른 점).

   **재시도 이벤트가 없다.** 실패하면 폼을 닫았다 다시 여는 것 말고 방법이 없고(원본과 동일),
   GameEditor 는 편집 대상 게임이 바뀔 때마다 board-overlay 머신이 매번 새로 마운트하므로
   (board-overlay.machine.ts — editingGame 은 editing/applyingEditSuggestion 에 **진입할 때만**
   채워지고 그 상태 안에서 다른 게임으로 바뀌는 전이가 없다) `run` 이 마운트 시점 gameId 에
   얼어붙어도 안전하다. */

export type PlayDatesLoadInput = {
  /** 실제 조회. signal 은 이 머신이 만들어 준다(REQUEST_TIMEOUT_MS) — 호출자가 만들지 않는다. */
  run: (signal: AbortSignal) => Promise<string[]>;
};

type PlayDatesLoadContext = PlayDatesLoadInput & {
  dates: string[];
};

export const playDatesLoadMachine = setup({
  types: {} as {
    context: PlayDatesLoadContext;
    input: PlayDatesLoadInput;
  },
  actors: {
    run: fromPromise<string[], { run: PlayDatesLoadInput["run"] }>(({ input }) =>
      input.run(AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
    ),
  },
}).createMachine({
  id: "playDatesLoad",
  context: ({ input }) => ({ ...input, dates: [] }),
  initial: "loading",
  states: {
    loading: {
      invoke: {
        src: "run",
        input: ({ context }) => ({ run: context.run }),
        onDone: {
          target: "loaded",
          actions: assign({ dates: ({ event }) => event.output }),
        },
        onError: { target: "failed" },
      },
    },
    loaded: {},
    failed: {},
  },
});
