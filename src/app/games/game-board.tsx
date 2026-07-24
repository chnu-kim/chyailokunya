"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import {
  ANGLE,
  axis,
  formatDate,
  isPlayDateEditable,
  PATTERNS,
  ROT,
  sortGameCards,
} from "@/core/games";
import type { GameCard } from "@/features/games/service";
import { trpc } from "@/features/trpc/client";
import { GameComposer } from "./game-composer";
import { deleteErrorMessage, REQUEST_TIMEOUT_MS, updateErrorMessage } from "./error-message";
import { ClearedFields, GameDialog, PlayedDateField, useClearedDraft } from "./game-dialog";

/* 게임 보드. 목록의 정본은 D1 이다 — 서버 컴포넌트(page.tsx)가 읽어 props 로 넘기고, 여기선
   쓰기(추가·날짜 수정·삭제)를 한다. 쓰기는 tRPC 뮤테이션(서버 인가가 정본)을 부르고 로컬
   상태를 낙관적으로 갱신한다. canWrite/canDelete 는 버튼 노출용 편의일 뿐 — 권한 없이 눌러도
   서버가 FORBIDDEN 으로 막는다(불변식 3). localStorage 다중탭 경합은 서버 권위로 사라졌다.

   상태 필터 줄이 있었다. status 컬럼이 사라지며 같이 없앴다 — 걸러 볼 축이 날짜뿐인데
   서버 정렬이 이미 플레이한 날 내림차순이라, 필터는 같은 정보를 두 번째 조작으로 되풀이했다.

   ── 격자는 표지·이름·클리어까지만 싣는다 ──────────────────────────────────────
   카드마다 날짜 한 줄과 수정·삭제 버튼 둘이 서 있었다. 8장이면 아이콘만 16개고, 그 대부분은
   **아무도 지금 쓰지 않는다** — 보드를 여는 이유는 "뭘 했나 훑기"지 고치기가 아니다. 부수
   정보와 조작을 카드를 눌러야 나오는 상세로 내리면 격자가 사진과 이름만 말하고, 고치려는
   사람은 고칠 카드 하나를 이미 고른 뒤에 조작을 만난다.

   클리어 칩만 앞면에 남긴다: "이 게임을 깼나"는 훑는 눈이 던지는 질문이라 카드마다 열어 보게
   하면 안 되고, 날짜와 달리 한 글자로 답이 된다. 정확한 날짜는 상세가 답한다.

   쓰기 권한이 없으면 추가 슬롯 자리에 **아무것도 그리지 않는다.** 잠긴 칸도, 보드 뒤 각주도
   두지 않는다: "방문자는 자기가 못 하는 걸 알아야 한다"는 근거가 언젠가 권한을 가질 사람에게만
   성립하는데, core/authorities.ts 에 member 역할이 없어 일반 팬은 영원히 쓰기를 못 얻는다.
   취할 조치가 없는 안내는 화면 어디에 두든 읽는 사람의 시간만 쓴다. 권한 모델이 바뀌어
   member 가 생기면(이슈 #22) 그때 다시 판단한다 — 그 전까진 보드가 게임만 보여주는 게 맞다.
   **상세는 권한과 무관하게 열린다** — 거기 담긴 날짜는 공개 목록이 이미 실어 보낸 값이고,
   앞면에서 뺀 정보를 권한 뒤에 숨기면 로그아웃 방문자는 볼 수 있던 것을 잃는다.

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
  /* 열어 둔 카드. 수정·삭제는 **이 위에 겹쳐** 뜬다(닫고 여는 게 아니다) — 그래야 취소했을 때
     상세로 돌아오고, 포커스 복원을 브라우저의 dialog 스택이 그대로 맡는다. 행 전체를 들고
     있는 이유는 아래 editing 과 같다. */
  const [detail, setDetail] = useState<GameCard | null>(null);
  // 고치는 중인 행(플레이 날짜·클리어). 행 전체를 들고 있는 이유: 모달이 제목·포스터로
  // "무엇을 고치는지"를 다시 보여줘야 하고, id 만 들면 목록에서 매번 되찾아야 한다.
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

  /* 날짜를 고치면 lastPlayed 가 바뀌어 **자리도 달라져야 한다** — 제자리 교체만 하면 새로고침
     전까지 보드가 날짜순이 아닌 채로 남는다. 정렬 규칙은 core 가 쥔다(서버 SQL 의 짝). */
  function onUpdated(row: GameCard) {
    setGames((prev) => sortGameCards(prev.map((g) => (g.id === row.id ? row : g))));
    setEditing(null);
    /* 상세가 아래 열려 있으면 그 화면도 새 값으로 갈아 끼운다 — 안 하면 방금 고친 날짜가
       돌아온 화면에 옛 값으로 떠 "저장이 안 됐다"로 읽힌다. */
    setDetail((prev) => (prev && prev.id === row.id ? row : prev));
    setAnnouncement(row.categoryValue + " 수정됨");
  }

  /* 삭제가 서버까지 끝난 뒤. 모달이 닫힌 다음에 불린다(GameDeleteConfirm 의 인계 규약). */
  function onRemoved(row: GameCard) {
    setGames((prev) => prev.filter((g) => g.id !== row.id));
    setDeleting(null);
    // 상세는 방금 사라진 게임을 보여주고 있었다 — 같이 닫는다.
    setDetail(null);
    setAnnouncement(row.categoryValue + " 삭제됨");
    /* 모달을 닫으면 브라우저가 포커스를 트리거로 되돌리는데, 그 트리거는 방금 지운 카드의
       상세 안에 있어 같은 커밋에서 사라진다 — 그대로 두면 포커스가 body 로 떨어져 키보드
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
      {detail && (
        <GameDetail
          game={detail}
          canWrite={canWrite}
          canDelete={canDelete}
          onEdit={() => setEditing(detail)}
          onDelete={() => setDeleting(detail)}
          onClose={() => setDetail(null)}
        />
      )}
      {/* 상세가 아래 열려 있으면 스크림을 한 겹 더 깔지 않는다(GameDialog 의 className). */}
      {editing && (
        <GameEditor
          game={editing}
          stacked={detail !== null}
          onUpdated={onUpdated}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <GameDeleteConfirm
          game={deleting}
          stacked={detail !== null}
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
              /* 칩이 앞면에 남는 유일한 부수 사실이다. 클리어의 정본은 플래그다
                 (cleared_date 유무가 아니다 — "깼는데 날짜 모름"을 살린다). */
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
                    {/* 카드 전체가 한 번에 눌린다. 그 히트 영역은 **제목 버튼이 ::after 로
                        카드를 덮어서** 만든다 — 카드 자체를 button 으로 만들면 그 안에 h3 이
                        못 들어가(button 의 콘텐츠 모델) 보드가 제목 없는 이미지 더미가 되고,
                        투명 오버레이를 형제로 따로 깔면 접근 이름이 없는 버튼이 하나 더 는다.
                        이 방식은 눌리는 것과 이름이 같은 요소라 스크린리더·키보드에서도 하나다.

                        접근 이름에 "자세히"를 더한다 — 이름만이면 버튼이 무엇을 하는지 안 말한다.
                        시각 라벨(게임명)을 그대로 품으므로 WCAG 2.5.3(Label in Name)은 지켜진다. */}
                    <h3 className="game__name">
                      <button
                        className="game__open"
                        type="button"
                        aria-label={g.categoryValue + " 자세히"}
                        data-od-id={"game-open-" + g.id}
                        onClick={() => setDetail(g)}
                      >
                        {/* 두 줄 말줄임은 이 span 이 진다 — 버튼에 직접 걸면 함께 필요한
                            overflow:hidden 이 카드를 덮는 ::after 까지 잘라 히트 영역이
                            글자 크기로 쪼그라든다(games.css). */}
                        <span className="game__nametext">{g.categoryValue}</span>
                      </button>
                    </h3>
                    {g.cleared && (
                      <p className="game__meta" data-od-id={"game-meta-" + g.id}>
                        <span className="chip chip--ok">클리어</span>
                      </p>
                    )}
                  </div>
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
function GameDetail({
  game,
  canWrite,
  canDelete,
  onEdit,
  onDelete,
  onClose,
}: {
  game: GameCard;
  canWrite: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <GameDialog
      title={game.categoryValue}
      odId="game-detail"
      className="composer--detail"
      closing={false}
      onClose={onClose}
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
        {/* 사실 두 줄은 정의 목록이다 — "이름: 값" 쌍이라는 걸 마크업이 말해야 스크린리더가
            둘을 이어 읽는다(문단 두 개로 두면 라벨과 값의 관계가 사라진다). */}
        <dl className="detail__facts">
          <dt>플레이한 날</dt>
          <dd data-od-id="detail-played">
            {game.lastPlayed ? (
              formatDate(game.lastPlayed)
            ) : (
              <span className="detail__none">아직 없어요</span>
            )}
          </dd>
          <dt>클리어</dt>
          <dd data-od-id="detail-cleared">
            {game.cleared ? (
              game.clearedDate ? (
                formatDate(game.clearedDate)
              ) : (
                // 날짜를 모르는 클리어도 유효한 상태다 — 빈칸으로 두면 안 깬 것처럼 읽힌다.
                <>
                  했어요 <span className="detail__none">(날짜 모름)</span>
                </>
              )
            ) : (
              <span className="detail__none">아직이에요</span>
            )}
          </dd>
        </dl>
      </div>

      {(canWrite || canDelete) && (
        <div className="detail__acts">
          {canWrite && (
            <button
              className="btn btn--primary composer__btn"
              type="button"
              data-od-id={"game-edit-" + game.id}
              onClick={onEdit}
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
              onClick={onDelete}
            >
              삭제
            </button>
          )}
        </div>
      )}
    </GameDialog>
  );
}

/* 삭제 확인 모달(ADR-0020). 되돌릴 수 없는 행동이라 확인을 **파괴 앞**에 세운다 — 눌러 놓고
   무르는 창을 주는 대신, 누르기 전에 무엇이 사라지는지 보여준다. 포스터·제목을 싣는 건 상세가
   이미 보여준 것을 되짚는 것이지 중복이 아니다: 이 화면의 질문은 "무엇을 보고 있나"가 아니라
   "무엇을 지우려는가"고, 그 둘이 어긋난 채 확정되는 걸 막는 마지막 지점이 여기다.

   인계 규약은 컴포저·수정과 같다 — 성공은 신호(closing)만 세우고 실제 인계는 브라우저가
   dialog 를 닫은 뒤 오는 onClose 에서 한다(GameDialog 의 busy 주석). 실패 문구는 모달 안에
   남긴다: 바깥은 inert 라 페이지 하단 라이브 영역이 안 읽힌다. */
function GameDeleteConfirm({
  game,
  stacked,
  onRemoved,
  onClose,
}: {
  game: GameCard;
  // 카드 상세 위에 겹쳐 떴는가 — 그렇다면 스크림을 한 겹 더 깔지 않는다.
  stacked: boolean;
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

/* 게임 수정 모달. 고치는 건 클리어 상태와 플레이 날짜 둘이다 — 제목·포스터는 "무엇을 고치는지"
   확인용으로만 싣는다(게임 자체를 바꾸려면 떼고 다시 붙인다 — categoryId 가 정본 키라 갈아끼우면
   중복 방지가 무너진다). 서버 updateGameInput 은 부분 패치가 아니라 셋을 늘 함께 받는다.

   플레이 날짜는 games 컬럼이 아니라 일정 항목을 고친다(정본은 schedule_entries, 이슈 #56 결정 3).
   그래서 **열자마자 그 게임의 일정 날짜를 조회한다** — 상세(GameCard.lastPlayed)에 있는 값을 못
   쓰는 이유가 둘이다: (1) lastPlayed 는 발행된 항목만 세므로 초안 주의 항목이 안 보여 "0개"로
   오해하고, (2) 여러 날 편성인지 알 수 없어 잠금 판단이 안 선다. 조회는 game:write 를 요구한다
   (초안 유출 방지 — router.playDates).

   조회 실패는 저장을 막는다. 날짜를 모르는 채로 저장하면 빈 입력이 그대로 나가 멀쩡한 일정
   항목이 지워진다(playedDate=null 은 삭제다) — 그 자리는 조용해서 특히 위험하다. */
function GameEditor({
  game,
  stacked,
  onUpdated,
  onClose,
}: {
  game: GameCard;
  // 카드 상세 위에 겹쳐 떴는가 — 그렇다면 스크림을 한 겹 더 깔지 않는다.
  stacked: boolean;
  onUpdated: (row: GameCard) => void;
  onClose: () => void;
}) {
  const { draft, setDraft } = useClearedDraft({
    cleared: game.cleared,
    clearedDate: game.clearedDate ?? "",
  });
  const [error, setError] = useState("");
  /* 이 게임의 일정 날짜. null = 아직 불러오는 중(그동안 날짜 입력은 잠긴다 — PlayedDateField
     주석의 "빈 칸을 날짜 없음으로 오해해 지우는" 자리). */
  const [dates, setDates] = useState<string[] | null>(null);
  const [playedDate, setPlayedDate] = useState("");
  /* 열릴 때 읽은 날짜. 두 곳에 쓴다: (1) 사용자가 실제로 고쳤는지 판별해 안 고쳤으면 저장에
     안 싣고, (2) 실을 땐 precondition 으로 함께 보내 그 사이 딴 데서 바뀌었으면 서버가
     CONFLICT 를 낸다(schema.playedDateWas). */
  const [loadedDate, setLoadedDate] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  // 닫기 신호와 인계할 행. 컴포저와 같은 이유로 성공 즉시 onUpdated 를 부르지 않는다 —
  // 부모가 같은 커밋에서 언마운트하면 dialog 가 열린 채 빠져 포커스가 body 로 떨어진다.
  const [closing, setClosing] = useState(false);
  const [saved, setSaved] = useState<GameCard | null>(null);
  const [saving, startSave] = useTransition();

  /* 열릴 때 한 번 조회한다. setState 가 await 뒤에서만 일어나므로 effect 안 **동기** setState 를
     막는 규칙(set-state-in-effect)에 걸리지 않는다. 모달은 editing 이 null 을 거쳐 매번 리마운트
     되므로 게임이 바뀌면 이 effect 도 다시 돈다 — 의존성에 game.id 를 두는 건 그 사실의 표시다. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const found = await trpc.games.playDates.query(
          { id: game.id },
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        if (!alive) return;
        setDates(found);
        // 항목이 하나면 그 날짜가 곧 편집 대상이다. 여럿이면 잠기고 저장에 안 실린다(onSave).
        const loaded = found.length === 1 ? found[0]! : "";
        setPlayedDate(loaded);
        setLoadedDate(loaded);
      } catch {
        if (!alive) return;
        setLoadFailed(true);
      }
    })();
    // 응답이 늦게 와도 언마운트 뒤엔 상태를 안 건드린다.
    return () => {
      alive = false;
    };
  }, [game.id]);

  /* 여러 날 편성이면 입력이 잠기고(core.isPlayDateEditable) 저장에 날짜를 안 싣는다.
     dateEdited 는 조회가 끝난 뒤에만 참이 될 수 있다 — dates 가 null 인 동안 playedDate 는
     아직 빈 채라, 그 차이를 "고쳤다"로 세면 열자마자 낡은 빈 값이 저장에 실린다. */
  const locked = dates !== null && !isPlayDateEditable(dates);
  const dateEdited = !locked && dates !== null && playedDate !== loadedDate;

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      setError("");
      try {
        /* playedDate 를 **싣지 않는 경우가 둘**이고, 둘 다 "일정을 안 건드린다"는 뜻이다
           (서버 playDateInput 규약 — 필드 부재).

           1. 여러 날 편성이라 입력이 잠겼다. 한때 잠금 상태에서 빈 문자열을 실었는데 그게
              null 로 접혀 "여러 날을 지우려 한다"로 거절돼 **저장이 통째로 막혔다**.
           2. 사용자가 날짜 칸을 **안 건드렸다.** 안 실어야 하는 이유가 둘이다: 같은 값을
              되보내면 주 revision 이 올라 열어 둔 편집기가 원인 없는 CONFLICT 를 받고, 더
              나쁘게는 폼이 열린 뒤 딴 데서 그 항목이 옮겨졌을 때 **stale 한 값이 남의 일정
              작업을 되돌려 놓는다**(적대적 리뷰 5·6라운드 — 서버도 precondition 으로 막는다).

           날짜를 실제로 고쳤으면 playedDateWas 를 함께 보낸다 — 열었을 때의 값이라 서버가
           그 사이 바뀌었는지 판정할 수 있다.
           빈 문자열 → null 전처리의 정본은 서버 updateGameInput(Zod)이다 — 여기서 다시 하지 않는다. */
        const row = await trpc.games.update.mutate(
          {
            id: game.id,
            cleared: draft.cleared,
            clearedDate: draft.clearedDate,
            ...(dateEdited ? { playedDate, playedDateWas: loadedDate } : {}),
          },
          // 상한이 없으면 saving 이 안 풀려 닫기 잠금에 갇힌다(REQUEST_TIMEOUT_MS 주석).
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        setSaved(row);
        setClosing(true);
      } catch (e) {
        // 수정 전용 문구다 — 이 경로의 CONFLICT 는 중복 게임이 아니라 낡은 플레이 날짜다.
        setError(updateErrorMessage(e));
      }
    });
  }

  /* 저장 안 한 수정이 있는가 — 배경 클릭·Esc 로 닫을 때 되묻는 기준이다(GameDialog 의 dirty).
     날짜 쪽은 dateEdited 를 그대로 쓴다: 불러오는 중의 빈 입력을 고침으로 세면 열자마자
     닫기가 막힌다(위 주석). */
  const dirty =
    dateEdited || draft.cleared !== game.cleared || draft.clearedDate !== (game.clearedDate ?? "");

  return (
    <GameDialog
      /* "클리어 수정"이었다 — 플레이 날짜가 돌아오며 고치는 게 둘이 됐다. 제목이 필드보다 좁으면
         사용자는 날짜를 고치러 여기 들어올 생각을 못 한다. */
      title="게임 수정"
      odId="game-editor"
      className={stacked ? "composer--stacked" : undefined}
      closing={closing}
      busy={saving}
      dirty={dirty}
      // 삭제 확인과 같은 이유로 X 를 끈다 — 본문에 "취소"가 있다(GameDialog 의 closeButton).
      closeButton={false}
      onClose={() => (saved ? onUpdated(saved) : onClose())}
    >
      <form className="composer__detail" onSubmit={onSave}>
        {/* 첫 필드가 플레이 날짜라 안내도 그 순서로 말한다 — 클리어만 언급하면 바로 아래
            날짜 입력이 무엇인지 설명 없이 서 있다. */}
        <p className="composer__hint">플레이한 날과 클리어 여부를 고칠 수 있어요.</p>

        <div className="composer__chosen" data-od-id="game-editor-game">
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

        <PlayedDateField
          value={playedDate}
          onChange={setPlayedDate}
          idPrefix="editor"
          dates={dates}
          disabled={saving}
        />

        <ClearedFields
          draft={draft}
          onChange={setDraft}
          idPrefix="editor-clear"
          disabled={saving}
        />

        {loadFailed && (
          <p className="err" role="alert">
            일정을 못 불러와서 저장할 수 없어요. 닫았다 다시 열어 주세요.
          </p>
        )}

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}

        <div className="composer__actions">
          <button
            className="btn btn--secondary composer__btn"
            type="button"
            data-od-id="game-editor-cancel"
            // 저장이 날아가는 동안은 취소도 막는다 — 닫기와 같은 인계 경쟁이다(GameDialog 주석).
            disabled={saving}
            onClick={() => setClosing(true)}
          >
            취소
          </button>
          <button
            className="btn btn--primary composer__btn"
            type="submit"
            /* 날짜를 못(아직) 불러왔으면 저장을 막는다 — 빈 입력이 그대로 나가면 멀쩡한 일정
               항목이 지워진다(playedDate=null 은 삭제다). */
            disabled={saving || dates === null}
            data-od-id="game-editor-submit"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </GameDialog>
  );
}
