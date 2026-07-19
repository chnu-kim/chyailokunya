"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { ANGLE, axis, formatDate, PATTERNS, ROT } from "@/core/games";
import type { GameRow } from "@/db";
import { trpc } from "@/features/trpc/client";
import { GameComposer } from "./game-composer";
import { DateFields, GameDialog, messageFor, useDatePair } from "./game-dialog";

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

   삭제는 **지연 커밋**이다(ADR-0014): 클릭은 카드를 자국(ghost)으로 바꾸고 타이머만 걸며,
   delete 뮤테이션은 타이머가 만료될 때 처음 나간다. 되돌리면 서버를 아예 건드리지 않으므로
   games 에 deleted_at 이 필요 없다 — 하드 삭제의 근거가 이 흐름이다. */

/* 자국의 두 단계. undoable = 타이머가 도는 중(되돌릴 수 있다), committing = 삭제 뮤테이션이
   이미 나갔다(되돌릴 수 없으므로 버튼을 잠근다). */
type GhostState = "undoable" | "committing";

/* 되돌릴 수 있는 창. 토스트 관례(5~7초) 안에서, 키보드로 되돌리기 버튼까지 가서 누를 여유를
   두고 6초. 이 시간이 지나야 서버에 삭제가 나간다. */
const UNDO_MS = 6000;

// --rest-rot/--thumb-a 같은 CSS 커스텀 속성을 인라인 style 로 넘길 때의 타입 우회.
function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

/* 카드의 날짜 한 줄. 플레이한 날을 아는 게 보통이라 그걸 싣고, 클리어 여부는 칩이 맡는다.
   플레이한 날 없이 클리어만 아는 행은 그 날짜를 대신 싣고 칩을 접는다 — 안 그러면 한 줄에서
   "클리어"가 두 번 나온다. 둘 다 없으면 호출부가 줄 자체를 안 그린다(null 반환). */
function dateLabel(g: GameRow): string | null {
  if (g.playedAt) return formatDate(g.playedAt) + " 플레이";
  if (g.clearedAt) return formatDate(g.clearedAt) + " 클리어";
  return null;
}

export function GameBoard({
  initialGames,
  canWrite,
  canDelete,
}: {
  initialGames: GameRow[];
  canWrite: boolean;
  canDelete: boolean;
}) {
  const [games, setGames] = useState(initialGames);
  const [announcement, setAnnouncement] = useState("");
  const [composing, setComposing] = useState(false);
  // 날짜를 고치는 중인 행. 행 전체를 들고 있는 이유: 모달이 제목·포스터로 "무엇을 고치는지"를
  // 다시 보여줘야 하고, id 만 들면 목록에서 매번 되찾아야 한다.
  const [editing, setEditing] = useState<GameRow | null>(null);
  /* 지연 커밋 대기 중인 카드(자국으로 렌더). 행 자체는 games 에 남아 있어야 되돌릴 수 있다.
     상태를 Set 둘이 아니라 Map 하나로 두는 이유: "커밋 중"은 늘 "자국"의 부분집합이라 둘을
     따로 들면 불가능한 조합(커밋 중인데 자국 아님)이 타입에 남는다. "committing" 은 뮤테이션이
     이미 나간 창 — 그때 되돌리기가 눌리면 "되돌렸어요"라 알린 행이 서버에서 사라진다(하드
     삭제라 복구 불가)이므로 버튼을 잠근다. */
  const [ghosts, setGhosts] = useState<ReadonlyMap<number, GhostState>>(new Map());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // 포커스를 문 버튼이 사라지는 전환(삭제→자국, 자국→복원)에서 포커스가 body 로 떨어지지
  // 않게 다음 버튼으로 옮긴다. key 는 "undo:<id>" · "del:<id>".
  const btnRefs = useRef(new Map<string, HTMLButtonElement>());
  // 다음에 포커스할 버튼 key. state 가 아니라 ref 인 이유: effect 에서 setState 로 되돌리면
  // 연쇄 렌더가 난다. 대신 그 버튼이 ref 에 등록되는 순간(=마운트) 곧바로 포커스한다.
  const pendingFocus = useRef<string | null>(null);
  const addSlotRef = useRef<HTMLButtonElement>(null);

  // 언마운트되면 대기 중인 삭제는 커밋하지 않는다 — 지연 커밋의 안전한 실패 방향은
  // "안 지워짐"이다(사용자는 보드에서 카드가 그대로인 걸 본다).
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  function setGhost(id: number, state: GhostState | null) {
    setGhosts((prev) => {
      const next = new Map(prev);
      if (state) next.set(id, state);
      else next.delete(id);
      return next;
    });
  }

  function registerBtn(key: string, el: HTMLButtonElement | null) {
    if (!el) {
      btnRefs.current.delete(key);
      return;
    }
    btnRefs.current.set(key, el);
    // 삭제→자국, 자국→복원 전환에서 사라진 버튼을 대신할 버튼이 방금 생겼다면 포커스를 넘긴다.
    if (pendingFocus.current === key) {
      pendingFocus.current = null;
      el.focus();
    }
  }

  function onAdded(row: GameRow) {
    // 최신 추가가 위로(구 보드의 prepend). 서버 정본과 같은 정렬은 아니지만(날짜순) 다음
    // 새로고침이 맞춰 준다 — 방금 붙인 카드는 눈에 보이는 자리에 있어야 한다.
    setGames((prev) => [row, ...prev]);
    setComposing(false);
    setAnnouncement(row.categoryValue + " 추가됨");
  }

  function onUpdated(row: GameRow) {
    setGames((prev) => prev.map((g) => (g.id === row.id ? row : g)));
    setEditing(null);
    setAnnouncement(row.categoryValue + " 날짜 수정됨");
  }

  // 삭제 클릭 = 자국으로 바꾸고 타이머만 건다. 뮤테이션은 여기서 안 나간다(ADR-0014).
  function onRemove(id: number, name: string) {
    setGhost(id, "undoable");
    setAnnouncement(name + " 뗐어요. 되돌릴 수 있어요.");
    pendingFocus.current = "undo:" + id;
    timers.current.set(
      id,
      setTimeout(() => void commitRemove(id, name), UNDO_MS),
    );
  }

  function onUndo(id: number, name: string) {
    const t = timers.current.get(id);
    // 타이머가 이미 없으면 커밋이 나간 뒤다 — 되돌릴 수 없는데 되돌린 척하면 안 된다.
    // (Map.delete 의 반환값으로 "내가 취소한 게 맞다"를 원자적으로 확인한다.)
    if (!timers.current.delete(id)) return;
    if (t) clearTimeout(t);
    setGhost(id, null);
    setAnnouncement(name + " 되돌렸어요");
    pendingFocus.current = "del:" + id;
  }

  async function commitRemove(id: number, name: string) {
    timers.current.delete(id);
    setGhost(id, "committing");
    // 자국의 되돌리기 버튼에 포커스가 있었으면 그 버튼이 사라지므로 포커스를 옮겨 줘야 한다.
    const undoEl = btnRefs.current.get("undo:" + id);
    const hadFocus = !!undoEl && document.activeElement === undoEl;
    try {
      await trpc.games.remove.mutate({ id });
      setGames((prev) => prev.filter((g) => g.id !== id));
      setGhost(id, null);
      setAnnouncement(name + " 삭제됨");
      if (hadFocus) addSlotRef.current?.focus();
    } catch {
      // 서버가 거부하면 자국을 걷고 카드를 되살린다 — 지워진 것처럼 보이게 두지 않는다.
      setGhost(id, null);
      setAnnouncement(name + " 삭제에 실패했어요");
      if (hadFocus) pendingFocus.current = "del:" + id;
    }
  }

  // 자국(삭제 대기)은 아직 지워지지 않았지만 사용자에겐 "뗀 것"이라 세지 않는다 — 안 그러면
  // 6초 뒤 아무것도 안 눌렀는데 총계가 혼자 줄어든다. 자국 카드 자체는 계속 렌더한다 —
  // 그리드에서 사라지면 타이머만 남아 되돌릴 수 없는 하드 삭제가 된다.
  const live = games.filter((g) => !ghosts.has(g.id));

  return (
    <>
      {/* HEAD */}
      <section className="head" data-od-id="play-log-head">
        <div className="wrap">
          <div className="head__row">
            <h1 data-od-id="play-log-title">플레이한 게임</h1>
            <span className="head__count">
              총 <b>{live.length}</b>개
            </span>
          </div>
          <p className="head__lead">
            챠이로 쿠냐가 방송에서 플레이한 게임 보드입니다. 최근에 플레이한 순서로 서 있어요.
          </p>
        </div>
      </section>

      {composing && <GameComposer onAdded={onAdded} onClose={() => setComposing(false)} />}
      {editing && (
        <GameDateEditor game={editing} onUpdated={onUpdated} onClose={() => setEditing(null)} />
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
                className="addslot"
                type="button"
                ref={addSlotRef}
                data-od-id="composer-open"
                onClick={() => setComposing(true)}
              >
                <span className="addslot__slot" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="addslot__label">게임 추가</span>
              </button>
            )}
            {games.map((g) => {
              // 뗀 자리 — 커밋 전이라 행은 아직 살아 있다. 기울기는 .game--ghost 가 0 으로
              // 되돌리므로 인라인 --rest-rot 을 주지 않는다(인라인이 클래스를 이긴다).
              if (ghosts.has(g.id)) {
                return (
                  <div
                    key={g.id}
                    className="polaroid game game--ghost game--settling"
                    data-od-id={"game-ghost-" + g.id}
                  >
                    <span className="clip" aria-hidden="true" />
                    <div className="game__thumb" aria-hidden="true" />
                    <div className="game__body">
                      <p className="game__ghost-msg">뗀 자리 — {g.categoryValue}</p>
                      <button
                        className="game__undo"
                        type="button"
                        ref={(el) => registerBtn("undo:" + g.id, el)}
                        disabled={ghosts.get(g.id) === "committing"}
                        data-od-id={"game-undo-" + g.id}
                        onClick={() => onUndo(g.id, g.categoryValue)}
                      >
                        <span className="sr-only">{g.categoryValue + " "}</span>
                        되돌리기
                      </button>
                    </div>
                  </div>
                );
              }

              // 카드 정체성(기울기·패턴·각도)은 안정 id 해시로 고른다 — 정수 PK 를 문자열로.
              const key = String(g.id);
              const rot = ROT[axis(key, "rot", ROT.length)] ?? ROT[0];
              const ang = ANGLE[axis(key, "ang", ANGLE.length)] ?? ANGLE[0];
              const label = dateLabel(g);
              // 줄 안에서 날짜 텍스트가 이미 "클리어"라 말했으면 칩이 같은 말을 되풀이한다.
              const showCleared = g.clearedAt !== null && g.playedAt !== null;
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
                    {(label || showCleared) && (
                      <p className="game__when" data-od-id={"game-when-" + g.id}>
                        {label && <span className="game__date">{label}</span>}
                        {showCleared && <span className="chip chip--ok">클리어</span>}
                      </p>
                    )}
                    {/* 수정·삭제는 3차 액션 — 44px 히트 영역이되 투명·작은 글자라 시각 무게가
                        없다. 아이콘은 ::before 가 그린다. 서버가 인가를 다시 검사한다. */}
                    {(canWrite || canDelete) && (
                      <div className="game__acts">
                        {canWrite && (
                          <button
                            className="game__edit"
                            type="button"
                            data-od-id={"game-edit-" + g.id}
                            onClick={() => setEditing(g)}
                          >
                            <span className="sr-only">{g.categoryValue + " "}</span>
                            날짜 수정
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="game__del"
                            type="button"
                            ref={(el) => registerBtn("del:" + g.id, el)}
                            data-od-id={"game-del-" + g.id}
                            onClick={() => onRemove(g.id, g.categoryValue)}
                          >
                            <span className="sr-only">{g.categoryValue + " "}</span>
                            삭제
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 빈 상태의 판정 집합은 총계(live)가 아니라 **그리드가 실제로 그리는 집합**(games)이다.
              자국도 카드로 렌더되므로, live 로 판정하면 마지막 한 장을 뗀 6초 동안 되돌리기가
              달린 자국 바로 아래에 "등록된 게임이 없어요"가 같이 뜬다 — 아직 안 지운 카드를
              놓고 없다고 말하는 화면이 된다. 총계는 반대로 live 가 맞다(위 주석). */}
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

/* 날짜 수정 모달. 고칠 수 있는 건 날짜 두 개뿐이라 제목·포스터는 "무엇을 고치는지" 확인용으로만
   싣는다(게임 자체를 바꾸려면 떼고 다시 붙인다 — categoryId 가 정본 키라 갈아끼우면 중복
   방지가 무너진다). 서버 updateGameInput 은 부분 패치가 아니라 두 날짜를 늘 함께 받는다. */
function GameDateEditor({
  game,
  onUpdated,
  onClose,
}: {
  game: GameRow;
  onUpdated: (row: GameRow) => void;
  onClose: () => void;
}) {
  const { dates, setDates, orderError } = useDatePair({
    playedAt: game.playedAt ?? "",
    clearedAt: game.clearedAt ?? "",
  });
  const [error, setError] = useState("");
  // 닫기 신호와 인계할 행. 컴포저와 같은 이유로 성공 즉시 onUpdated 를 부르지 않는다 —
  // 부모가 같은 커밋에서 언마운트하면 dialog 가 열린 채 빠져 포커스가 body 로 떨어진다.
  const [closing, setClosing] = useState(false);
  const [saved, setSaved] = useState<GameRow | null>(null);
  const [saving, startSave] = useTransition();

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (orderError) return;
    startSave(async () => {
      setError("");
      try {
        // 빈 문자열 → null 전처리의 정본은 서버 updateGameInput(Zod)이다 — 여기서 다시 하지 않는다.
        const row = await trpc.games.update.mutate({
          id: game.id,
          playedAt: dates.playedAt,
          clearedAt: dates.clearedAt,
        });
        setSaved(row);
        setClosing(true);
      } catch (e) {
        setError(messageFor(e, "수정에 실패했어요."));
      }
    });
  }

  return (
    <GameDialog
      title="날짜 수정"
      odId="date-editor"
      closing={closing}
      onClose={() => (saved ? onUpdated(saved) : onClose())}
    >
      <form className="composer__detail" onSubmit={onSave}>
        <p className="composer__hint">비워 두면 “모름”으로 남아요.</p>

        <div className="composer__chosen" data-od-id="date-editor-game">
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

        <DateFields dates={dates} onChange={setDates} idPrefix="editor-date" />

        {(orderError || error) && (
          <p className="err" role="alert">
            {orderError || error}
          </p>
        )}

        <div className="composer__actions">
          <button
            className="btn btn--secondary composer__btn"
            type="button"
            data-od-id="date-editor-cancel"
            onClick={() => setClosing(true)}
          >
            취소
          </button>
          <button
            className="btn btn--primary composer__btn"
            type="submit"
            disabled={saving || !!orderError}
            data-od-id="date-editor-submit"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </GameDialog>
  );
}
