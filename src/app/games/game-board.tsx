"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { ANGLE, axis, PATTERNS, ROT } from "@/core/games";
import type { GameCard } from "@/features/games/service";
import { BoardOverlay } from "./board-overlay-context";
import { GameComposer } from "./game-composer";
import { GameDeleteConfirm } from "./game-delete-confirm";
import { GameDetail } from "./game-detail";
import { GameEditor } from "./game-editor";
import { SuggestDialog } from "./suggest-dialog";
import { SuggestionInbox } from "./suggestion-inbox";

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
   "파괴 전에 확인을 받는다"로 갈아 끼웠다.

   ── 오버레이 스택은 board-overlay 머신이 쥔다(ADR-0026, 에픽 #77 이슈 #81) ──────────
   composing·detail·suggesting·inboxOpen·editing·deleting 여섯 `useState` + `detailRemovedRef`
   와 그 위에 손으로 복붙되던 파생값(`stacked={detail!==null}` 3곳, `detailCovered = editing ||
   deleting || suggesting`)을 대체한다. 이 컴포넌트는 `BoardOverlay.Provider` 를 세우기만 하고
   실제 배선은 `GameBoardView`(그 자식)가 한다 — 컨텍스트를 제공하는 컴포넌트 자신은 그 컨텍스트를
   못 읽는다(React 규칙). 모달 6종은 각자 `board-overlay-context.ts` 를 import 해 `useSelector`로
   자기 겹침 상태(stacked·covered)를 읽고 `useActorRef` 로 완료 이벤트를 직접 보고한다 —
   `game-dialog.tsx` 의 `dialog-history` 모듈 싱글턴과 같은 모양이라 이 배선이 그 선례를 잇는다. */

// --rest-rot/--thumb-a 같은 CSS 커스텀 속성을 인라인 style 로 넘길 때의 타입 우회.
function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

export function GameBoard({
  initialGames,
  canWrite,
  canDelete,
  signedIn,
  initialPending,
}: {
  initialGames: GameCard[];
  canWrite: boolean;
  canDelete: boolean;
  /* 로그인했는가 — **제안 진입점이 이 값으로 갈린다**(ADR-0025). 한때 보드는 신원을 아예 안
     받았고 근거는 "member 역할이 없어 로그인해도 얻는 게 없다"였는데(이슈 #22), 제안이 그
     전제를 뒤집었다: 이제 로그인한 사람만 할 수 있는 일이 실재한다. */
  signedIn: boolean;
  // 미처리 제안 수(관리자만). 서버가 세어 넘겨야 배지가 첫 페인트에 뜬다.
  initialPending: number;
}) {
  return (
    <BoardOverlay.Provider options={{ input: { games: initialGames, pending: initialPending } }}>
      <GameBoardView canWrite={canWrite} canDelete={canDelete} signedIn={signedIn} />
    </BoardOverlay.Provider>
  );
}

function GameBoardView({
  canWrite,
  canDelete,
  signedIn,
}: {
  canWrite: boolean;
  canDelete: boolean;
  signedIn: boolean;
}) {
  const actorRef = BoardOverlay.useActorRef();
  const games = BoardOverlay.useSelector((s) => s.context.games);
  const pending = BoardOverlay.useSelector((s) => s.context.pending);
  const announcement = BoardOverlay.useSelector((s) => s.context.announcement);
  const justAdded = BoardOverlay.useSelector((s) => s.context.justAdded);
  const focusAddSlot = BoardOverlay.useSelector((s) => s.context.focusAddSlot);
  const detailOpen = BoardOverlay.useSelector((s) => s.matches("detail"));
  const composing = BoardOverlay.useSelector((s) => s.matches("composing"));
  const inboxOpen = BoardOverlay.useSelector((s) => s.matches("inbox"));
  const editingOpen = BoardOverlay.useSelector(
    (s) => s.matches({ detail: "editing" }) || s.matches("applyingEditSuggestion"),
  );
  const deletingOpen = BoardOverlay.useSelector((s) => s.matches({ detail: "deleting" }));
  const suggestingOpen = BoardOverlay.useSelector(
    (s) => s.matches({ detail: "suggesting" }) || s.matches("suggestAdd"),
  );

  const addSlotRef = useRef<HTMLButtonElement>(null);
  /* 방금 붙인 카드로 포커스를 옮기는 손잡이. 강조 링 자체(.game--just-added)와 그 타이머는
     이제 머신이 쥔다(raise+cancel, board-overlay.machine.ts) — 이 컴포넌트는 포커스 이동만
     맡는다. */
  const justAddedRef = useRef<HTMLButtonElement | null>(null);

  /* 위 justAdded 의 짝. effect 안에서 상태를 안 건드리므로 set-state-in-effect 규칙에 걸리지
     않는다. 모달이 닫히며 브라우저가 추가 슬롯으로 되돌린 포커스를 여기서 덮는다 — close
     이벤트가 리렌더보다 먼저라 이 effect 가 나중이다. */
  useEffect(() => {
    if (justAdded === null) return;
    justAddedRef.current?.focus();
  }, [justAdded]);

  /* 삭제로 상세가 닫힌 뒤 포커스를 추가 슬롯으로 넘긴다(특성화 2, #78). **상세가 실제로
     사라진 뒤에만** 옮긴다 — GAME_REMOVED 는 detailClosing·focusAddSlot 을 같은 트랜지션에서
     켜지만 그 시점엔 아직 detail 이 열려 있다(<dialog> 의 close 는 큐라 동기가 아니다,
     game-dialog.tsx 의 DiscardConfirm 주석). 상세가 열린 채 포커스를 옮기면 배경이 아직
     inert 라 focus() 가 무시되고(ADR-0026 스파이크 실측) FOCUS_HANDLED 로 신호만 꺼져
     포커스가 영영 안 옮겨간다. */
  useEffect(() => {
    if (!focusAddSlot || detailOpen) return;
    addSlotRef.current?.focus();
    actorRef.send({ type: "FOCUS_HANDLED" });
  }, [focusAddSlot, detailOpen, actorRef]);

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

          {/* 보드 전체에 걸리는 조작 둘. 카드 하나에 매인 게 아니라 여기 산다 — 「게임 추가」가
              그리드 첫 칸의 빈 폴라로이드인 것과 갈리는 지점이다(그건 "한 장 더 붙인다"는
              은유라 격자 안이 제자리고, 이 둘은 격자 밖의 일이다).

              비로그인에겐 아무것도 안 그린다. 취할 조치가 없는 안내는 화면 어디에 두든 읽는
              사람의 시간만 쓴다는 판단 그대로다(추가 슬롯을 안 그리는 것과 같은 근거) — 다만
              카드 상세에는 한 줄을 둔다. 거기선 "이거 틀렸네"를 방금 본 사람이라 로그인이
              **취할 수 있는 조치**가 된다. */}
          {(canWrite || signedIn) && (
            <div className="head__acts">
              {canWrite && (
                <button
                  className="btn btn--secondary head__act"
                  type="button"
                  data-od-id="inbox-open"
                  onClick={() => actorRef.send({ type: "OPEN_INBOX" })}
                >
                  들어온 제안
                  {/* 0 건이면 배지를 안 그린다 — 빈 수를 보여 주면 매번 확인하게 만든다.
                      숫자는 장식이 아니라 조작 이름의 일부라 aria-hidden 을 안 건다. */}
                  {pending > 0 && (
                    <span className="head__badge" data-od-id="inbox-badge">
                      {pending}
                    </span>
                  )}
                </button>
              )}
              {/* 관리자는 직접 추가하면 되므로 자기에게 요청할 이유가 없다. */}
              {signedIn && !canWrite && (
                <button
                  className="btn btn--secondary head__act"
                  type="button"
                  data-od-id="suggest-add-open"
                  onClick={() => actorRef.send({ type: "OPEN_SUGGEST_ADD" })}
                >
                  게임 추가 요청
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {composing && <GameComposer />}
      {detailOpen && <GameDetail canWrite={canWrite} canDelete={canDelete} signedIn={signedIn} />}
      {suggestingOpen && <SuggestDialog />}
      {inboxOpen && <SuggestionInbox />}
      {/* 상세가 아래 열려 있으면 스크림을 한 겹 더 깔지 않는다(각 모달이 자기 stacked 를
          selector 로 직접 읽는다 — GameDialog 의 className). */}
      {editingOpen && <GameEditor />}
      {deletingOpen && <GameDeleteConfirm />}

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
                onClick={() => actorRef.send({ type: "OPEN_COMPOSER" })}
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
                  className={"polaroid game" + (g.id === justAdded ? " game--just-added" : "")}
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
                        // 방금 붙인 카드에만 걸린다 — 정렬 뒤 그 카드를 찾아 주는 손잡이다.
                        ref={g.id === justAdded ? justAddedRef : undefined}
                        // 히스토리 엔트리는 여는 쪽이 아니라 셸이 쌓는다(GameDialog 의 history).
                        onClick={() => actorRef.send({ type: "OPEN_DETAIL", game: g })}
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
              <span>아직 등록된 게임이 없습니다.</span>
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
