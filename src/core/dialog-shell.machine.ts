import { setup } from "xstate";

/* 다이얼로그 셸의 닫기 판정 머신(에픽 #77 이슈 #82) — `GameDialog` 가 X 버튼·배경 클릭·Esc·
   히스토리 뒤로가기 **네 군데**에서 각각 손으로 반복하던 "busy 면 막는다 · dirty 면 확인부터
   묻는다 · 아니면 닫는다" 게이트를 하나로 묶는다. 옛 코드는 이 게이트를 `close()`(X·배경)와
   `onCancel`(Esc)과 `onHistoryPop`(뒤로가기) 세 곳에 따로 적어 뒀다 — 판정 자체는 셋이 똑같이
   "busy||covered 면 무시, dirty 면 confirmingDiscard, 아니면 닫는다"인데 그 판정이 코드로는
   세 벌이었다.

   **REQUEST_CLOSE 하나로 네 경로를 받는다.** busy·dirty·covered 는 컴포넌트 프롭이라 렌더마다
   바뀌므로 이 머신의 context 에 안 둔다 — 이벤트 페이로드로 매번 실어 보낸다. X·배경·Esc 는
   그 순간의 프롭을 직접 닫는 자리라 신선하고(원본 close/onCancel 의 `[busy, dirty]` deps 와
   같다), 뒤로가기(`onHistoryPop`)만 조합·의존성 없는 안정된 콜백이라 `useRef` + `useLayoutEffect`
   로 최신값을 따로 들고 있어야 한다 — game-dialog.tsx 의 "latest ref" 가 그 이유대로 남는다
   (ADR-0026 판정 뒤에도 그 ref 자체는 이 머신 밖에서 그대로 산다).

   **Esc 는 다르게 반응한다.** X·배경·뒤로가기는 이 머신이 "닫아도 된다"고 답하면 **우리가 직접**
   `dialogRef.current?.close()` 를 부른다(네이티브 닫기 제스처가 아니므로). Esc 는 브라우저의
   기본 취소가 이미 진행 중이라, 이 머신이 "닫아도 된다"고 답하면 **아무것도 안 해서**(
   `preventDefault()` 를 안 불러서) 그 기본 동작이 이어지게 둔다 — 막아야 할 때만
   `preventDefault()` 를 부른다. 이 비대칭은 머신이 아니라 호출자(game-dialog.tsx)가 쥔다: 머신은
   "closing 인가"만 답하고, 그 답을 어떻게 쓰는지는 이벤트 소스마다 다르다.

   **closing 은 `type: "final"` 이 아니다.** final 로 두면 액터가 그 자리에서 멈추는데, React 는
   `dialogRef.close()` 뒤 실제 언마운트까지 최소 한 번은 이 컴포넌트를 다시 그린다 — 멈춘
   액터에 그 사이 이벤트가 와도(있을 리 없지만) 조용히 씹히는 것과, 그냥 전이가 없는 평범한
   상태로 두는 것은 같은 결과라도 전자가 "액터가 죽었다"는 여분의 의미를 얹는다. */

type DialogShellFlags = {
  /* 서버 쓰기가 날아가는 중인가 — 닫기 셋 다 잠근다(GameDialog 의 busy 프롭과 같다). */
  busy: boolean;
  /* 저장 안 한 입력이 있는가 — 셸의 닫기(X·배경·Esc·뒤로가기)만 확인을 되묻는다. */
  dirty: boolean;
  /* 내 위에 다른 다이얼로그가 떠 있는가 — 뒤로가기만 실제로 도달한다(X·배경은 DOM 이 이미
     막는다, GameDialog 의 covered 프롭 주석). */
  covered: boolean;
};

type DialogShellEvent =
  | ({ type: "REQUEST_CLOSE" } & DialogShellFlags)
  // 미저장 확인에서 「계속 작성」— 입력을 그대로 두고 폼으로 돌아간다.
  | { type: "KEEP" }
  // 미저장 확인에서 「닫기」— 잃는 것을 확정했다.
  | { type: "DISCARD" };

export const dialogShellMachine = setup({
  types: {} as {
    events: DialogShellEvent;
  },
}).createMachine({
  id: "dialogShell",
  initial: "open",
  states: {
    open: {
      on: {
        REQUEST_CLOSE: [
          // busy 나 covered 면 통째로 무시한다 — 상태 변화도, 액션도 없다(그대로 open).
          { guard: ({ event }) => event.busy || event.covered },
          { guard: ({ event }) => event.dirty, target: "confirmingDiscard" },
          { target: "closing" },
        ],
      },
    },
    confirmingDiscard: {
      on: {
        KEEP: { target: "open" },
        DISCARD: { target: "closing" },
      },
    },
    // 닫기로 정착했다 — 호출자가 dialogRef.close() 를 부를 차례다(파일 상단 주석).
    closing: {},
  },
});
