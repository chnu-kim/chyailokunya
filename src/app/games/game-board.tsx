"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import { ANGLE, axis, formatDate, PATTERNS, ROT } from "@/core/games";
import type { GameCard } from "@/features/games/service";
import { trpc } from "@/features/trpc/client";
import { GameComposer } from "./game-composer";
import { deleteErrorMessage, REQUEST_TIMEOUT_MS, writeErrorMessage } from "./error-message";
import { ClearedFields, GameDialog, useClearedDraft } from "./game-dialog";

/* 게임 보드. 목록의 정본은 D1 이다 — 서버 컴포넌트(page.tsx)가 읽어 props 로 넘기고, 여기선
   쓰기(추가·날짜 수정·삭제)를 한다. 쓰기는 tRPC 뮤테이션(서버 인가가 정본)을 부르고 로컬
   상태를 낙관적으로 갱신한다. canWrite/canDelete 는 버튼 노출용 편의일 뿐 — 권한 없이 눌러도
   서버가 FORBIDDEN 으로 막는다(불변식 3). localStorage 다중탭 경합은 서버 권위로 사라졌다.

   상태 필터 줄이 있었다. status 컬럼이 사라지며 같이 없앴다 — 걸러 볼 축이 날짜뿐인데
   서버 정렬이 이미 플레이한 날 내림차순이라, 필터는 같은 정보를 두 번째 조작으로 되풀이했다.

   쓰기 권한이 없으면 추가 슬롯 자리에 **아무것도 그리지 않는다.** 잠긴 칸도, 보드 뒤 각주도
   두지 않는다: "방문자는 자기가 못 하는 걸 알아야 한다"는 근거가 언젠가 권한을 가질 사람에게만
   성립하는데, core/authorities.ts 에 member 역할이 없어 일반 팬은 영원히 쓰기를 못 얻는다.
   취할 조치가 없는 안내는 화면 어디에 두든 읽는 사람의 시간만 쓴다. 권한 모델이 바뀌어
   member 가 생기면(이슈 #22) 그때 다시 판단한다 — 그 전까진 보드가 게임만 보여주는 게 맞다.

   삭제는 **확인이 먼저**다(ADR-0020): 클릭은 확인 모달을 열 뿐이고, remove 뮤테이션은 사용자가
   확인을 누른 순간 곧바로 나간다. 한때는 자국(ghost) + 6초 되돌리기 창이었는데, 그 6초 동안
   카드가 "뗀 것도 아직 있는 것도 아닌" 상태로 보드에 남아 세는 집합(총계)과 그리는 집합(빈 상태)
   이 갈렸다. 확인이 파괴 앞에 서면 그 중간 상태 자체가 없어져 둘이 다시 하나가 된다.
   하드 삭제(games 에 deleted_at 없음)는 그대로고, 근거만 "되돌리기가 서버를 안 건드린다"에서
   "파괴 전에 확인을 받는다"로 갈아 끼웠다. */

// --rest-rot/--thumb-a 같은 CSS 커스텀 속성을 인라인 style 로 넘길 때의 타입 우회.
function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

/* 카드의 날짜 한 줄. **플레이한 날만 싣는다** — 이 보드가 답하는 질문이 "무엇을 언제 플레이했나"
   라서, 정렬 기준도 카드에 뜨는 날짜도 같은 하나여야 한다. 그 날짜는 이제 게임 컬럼이 아니라
   일정에서 유도된다(lastPlayed = MAX(scheduled_date), features/games/service). 클리어는 날짜가
   아니라 칩이 맡는다. 유도된 날짜가 없으면(일정 항목이 없는 게임) 호출부가 줄 자체를 안 그린다. */
function dateLabel(g: GameCard): string | null {
  return g.lastPlayed ? formatDate(g.lastPlayed) + " 플레이" : null;
}

export function GameBoard({
  initialGames,
  canWrite,
  canDelete,
}: {
  initialGames: GameCard[];
  canWrite: boolean;
  canDelete: boolean;
}) {
  const [games, setGames] = useState(initialGames);
  const [announcement, setAnnouncement] = useState("");
  const [composing, setComposing] = useState(false);
  // 클리어를 고치는 중인 행. 행 전체를 들고 있는 이유: 모달이 제목·포스터로 "무엇을 고치는지"를
  // 다시 보여줘야 하고, id 만 들면 목록에서 매번 되찾아야 한다.
  const [editing, setEditing] = useState<GameCard | null>(null);
  // 삭제 확인을 받는 중인 행. editing 과 같은 이유로 행 전체를 든다 — 모달이 포스터·제목으로
  // "무엇을 떼는지"를 되짚어 줘야 하고, 되돌릴 수 없는 행동일수록 그 확인이 정확해야 한다.
  const [deleting, setDeleting] = useState<GameCard | null>(null);
  const addSlotRef = useRef<HTMLButtonElement>(null);

  function onAdded(row: GameCard) {
    // 최신 추가가 위로(구 보드의 prepend). 서버 정본과 같은 정렬은 아니지만(날짜순) 다음
    // 새로고침이 맞춰 준다 — 방금 붙인 카드는 눈에 보이는 자리에 있어야 한다.
    setGames((prev) => [row, ...prev]);
    setComposing(false);
    setAnnouncement(row.categoryValue + " 추가됨");
  }

  function onUpdated(row: GameCard) {
    setGames((prev) => prev.map((g) => (g.id === row.id ? row : g)));
    setEditing(null);
    setAnnouncement(row.categoryValue + " 클리어 수정됨");
  }

  /* 삭제가 서버까지 끝난 뒤. 모달이 닫힌 다음에 불린다(GameDeleteConfirm 의 인계 규약). */
  function onRemoved(row: GameCard) {
    setGames((prev) => prev.filter((g) => g.id !== row.id));
    setDeleting(null);
    setAnnouncement(row.categoryValue + " 삭제됨");
    /* 모달을 닫으면 브라우저가 포커스를 트리거로 되돌리는데, 그 트리거는 방금 지운 카드의
       삭제 버튼이라 같은 커밋에서 사라진다 — 그대로 두면 포커스가 body 로 떨어져 키보드
       사용자가 탭 순서 맨 앞으로 튕긴다. 붙이기 슬롯은 카드가 아니라 그리드의 고정 첫 칸이라
       지워지지 않으므로 여기로 넘긴다(삭제 권한이 있으면 쓰기 권한도 있다 — core/authorities). */
    addSlotRef.current?.focus();
  }

  return (
    <>
      {/* HEAD */}
      <section className="head" data-od-id="play-log-head">
        <div className="wrap">
          <div className="head__row">
            <h1 data-od-id="play-log-title">플레이한 게임</h1>
            {/* 총계는 목록 그 자체다 — 지연 커밋 시절엔 "아직 안 지운 자국"을 빼느라 세는
                집합과 그리는 집합이 갈렸지만, 확인이 파괴 앞으로 오면서 games 하나로 합쳐졌다. */}
            <span className="head__count">
              총 <b>{games.length}</b>개
            </span>
          </div>
          {/* 설명 한 줄이 여기 있었다. 제목("플레이한 게임")과 총계가 이미 같은 말을 하고
              있어서, 보드에 닿기 전 한 줄을 더 읽히는 값이 없었다. */}
        </div>
      </section>

      {composing && <GameComposer onAdded={onAdded} onClose={() => setComposing(false)} />}
      {editing && (
        <GameClearEditor game={editing} onUpdated={onUpdated} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <GameDeleteConfirm
          game={deleting}
          onRemoved={onRemoved}
          onClose={() => setDeleting(null)}
        />
      )}

      {/* BOARD */}
      <section className="board" aria-labelledby="board-h2">
        <div className="wrap">
          <h2 className="sr-only" id="board-h2">
            게임 목록
          </h2>

          <div className="games" data-od-id="game-grid">
            {/* 붙이기는 드물고 사적인 행동이라 상시 폭을 먹는 접수창구 대신, 그리드 첫 칸에
                빈 폴라로이드 한 장을 꺼내 붙이는 은유. 쓸 수 있는 사람에게만 그린다 — 못 쓰는
                사람에게 남기던 잠긴 칸은 없앴다. 버튼 노출은 편의일 뿐이고 진짜 방어선은
                서버 인가다(불변식 3). */}
            {canWrite && (
              <button
                className="polaroid addslot"
                type="button"
                ref={addSlotRef}
                data-od-id="composer-open"
                onClick={() => setComposing(true)}
              >
                {/* 집게까지 받아야 게임 카드와 같은 종족으로 읽힌다 — 빈 종이 한 장을 꺼내
                    같은 줄에 집어 둔 것이지, 다른 부품을 첫 칸에 끼운 게 아니다. */}
                <span className="clip" aria-hidden="true" />
                <span className="addslot__slot" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="addslot__label">게임 추가</span>
              </button>
            )}
            {games.map((g) => {
              // 카드 정체성(기울기·패턴·각도)은 안정 id 해시로 고른다 — 정수 PK 를 문자열로.
              const key = String(g.id);
              const rot = ROT[axis(key, "rot", ROT.length)] ?? ROT[0];
              const ang = ANGLE[axis(key, "ang", ANGLE.length)] ?? ANGLE[0];
              const label = dateLabel(g);
              /* 날짜 줄은 플레이한 날만 실으므로 칩이 클리어를 홀로 맡는다 — 플레이한 날을
                 모르는 채 클리어만 아는 게임도 칩으로는 그 사실을 말할 수 있어야 한다. 클리어의
                 정본은 플래그다(cleared_date 유무가 아니다 — "깼는데 날짜 모름"을 살린다). */
              const showCleared = g.cleared;
              return (
                <div
                  key={g.id}
                  className="polaroid game"
                  style={cssVars({ "--rest-rot": rot, "--thumb-a": ang })}
                  data-od-id={"game-card-" + g.id}
                >
                  <span className="clip" aria-hidden="true" />
                  <div
                    className="game__thumb"
                    data-p={axis(key, "pat", PATTERNS)}
                    aria-hidden="true"
                  >
                    {g.posterImageUrl ? (
                      <img
                        className="game__poster"
                        src={g.posterImageUrl}
                        alt=""
                        loading="lazy"
                        width={180}
                        height={240}
                      />
                    ) : (
                      <>
                        <span className="game__initial">{g.categoryValue.charAt(0)}</span>
                        <svg>
                          <use href="#mk-paw" />
                        </svg>
                      </>
                    )}
                  </div>
                  <div className="game__body">
                    <h3 className="game__name">{g.categoryValue}</h3>
                    {/* 칩이 날짜 **앞**이다. 이 줄은 세로로 쌓이고 날짜가 늘 마지막 줄이어야
                        카드 간 기준선이 맞는데(games.css), 그 순서를 CSS 역전이 아니라 DOM 으로
                        만든다 — 역전은 보이는 순서와 읽는 순서를 갈라 놓는다. */}
                    {(label || showCleared) && (
                      <p className="game__when" data-od-id={"game-when-" + g.id}>
                        {showCleared && <span className="chip chip--ok">클리어</span>}
                        {label && <span className="game__date">{label}</span>}
                      </p>
                    )}
                  </div>
                  {/* 수정·삭제는 사진 **밑** 크림 여백에 in-flow 로 선다. 한때 썸네일 우상단에
                      겹쳤고 그건 사용자가 지목한 배치였는데, 사용자 승인을 받아 내렸다.

                      **뒤집은 근거는 미감이 아니라 파생 비용이다.** 임의의 게임 표지 위에
                      얹는다는 전제 하나가 대비 난제를 만들고, 그걸 풀려고 면+2px 잉크 테두리+
                      그림자 세 겹으로 갔고, 거기서 다시 opacity 숨김·pointer-events 짝·
                      focus-within 자기참조·집게 좌표 다툼·폭별 재측정이 파생됐다. 배치를
                      내리면 배경이 카드 종이 둘로 확정돼 그 전부가 존재 이유째 사라진다
                      (계산은 games.css 의 액션 블록 주석에).

                      **상시 보인다.** hover 로만 띄우던 앞 판은 발견 가능성을 대가로 냈는데,
                      NN/g 가 그 형태를 명시적으로 반대한다("가벼워 보이려고 hover 뒤에 숨기지
                      마라"). 쉼 상태를 --fg-muted 로 낮춰 사진·이름·날짜 뒤에 세우는 것으로
                      무게를 대신 뺀다 — 숨기는 대신 물러선다.

                      DOM 순서 = 시각 순서 = 탭 순서다(제목 → 날짜 → 액션). 라벨은 sr-only 로
                      두고 그 안에 동사를 넣는다: 아이콘만 남으면 접근 이름이 게임명뿐인
                      정체불명 버튼 둘이 된다. 서버가 인가를 다시 검사하므로 이 분기는 편의일
                      뿐이다(불변식 3). */}
                  {(canWrite || canDelete) && (
                    <div className="game__acts">
                      {canWrite && (
                        <button
                          className="game__act game__edit"
                          type="button"
                          data-od-id={"game-edit-" + g.id}
                          onClick={() => setEditing(g)}
                        >
                          <span className="sr-only">{g.categoryValue} 클리어 수정</span>
                        </button>
                      )}
                      {canDelete && (
                        <button
                          className="game__act game__del"
                          type="button"
                          data-od-id={"game-del-" + g.id}
                          onClick={() => setDeleting(g)}
                        >
                          <span className="sr-only">{g.categoryValue} 삭제</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {games.length === 0 && (
            <div className="grid-empty" data-od-id="game-grid-empty">
              <span className="t-hand">텅 비었네냥…</span>
              <span>아직 등록된 게임이 없어요.</span>
            </div>
          )}

          <p className="sr-only" role="status">
            {announcement}
          </p>
        </div>
      </section>
    </>
  );
}

/* 삭제 확인 모달(ADR-0020). 되돌릴 수 없는 행동이라 확인을 **파괴 앞**에 세운다 — 눌러 놓고
   무르는 창을 주는 대신, 누르기 전에 무엇이 사라지는지 보여준다. 포스터·제목을 싣는 건 날짜
   수정 모달과 같은 이유고 여기선 더 무겁다: 아이콘 두 개짜리 오버레이는 옆 카드의 버튼을
   잘못 누르기 쉽고, 그 오식을 잡을 마지막 지점이 이 화면이다.

   인계 규약은 컴포저·날짜 수정과 같다 — 성공은 신호(closing)만 세우고 실제 인계는 브라우저가
   dialog 를 닫은 뒤 오는 onClose 에서 한다(GameDialog 의 busy 주석). 실패 문구는 모달 안에
   남긴다: 바깥은 inert 라 페이지 하단 라이브 영역이 안 읽힌다. */
function GameDeleteConfirm({
  game,
  onRemoved,
  onClose,
}: {
  game: GameCard;
  onRemoved: (row: GameCard) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [removing, startRemove] = useTransition();

  function onConfirm() {
    startRemove(async () => {
      setError("");
      try {
        // 상한이 없으면 removing 이 안 풀려 닫기 잠금에 갇힌다(REQUEST_TIMEOUT_MS 주석).
        await trpc.games.remove.mutate(
          { id: game.id },
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        setRemoved(true);
        setClosing(true);
      } catch (e) {
        // 삭제판 문구다 — writeErrorMessage 는 "저장됐을 수도" 처럼 저장 어휘라 여기선 거짓말이 된다.
        setError(deleteErrorMessage(e));
      }
    });
  }

  return (
    <GameDialog
      /* 이 화면만 **합쇼체**다. 보드 나머지는 다정한 해요체지만, 되돌릴 수 없는 확인에서
         장난기는 신뢰를 깎는다 — 격식이 "이건 진짜다"를 말한다(AGENTS 톤 규칙의 명시적 예외). */
      title="삭제하시겠습니까?"
      odId="game-delete"
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
      onClose={() => (removed ? onRemoved(game) : onClose())}
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

      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}

      <div className="composer__actions">
        <button
          className="btn btn--secondary composer__btn"
          type="button"
          data-od-id="game-delete-cancel"
          // 삭제가 날아가는 동안은 취소도 막는다 — 닫기와 같은 인계 경쟁이다(GameDialog 주석).
          disabled={removing}
          onClick={() => setClosing(true)}
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

/* 클리어 수정 모달. 고칠 수 있는 건 클리어 상태(플래그 + 선택적 날짜)뿐이라 제목·포스터는
   "무엇을 고치는지" 확인용으로만 싣는다(게임 자체를 바꾸려면 떼고 다시 붙인다 — categoryId 가
   정본 키라 갈아끼우면 중복 방지가 무너진다). 플레이 날짜는 여기서 못 고친다 — 정본이 일정으로
   옮겨갔다(이슈 #56). 서버 updateGameInput 은 부분 패치가 아니라 cleared·clearedDate 를 늘
   함께 받는다. */
function GameClearEditor({
  game,
  onUpdated,
  onClose,
}: {
  game: GameCard;
  onUpdated: (row: GameCard) => void;
  onClose: () => void;
}) {
  const { draft, setDraft } = useClearedDraft({
    cleared: game.cleared,
    clearedDate: game.clearedDate ?? "",
  });
  const [error, setError] = useState("");
  // 닫기 신호와 인계할 행. 컴포저와 같은 이유로 성공 즉시 onUpdated 를 부르지 않는다 —
  // 부모가 같은 커밋에서 언마운트하면 dialog 가 열린 채 빠져 포커스가 body 로 떨어진다.
  const [closing, setClosing] = useState(false);
  const [saved, setSaved] = useState<GameCard | null>(null);
  const [saving, startSave] = useTransition();

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      setError("");
      try {
        // 빈 문자열 → null 전처리의 정본은 서버 updateGameInput(Zod)이다 — 여기서 다시 하지 않는다.
        const row = await trpc.games.update.mutate(
          {
            id: game.id,
            cleared: draft.cleared,
            clearedDate: draft.clearedDate,
          },
          // 상한이 없으면 saving 이 안 풀려 닫기 잠금에 갇힌다(REQUEST_TIMEOUT_MS 주석).
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        setSaved(row);
        setClosing(true);
      } catch (e) {
        setError(writeErrorMessage(e));
      }
    });
  }

  return (
    <GameDialog
      title="클리어 수정"
      odId="clear-editor"
      closing={closing}
      busy={saving}
      // 삭제 확인과 같은 이유로 X 를 끈다 — 본문에 "취소"가 있다(GameDialog 의 closeButton).
      closeButton={false}
      onClose={() => (saved ? onUpdated(saved) : onClose())}
    >
      <form className="composer__detail" onSubmit={onSave}>
        <p className="composer__hint">깼으면 표시해 주세요. 날짜를 모르면 비워 둬도 돼요.</p>

        <div className="composer__chosen" data-od-id="clear-editor-game">
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

        <ClearedFields draft={draft} onChange={setDraft} idPrefix="editor-clear" />

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}

        <div className="composer__actions">
          <button
            className="btn btn--secondary composer__btn"
            type="button"
            data-od-id="clear-editor-cancel"
            // 저장이 날아가는 동안은 취소도 막는다 — 닫기와 같은 인계 경쟁이다(GameDialog 주석).
            disabled={saving}
            onClick={() => setClosing(true)}
          >
            취소
          </button>
          <button
            className="btn btn--primary composer__btn"
            type="submit"
            disabled={saving}
            data-od-id="clear-editor-submit"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </GameDialog>
  );
}
