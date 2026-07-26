import { createActor } from "xstate";
import { dialogHistoryMachine } from "@/core/dialog-history.machine";

/* `dialog-history.machine.ts` 의 부수효과 계층(에픽 #77 이슈 #82) — `window.history.*`·
   `popstate` 리스너·`ENTRY_MARK` 읽기가 전부 여기 산다. 머신은 "무엇을 해야 하는가"만
   `emit` 으로 내고, 그 실행은 이 파일이 한다(머신 파일 상단 주석).

   **모듈 스코프 싱글턴이다** — 문서 하나에 히스토리가 하나뿐이라 액터도 하나뿐이어야 한다.
   `createActor`/`.start()` 자체는 DOM 을 안 건드리므로 SSR 에서 이 모듈이 평가돼도 안전하다 —
   실제 `window` 접근은 `claimEntry`(클라이언트 effect 에서만 불린다) 가 처음 불릴 때
   `ensureListening` 을 거쳐야 시작된다. */

const ENTRY_MARK = "__gamesModalEntry";

/* 우리 엔트리에 뒤로가기가 왔을 때 소유자가 내리는 판정. true = 닫았다(엔트리를 소비했다),
   false = 안 닫는다(그러면 머신이 엔트리를 다시 쌓는다). */
export type PopHandler = () => boolean;

const historyActor = createActor(dialogHistoryMachine);
historyActor.start();

/* 지금 엔트리를 쥔 다이얼로그. **정체(어느 콜백인가)는 여기서만** 안다 — 머신은 `hasOwner`
   불리언만 본다(dialog-history.machine.ts 의 "소유자는 콜백이 아니라..." 주석). */
let currentOwner: PopHandler | null = null;
let listening = false;

/* 지금 서 있는 히스토리 엔트리가 우리가 마지막으로 쌓은 그것인가 — DOM 읽기라 머신이 직접
   못 하므로 CLAIM 이벤트에 실어 보낸다. */
function atOurEntry(): boolean {
  const state: unknown = window.history.state;
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[ENTRY_MARK] === historyActor.getSnapshot().context.token
  );
}

function ensureListening() {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", () => historyActor.send({ type: "POP" }));
  /* 이후로 안 뗀다 — state 가 "none" 이면 POP 핸들러가 아예 없어 무해하게 씹힌다(옛 코드의
     stopListening 은 최적화였을 뿐 정확성엔 필요 없었다). 리스너를 뗐다 붙였다 하는 복잡성을
     줄인다. */
}

historyActor.on("pushEntry", ({ token }) => {
  /* App Router 는 자기 라우팅 트리를 history.state 에 들고 다닌다 — 그게 없는 엔트리로
     이동하면(back 뒤의 forward) "옛 pages 라우터가 만든 엔트리"로 보고 location.reload() 를
     때린다. 지금 state 를 복사해 넣어 그 오판을 막는다(Next 가 pushState 를 패치해 내부 state
     를 복사해 주긴 하지만, 먼저 복사해 두면 그 패치에 기대지 않는다). URL 은 안 바꾼다 —
     딥링크를 안 열기로 한 결정이라(이슈 #65) 주소가 바뀌면 새로고침했을 때 거짓말이 된다. */
  window.history.pushState({ ...window.history.state, [ENTRY_MARK]: token }, "");
});

historyActor.on("goBack", () => {
  window.history.back();
});

historyActor.on("askOwner", () => {
  /* 소유자를 부르기 **전에** 이미 놓는다 — owner() 가 다이얼로그를 닫으면 브라우저의 네이티브
     close 이벤트가 동기로 쏘여 releaseEntry 를 재진입시킬 수 있는데(dialog-history.machine.ts
     의 POP 주석), 그때 currentOwner 가 이미 null 이면 그 재진입은 조용히 무시된다. */
  const owner = currentOwner;
  currentOwner = null;
  let accepted: boolean;
  try {
    accepted = owner ? owner() : true;
  } catch {
    /* owner() 가 던지면 닫힌 것으로 친다 — 여기서 답을 안 보내면 머신이 checkingOwner 에
       갇혀 그 뒤로 **모든** 모달의 뒤로가기가 죽는다(사이트 전체 회귀, 화면엔 아무 신호도
       없다). 원래 코드가 도달하던 자리(entryOwner=null, entryState=none, 재푸시 없음)와
       같은 결과다. */
    accepted = true;
  }
  if (owner && !accepted) {
    currentOwner = owner;
    historyActor.send({ type: "OWNER_REJECTED" });
  } else {
    historyActor.send({ type: "OWNER_ACCEPTED" });
  }
});

export function claimEntry(owner: PopHandler) {
  ensureListening();
  currentOwner = owner;
  historyActor.send({ type: "CLAIM", atOurEntry: atOurEntry() });
}

export function abandonEntry(owner: PopHandler) {
  if (currentOwner !== owner) return;
  currentOwner = null;
  historyActor.send({ type: "ABANDON" });
}

export function releaseEntry(owner: PopHandler) {
  if (currentOwner !== owner) return;
  currentOwner = null;
  historyActor.send({ type: "RELEASE" });
}
