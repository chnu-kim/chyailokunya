"use client";

import { BoardOverlay } from "./board-overlay-context";
import { GameDialog } from "./game-dialog";
import { GameFacts } from "./game-fields";

/* 카드 상세 — 격자에서 내려온 부수 정보와 조작이 사는 자리.

   **권한과 무관하게 열린다.** 여기 실리는 날짜는 공개 목록(listGames)이 이미 보낸 값이라
   숨길 것이 없고, 앞면에서 뺀 정보를 권한 뒤에 두면 로그아웃 방문자는 전에 보이던 날짜를
   잃는다. 권한이 가르는 건 조작(수정·삭제)뿐이다.

   수정·삭제는 이 모달을 **닫지 않고 그 위에 띄운다.** 닫고 여는 쪽은 취소했을 때 돌아올 자리가
   없어져 사용자가 카드를 다시 찾아 눌러야 하고, 포커스도 갈 곳을 잃는다(방금 닫힌 모달의
   버튼이 트리거다). 겹쳐 두면 dialog 스택이 그 둘을 브라우저 기본 동작으로 해결한다.

   플레이 날짜는 lastPlayed 를 그대로 읽는다 — 발행 경계를 통과한 값이라 초안 주의 편성은 안
   보인다(ADR-0022). 고치려고 여는 GameEditor 는 다른 값을 쓴다(초안까지 세는 playDates) —
   보는 화면과 고치는 화면의 질문이 다르기 때문이다. */
/* 이 컴포넌트는 board-overlay 머신이 `detail` 상태(또는 그 자식)일 때만 마운트된다
   (game-board.tsx) — 겹침·닫기 신호는 props 로 안 받고 컨텍스트에서 직접 읽고 보고한다
   (ADR-0026). canWrite·canDelete·signedIn 은 머신 상태가 아니라 페이지 인가 정보라 그대로
   prop 으로 받는다. */
export function GameDetail({
  canWrite,
  canDelete,
  signedIn,
}: {
  canWrite: boolean;
  canDelete: boolean;
  // 로그인했는가 — 제안 버튼과 로그인 안내가 이 값으로 갈린다(ADR-0025).
  signedIn: boolean;
}) {
  const actorRef = BoardOverlay.useActorRef();
  const game = BoardOverlay.useSelector((s) => s.context.detailGame);
  /* 부모(머신)가 세우는 닫기 신호. 이 화면에 그럴 일이 하나 있다 — **삭제 성공**. 곧장
     언마운트하는 대신 신호를 세워야 close 이벤트가 오고, 셸이 거기서 히스토리 엔트리를
     되돌린다. 뒤로가기를 포함한 나머지 닫는 길은 셸이 스스로 처리하므로 여기 안 온다. */
  const closing = BoardOverlay.useSelector((s) => s.context.detailClosing);
  // 수정·삭제·제안이 이 위에 겹쳐 떴는가 — 그동안 뒤로가기가 이 화면을 닫으면 안 된다.
  const covered = BoardOverlay.useSelector(
    (s) =>
      s.matches({ detail: "editing" }) ||
      s.matches({ detail: "deleting" }) ||
      s.matches({ detail: "suggesting" }),
  );
  // 렌더 조건(game-board.tsx 의 detailOpen)이 이미 detailGame !== null 을 보장한다.
  if (!game) return null;
  return (
    <GameDialog
      title={game.categoryValue}
      odId="game-detail"
      className="composer--detail"
      closing={closing}
      /* 뒤로가기가 페이지가 아니라 이 모달을 닫는다(이슈 #65). 겹친 모달이 떠 있는 동안은
         유예된다 — 그 판정을 셸이 하도록 covered 로 넘긴다(GameDialog 의 history·covered). */
      history
      covered={covered}
      onClose={() => actorRef.send({ type: "DETAIL_CLOSED" })}
    >
      <div className="detail__head">
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
        {/* 사실 두 줄(마크업·표기 규칙의 근거는 GameFacts 주석). 팬 제안 폼의 "지금 보드에
            있는 값"이 같은 부품을 써서, 제안하는 화면과 보는 화면의 표기가 갈리지 않는다. */}
        <GameFacts
          lastPlayed={game.lastPlayed}
          cleared={game.cleared}
          clearedDate={game.clearedDate}
          idPrefix="detail"
        />
      </div>

      {/* 팬의 자리. 쓰기 권한이 있으면 제안할 이유가 없다(직접 고치면 된다) — 두 버튼을 나란히
          두면 관리자가 매번 "어느 쪽이 내 거지"를 고르게 된다.

          비로그인에게 안내를 두는 건 **여기서만** 취할 조치가 생기기 때문이다: 카드를 열어
          값을 본 사람이라 "이거 틀렸네"가 방금 생겼고, 로그인이 그 다음 걸음이 된다. 보드
          상단엔 같은 말을 안 둔다(거긴 아직 아무것도 안 본 자리다). */}
      {!canWrite &&
        (signedIn ? (
          <div className="detail__acts">
            <button
              className="btn btn--primary composer__btn"
              type="button"
              data-od-id={"game-suggest-" + game.id}
              onClick={() => actorRef.send({ type: "SUGGEST_FROM_DETAIL" })}
            >
              수정 제안
            </button>
          </div>
        ) : (
          <p className="composer__hint" data-od-id="detail-signin-hint">
            치지직으로 로그인하면 고칠 값을 제안할 수 있습니다.
          </p>
        ))}

      {(canWrite || canDelete) && (
        <div className="detail__acts">
          {canWrite && (
            <button
              className="btn btn--primary composer__btn"
              type="button"
              data-od-id={"game-edit-" + game.id}
              onClick={() => actorRef.send({ type: "EDIT_FROM_DETAIL" })}
            >
              수정
            </button>
          )}
          {/* 삭제는 오른쪽 끝으로 민다 — 남는 폭이 그대로 오식 여유가 된다(카드 액션 줄이
              쓰던 어휘 그대로). 되돌릴 수 없는 하드 삭제라 이 거리가 위계의 절반을 지고,
              나머지 절반은 확인 모달이 진다(ADR-0020). */}
          {canDelete && (
            <button
              className="btn btn--secondary composer__btn detail__del"
              type="button"
              data-od-id={"game-del-" + game.id}
              onClick={() => actorRef.send({ type: "DELETE_FROM_DETAIL" })}
            >
              삭제
            </button>
          )}
        </div>
      )}
    </GameDialog>
  );
}
