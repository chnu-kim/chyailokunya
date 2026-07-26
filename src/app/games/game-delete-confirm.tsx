"use client";

import { useMachine } from "@xstate/react";
import { useState } from "react";
import { deleteErrorMessage } from "@/core/error-message";
import { createSubmitMachine } from "@/core/submit.machine";
import { trpc } from "@/features/trpc/client";
import { BoardOverlay } from "./board-overlay-context";
import { GameDialog } from "./game-dialog";

// 값이 없다(대상은 game prop 이 정한다) — TValues 를 undefined 로 둔다.
const removeMachine = createSubmitMachine<undefined, { deleted: boolean }>();

/* 삭제 확인 모달(ADR-0020). 되돌릴 수 없는 행동이라 확인을 **파괴 앞**에 세운다 — 눌러 놓고
   무르는 창을 주는 대신, 누르기 전에 무엇이 사라지는지 보여준다. 포스터·제목을 싣는 건 상세가
   이미 보여준 것을 되짚는 것이지 중복이 아니다: 이 화면의 질문은 "무엇을 보고 있나"가 아니라
   "무엇을 지우려는가"고, 그 둘이 어긋난 채 확정되는 걸 막는 마지막 지점이 여기다.

   인계 규약은 컴포저·수정과 같다 — 성공은 신호(closing)만 세우고 실제 인계는 브라우저가
   dialog 를 닫은 뒤 오는 onClose 에서 한다(GameDialog 의 busy 주석). 실패 문구는 모달 안에
   남긴다: 바깥은 inert 라 페이지 하단 라이브 영역이 안 읽힌다. */
/* 이 컴포넌트는 board-overlay 머신이 `detail.deleting` 상태일 때만 마운트된다(game-board.tsx)
   — 그 상태는 `detail` 없이는 못 뜨므로 stacked 는 사실상 늘 참이지만, 다른 모달과 같은
   방식으로 selector 에서 유도해 특례를 안 만든다. */
export function GameDeleteConfirm() {
  const actorRef = BoardOverlay.useActorRef();
  const game = BoardOverlay.useSelector((s) => s.context.detailGame);
  // 카드 상세 위에 겹쳐 떴는가 — 그렇다면 스크림을 한 겹 더 깔지 않는다.
  const stacked = BoardOverlay.useSelector((s) => s.context.detailGame !== null);
  const [manualClosing, setManualClosing] = useState(false);
  /* run 은 마운트 시점에 얼어붙는다(submit.machine.ts 주석) — game 은 이 모달이 열려 있는 동안
     안 바뀌는 값(모달은 게임마다 다시 마운트된다)이라 클로저로 붙잡아도 안전하다. */
  const [state, send] = useMachine(removeMachine, {
    input: {
      run: (_values, signal) => trpc.games.remove.mutate({ id: game!.id }, { signal }),
      // 삭제판 문구다 — writeErrorMessage 는 "저장됐을 수도" 처럼 저장 어휘라 여기선 거짓말이 된다.
      mapError: deleteErrorMessage,
    },
  });
  const removing = state.matches("submitting");
  const removed = state.matches("done");
  const closing = manualClosing || removed;

  function onConfirm() {
    send({ type: "submit", values: undefined });
  }

  // 위 훅 전부를 부른 뒤에만 놓는다(react-hooks/rules-of-hooks) — 실제로는 부모가
  // detailGame !== null 일 때만 마운트하므로 이 분기는 안 밟힌다.
  if (!game) return null;

  return (
    <GameDialog
      /* 이 화면만 **합쇼체**다. 보드 나머지는 다정한 해요체지만, 되돌릴 수 없는 확인에서
         장난기는 신뢰를 깎는다 — 격식이 "이건 진짜다"를 말한다(AGENTS 톤 규칙의 명시적 예외). */
      title="삭제하시겠습니까?"
      odId="game-delete"
      className={stacked ? "composer--stacked" : undefined}
      closing={closing}
      busy={removing}
      /* 본문에 "취소"가 있으므로 모서리 X 를 끈다 — 같은 일을 하는 손잡이 둘은 사용자를
         멈춰 세운다. 덤으로 첫 포커서블이 "취소"가 되어 파괴가 아닌 쪽에 포커스가 선다. */
      closeButton={false}
      /* 제목만으론 "무엇을 떼는지"도 "되돌릴 수 없다"도 안 읽힌다 — 카드 N 장이 전부 같은
         문장으로 열린다. 게임 이름과 안내 문구를 이어 열리는 순간 함께 낭독시킨다. 감싸는
         상자를 새로 만들지 않고 두 id 를 나열하는 이유: 포스터·이니셜은 장식이라(alt=""·
         aria-hidden) 설명에 실리면 안 되고, 이름 span 과 hint 만 정확히 고르면 DOM·CSS 를
         건드릴 일이 없다. 순서가 곧 낭독 순서다(무엇 → 결과). */
      describedBy="game-delete-name game-delete-hint"
      alert
      onClose={() => {
        if (removed) {
          actorRef.send({
            type: "GAME_REMOVED",
            row: game,
            announcement: game.categoryValue + " 삭제됨",
          });
          return;
        }
        actorRef.send({ type: "CANCEL_DELETE" });
      }}
    >
      <div className="composer__chosen" data-od-id="game-delete-game">
        {game.posterImageUrl ? (
          <img
            className="composer__poster composer__poster--lg"
            src={game.posterImageUrl}
            alt=""
            width={72}
            height={96}
          />
        ) : (
          <span className="composer__noposter composer__poster--lg" aria-hidden="true">
            {game.categoryValue.charAt(0)}
          </span>
        )}
        <span className="composer__chosenname" id="game-delete-name">
          {game.categoryValue}
        </span>
      </div>

      <p className="composer__hint" id="game-delete-hint">
        삭제하면 되돌릴 수 없습니다. 다시 추가하려면 검색부터 다시 하셔야 합니다.
      </p>

      {state.context.error && (
        <p className="err" role="alert">
          {state.context.error}
        </p>
      )}

      <div className="composer__actions">
        <button
          className="btn btn--secondary composer__btn"
          type="button"
          data-od-id="game-delete-cancel"
          // 삭제가 날아가는 동안은 취소도 막는다 — 닫기와 같은 인계 경쟁이다(GameDialog 주석).
          disabled={removing}
          onClick={() => setManualClosing(true)}
        >
          취소
        </button>
        {/* 확정 버튼의 라벨은 은유가 아니라 동사다 — 이 줄에서 결정이 갈리므로 "떼기"보다
            무슨 일이 일어나는지를 그대로 말하는 쪽이 안전하다. 톤은 위 안내 문구가 맡는다. */}
        <button
          className="btn composer__btn composer__btn--danger"
          type="button"
          disabled={removing}
          data-od-id="game-delete-submit"
          onClick={onConfirm}
        >
          {removing ? "삭제 중…" : "삭제"}
        </button>
      </div>
    </GameDialog>
  );
}
