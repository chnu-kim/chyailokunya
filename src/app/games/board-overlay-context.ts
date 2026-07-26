"use client";

import { createActorContext } from "@xstate/react";
import { createBoardOverlayMachine } from "@/core/board-overlay.machine";
import { REQUEST_TIMEOUT_MS } from "@/core/error-message";
import type { GameCard } from "@/features/games/service";
import type { SuggestionListItem } from "@/features/suggestions/service";
import { trpc } from "@/features/trpc/client";

/* 컴포저를 여는 방식 두 가지. 빈 값(undefined)은 평소의 「게임 추가」이고, 값이 있으면 팬의
   추가 요청을 반영하려고 그 이름·값으로 채워 여는 길이다(ADR-0025). 게임 폼(GameComposer)이
   아니라 여기 두는 이유: board-overlay.machine.ts 의 제네릭 TComposerInitial 자리를 이 파일이
   인스턴스화하는데, 그 타입을 GameComposer 에서 거꾸로 가져오면(React.ComponentProps) 순환
   import(GameComposer → 이 파일 → GameComposer)이 생긴다. */
export type ComposerInitial = {
  query: string;
  playedDate: string;
  cleared: boolean;
  clearedDate: string;
};

/* 보드 오버레이 스택의 화면 공유 액터(ADR-0026, 에픽 #77 이슈 #81) — `GameBoard` 가
   `Provider` 를 세우고, 모달 6종(game-composer·game-detail·game-editor·game-delete-confirm·
   suggest-dialog·suggestion-inbox)은 각자 이 컨텍스트를 import 해 `useSelector`/`useActorRef`
   로 직접 보고한다. `game-dialog.tsx` 의 `dialog-history` 모듈 싱글턴과 같은 모양이다 — 그
   파일도 부모가 콜백을 대신 만들어 내려보내지 않고 각 다이얼로그가 컨트롤러를 직접 부른다. */
export const BoardOverlay = createActorContext(
  createBoardOverlayMachine<GameCard, SuggestionListItem, ComposerInitial>(),
);

/* 「반영이 끝났으니 그 제안을 accepted 로 표시한다」— GameComposer(추가 반영)·GameEditor(수정
   반영) 둘 다 저장 성공 뒤 부르므로 한 곳에 둔다. **게임 쓰기와 별개 요청이다**(ADR-0025 결정
   2) — 묶으면 제안 처리가 games 쓰기 계약 안으로 들어와 승인 전용 경로가 생긴다.

   실패해도 사용자에게 던지지 않는다: 반영 자체는 성공했고(보드가 이미 바뀌었다) 남은 문제는
   제안함에 줄이 남는 것뿐이라, 여기서 오류를 띄우면 방금 성공한 저장이 실패로 읽힌다. 대신
   라이브 영역(머신의 announcement)으로 알려 관리자가 제안함에서 직접 정리할 수 있게 한다.

   **호출자가 GAME_ADDED/GAME_UPDATED 를 먼저 send 한 뒤에 불러야 한다** — 그 전이가
   context.applying 을 지우므로(비우기 전에 캡처해야 한다는 이슈 #81 의 "주의"), target 은
   호출자가 send 하기 **전** 스냅샷에서 미리 읽어 인자로 넘긴다. */
export function useMarkApplied() {
  const actorRef = BoardOverlay.useActorRef();
  return async function markApplied(target: SuggestionListItem | null, dateApplied = true) {
    if (!target) return;
    /* **날짜를 못 실었으면 처리로 표시하지 않는다.** 여러 날 편성이라 폼이 날짜를 잠근 경우가
       그렇다 — 클리어만 저장됐는데 제안이 제안함에서 사라지면 팬의 날짜 제안이 조용히 증발한다
       (리뷰가 잡았다). 제안을 미처리로 남겨 두면 관리자가 /schedule 에서 날짜를 고친 뒤 다시
       반영할 수 있고, 왜 남았는지는 라이브 영역이 말한다. */
    if (!dateApplied) {
      actorRef.send({
        type: "ANNOUNCE",
        message:
          "클리어만 반영했습니다 — 여러 날 편성이라 날짜는 일정에서 고쳐 주십시오. 제안은 그대로 뒀습니다",
      });
      return;
    }
    try {
      /* **resolved 를 읽는다.** 서버는 미처리인 것만 고치므로(CAS), 제안함을 열어 둔 사이 다른
         관리자가 같은 줄을 먼저 처리했으면 false 가 온다. 그때 배지를 또 줄이면 이미 남이 줄인
         수에서 한 번 더 빠져 화면이 어긋나고, 더 나쁘게는 관리자가 **자기가 처리했다고 믿는다.** */
      const { resolved } = await trpc.suggestions.resolve.mutate(
        { id: target.id, resolution: "accepted" },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (resolved) actorRef.send({ type: "SUGGESTION_RESOLVED" });
      else
        actorRef.send({
          type: "ANNOUNCE",
          message: "저장했습니다 — 그 제안은 다른 관리자가 이미 처리했습니다",
        });
    } catch {
      actorRef.send({
        type: "ANNOUNCE",
        message: "반영은 됐지만 제안함 표시를 못 바꿨습니다 — 제안함에서 확인해 주십시오",
      });
    }
  };
}
