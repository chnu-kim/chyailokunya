"use client";

import { useState, useTransition } from "react";
import type { GameCard } from "@/features/games/service";
import { trpc } from "@/features/trpc/client";
import { REQUEST_TIMEOUT_MS, suggestErrorMessage } from "./error-message";
import { GameDialog } from "./game-dialog";
import { ClearedFields, GameFacts, useClearedDraft } from "./game-fields";

/* 팬이 보내는 제안 폼(ADR-0025). 한 컴포넌트가 두 종류를 그린다 — 대상 게임이 있으면 수정 제안,
   없으면 추가 요청이다. 나누지 않는 이유는 폼 로직(값 셋·한마디·제출·미저장 가드)이 같아서고,
   갈리는 건 머리 부분(무엇에 대한 제안인가)뿐이다.

   **이 폼은 게임을 안 바꾼다.** 보내도 보드는 그대로고, 관리자가 제안함에서 보고 반영한다.
   그래서 버튼이 「저장」이 아니라 「제안 보내기」이고, 안내도 그 사실을 먼저 말한다 — 누르고 나서
   보드가 안 바뀐 걸 보고 실패로 읽으면 같은 제안을 반복하게 된다.

   값은 **지금 값에서 출발한다**(수정 제안). 빈 폼에서 시작하면 "안 건드린 칸"이 곧 "비워 달라"는
   제안이 돼, 클리어만 알려 주려던 사람이 플레이 날짜를 지우는 제안을 보낸다 — 서버는 스냅샷
   전체를 받으므로(부분 patch 가 아니다) 그 구분이 화면에만 있다.

   추가 요청이 이름만 받는 이유는 치지직 검색을 비관리자에게 안 열기 때문이다(client_credentials
   노출 — features/chzzk/router.ts). 정본 카테고리·표지는 관리자가 반영할 때 컴포저에서 정한다. */
export function SuggestDialog({
  game,
  stacked,
  onSent,
  onClose,
}: {
  // null = 보드에 없는 게임을 올려 달라는 요청.
  game: GameCard | null;
  // 카드 상세 위에 겹쳐 떴는가 — 그렇다면 스크림을 한 겹 더 깔지 않는다.
  stacked: boolean;
  onSent: (message: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  // 수정 제안은 지금 값에서 출발한다(위 주석). 추가 요청엔 출발점이 없어 빈 값이다.
  const [playedDate, setPlayedDate] = useState(game?.lastPlayed ?? "");
  const { draft, setDraft } = useClearedDraft({
    cleared: game?.cleared ?? false,
    clearedDate: game?.clearedDate ?? "",
  });
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  /* 닫기 신호와 "보냈다" 표시. 성공 즉시 onSent 를 부르지 않는 건 컴포저·수정과 같은 규약이다 —
     부모가 같은 커밋에서 언마운트하면 dialog 가 열린 채 DOM 에서 빠져 포커스가 body 로 떨어진다. */
  const [closing, setClosing] = useState(false);
  const [sent, setSent] = useState(false);
  const [sending, startSend] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startSend(async () => {
      setError("");
      try {
        /* 값 셋은 늘 함께 싣는다 — 제안은 목표 상태 스냅샷이라 "안 보냄"과 "지움"을 가를 필요가
           없다(core/suggestions 주석). 빈 문자열 → null 전처리의 정본은 서버 Zod 다. */
        const values = { cleared: draft.cleared, clearedDate: draft.clearedDate, playedDate, note };
        await trpc.suggestions.create.mutate(
          game ? { kind: "edit", gameId: game.id, ...values } : { kind: "add", title, ...values },
          // 상한이 없으면 sending 이 안 풀려 닫기 잠금에 갇힌다(REQUEST_TIMEOUT_MS 주석).
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        setSent(true);
      } catch (e) {
        setError(suggestErrorMessage(e));
      }
    });
  }

  /* 저장 안 한 입력이 있는가 — 배경 클릭·Esc 로 닫을 때 되묻는 기준이다(GameDialog 의 dirty).
     출발점이 종류마다 달라서 비교 대상도 갈린다: 수정 제안은 **지금 값과의 차이**, 추가 요청은
     이름을 한 자라도 쳤는지다. */
  const dirty = sent
    ? false
    : game
      ? playedDate !== (game.lastPlayed ?? "") ||
        draft.cleared !== game.cleared ||
        draft.clearedDate !== (game.clearedDate ?? "") ||
        note !== ""
      : title !== "" || playedDate !== "" || draft.cleared || note !== "";

  const idPrefix = "suggest";

  return (
    <GameDialog
      title={game ? "수정 제안" : "게임 추가 요청"}
      odId="game-suggest"
      className={stacked ? "composer--stacked" : undefined}
      closing={closing}
      busy={sending}
      dirty={dirty}
      /* **최상위로 뜰 때만 히스토리를 차지한다**(= 보드의 「게임 추가 요청」). 이 폼은 미저장
         입력을 들고 있어 뒤로가기가 페이지를 떠나면 통째로 날아가는데, 그건 GameDialog 주석이
         "잃을 게 없는 상세는 보호받고 정작 입력을 든 컴포저는 안 받는 비대칭"이라 부른 그
         자리다 — 컴포저와 같은 대접을 해야 한다(리뷰가 잡았다).

         상세 위에 겹쳐 뜬 경우(stacked)는 안 켠다: 겹친 모달까지 각자 엔트리를 얹으면 뒤로가기
         한 번이 몇 겹 중 어디를 닫는지 화면만 봐선 알 수 없어진다(수정·삭제와 같은 규약). 그동안
         아래 상세는 covered 로 잠기므로 뒤로가기가 그쪽을 닫지도 않는다. */
      history={!stacked}
      // 삭제 확인·수정과 같은 이유로 X 를 끈다 — 본문에 「취소」가 있다(GameDialog 의 closeButton).
      closeButton={false}
      onClose={() =>
        sent
          ? onSent(
              game ? game.categoryValue + " 수정 제안을 보냈습니다" : "게임 추가 요청을 보냈습니다",
            )
          : onClose()
      }
    >
      {/* ── 보낸 뒤의 화면 ─────────────────────────────────────────────────────────
          **폼을 곧바로 닫지 않는다.** 제안은 보드를 안 바꾸므로(관리자가 반영해야 바뀐다) 모달이
          사라지는 것 말고는 성공했다는 신호가 하나도 없다 — 저장 폼들은 보드가 바뀌는 것이 곧
          영수증이지만 여기엔 그게 없어서, 같은 규약을 그대로 쓰면 팬이 실패로 읽고 다시 보낸다
          (그리고 게임당 하나 제약에 걸려 "이미 보낸 제안이 있어요"를 만난다).

          라이브 영역(role=status)만으로는 부족하다: 그건 스크린리더가 읽는 자리이고, 모달이 열려
          있는 동안 바깥은 inert 라 애초에 안 읽힌다(GameDialog 주석). 결과는 카드 **안에서**
          말해야 한다. */}
      {sent ? (
        <div className="composer__detail" data-od-id="suggest-sent">
          <p className="suggest__sent">보냈습니다</p>
          <p className="composer__hint">
            {game
              ? "관리자가 확인해 반영하면 보드에 나타납니다. 그때까지는 지금 값 그대로입니다."
              : "관리자가 확인한 뒤 보드에 올립니다."}
          </p>
          <div className="composer__actions">
            <button
              className="btn btn--primary composer__btn"
              type="button"
              data-od-id="suggest-done"
              onClick={() => setClosing(true)}
            >
              닫기
            </button>
          </div>
        </div>
      ) : (
        <form className="composer__detail" onSubmit={onSubmit}>
          {/* 안내는 말을 거는 자리라 다정한 해요체다(값 칸의 표기형 규칙과 다른 자리). 보드가
            곧바로 안 바뀐다는 사실을 **먼저** 말한다 — 그걸 모르면 성공을 실패로 읽는다. */}
          <p className="composer__hint">
            {game
              ? "고쳤으면 하는 값으로 바꿔서 보내 주십시오. 관리자가 확인한 뒤 반영합니다."
              : "보드에 없는 게임을 알려 주십시오. 관리자가 확인한 뒤 올립니다."}
          </p>

          {game ? (
            <>
              <div className="composer__chosen" data-od-id="suggest-game">
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
                <span className="composer__chosenname">{game.categoryValue}</span>
              </div>

              {/* 무엇을 바꾸자는 제안인지 판단하려면 출발점이 보여야 한다. 상세와 **같은 부품**
                이라 표기가 갈리지 않는다(GameFacts). */}
              <div className="suggest__current">
                <h3 className="suggest__subhead">지금 보드에 있는 값</h3>
                <GameFacts
                  lastPlayed={game.lastPlayed}
                  cleared={game.cleared}
                  clearedDate={game.clearedDate}
                  idPrefix="suggest-current"
                />
              </div>
            </>
          ) : (
            <div className="datefield">
              <label className="datefield__label" htmlFor={idPrefix + "-title"}>
                게임 이름
              </label>
              <input
                className="field"
                type="text"
                value={title}
                id={idPrefix + "-title"}
                data-od-id="suggest-title"
                disabled={sending}
                required
                maxLength={200}
                // 치지직에 등록된 한국어 이름이면 관리자가 그대로 찾는다 — 그 사실을 힌트로 준다.
                aria-describedby={idPrefix + "-title-hint"}
                onChange={(e) => setTitle(e.target.value)}
              />
              <p className="datefield__hint" id={idPrefix + "-title-hint"}>
                방송에서 부르던 이름 그대로 적어도 됩니다.
              </p>
            </div>
          )}

          <h3 className="suggest__subhead">{game ? "바꿀 값" : "알고 있는 값"}</h3>

          {/* 게임 폼의 PlayedDateField 를 안 쓴다 — 그쪽 문구는 일정 항목을 직접 고치는 사람의
            어휘다("비우면 일정에서 연결만 풀려요"·"여러 날 편성이라 여기선 못 고쳐요"). 팬은
            일정을 안 건드리므로 그 말이 전부 거짓이 된다. 여러 날 편성 잠금도 여기엔 없다:
            그 판정에 필요한 값(초안 주까지 세는 playDates)은 game:write 를 요구하기 때문이고,
            잠금은 관리자가 반영하려고 폼을 여는 순간 제자리에서 걸린다. */}
          <div className="datefield">
            <label className="datefield__label" htmlFor={idPrefix + "-played"}>
              플레이한 날
            </label>
            <input
              className="field"
              type="date"
              value={playedDate}
              id={idPrefix + "-played"}
              data-od-id="suggest-played"
              disabled={sending}
              onChange={(e) => setPlayedDate(e.target.value)}
            />
          </div>

          <ClearedFields
            draft={draft}
            onChange={setDraft}
            idPrefix="suggest-clear"
            disabled={sending}
          />

          <div className="datefield">
            <label className="datefield__label" htmlFor={idPrefix + "-note"}>
              한마디
            </label>
            {/* 값으로 표현 못 하는 제보의 유일한 길이다(제목 오타·표지가 다른 게임 — 관리자도 폼으로
              못 고치는 스냅샷 필드다). 그래서 값을 안 바꿔도 이 칸만 있으면 제안이 성립한다.
              maxLength 는 서버 상한(500)과 같은 값 — 화면에서 먼저 막아 주면 다 쓰고 나서
              거절당하는 일이 없다. 서버가 정본이라는 사실은 그대로다(불변식 2). */}
            <textarea
              className="field suggest__note"
              value={note}
              id={idPrefix + "-note"}
              data-od-id="suggest-note"
              disabled={sending}
              rows={3}
              maxLength={500}
              aria-describedby={idPrefix + "-note-hint"}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="datefield__hint" id={idPrefix + "-note-hint"}>
              값으로 적기 어려운 것을 적어 주십시오. 표지가 다르거나 이름이 틀린 경우 등입니다.
            </p>
          </div>

          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}

          <div className="composer__actions">
            <button
              className="btn btn--secondary composer__btn"
              type="button"
              data-od-id="suggest-cancel"
              // 보내는 동안은 취소도 막는다 — 닫기와 같은 인계 경쟁이다(GameDialog 주석).
              disabled={sending}
              onClick={() => setClosing(true)}
            >
              취소
            </button>
            <button
              className="btn btn--primary composer__btn"
              type="submit"
              // 추가 요청은 이름이 없으면 보낼 게 없다. 수정 제안은 값·한마디 중 무엇이든 있으면
              // 되는데 그 판정은 서버가 한다(core.isEmptyEditSuggestion) — 여기서 되풀이하면
              // 두 판정이 갈려 "버튼은 눌리는데 서버가 거절"하거나 그 반대가 된다.
              disabled={sending || (!game && title.trim() === "")}
              data-od-id="suggest-submit"
            >
              {sending ? "보내는 중…" : "제안 보내기"}
            </button>
          </div>
        </form>
      )}
    </GameDialog>
  );
}
