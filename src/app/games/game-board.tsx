"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ANGLE, axis, PATTERNS, ROT, statusOf, type Status } from "@/core/games";
import type { GameRow } from "@/db";
import { trpc } from "@/features/trpc/client";
import { GameComposer } from "./game-composer";

/* 게임 보드. 목록의 정본은 D1 이다 — 서버 컴포넌트(page.tsx)가 읽어 props 로 넘기고, 여기선
   상태 필터 + 쓰기(추가·삭제)를 한다. 쓰기는 tRPC 뮤테이션(서버 인가가 정본)을 부르고 로컬
   상태를 낙관적으로 갱신한다. canWrite/canDelete 는 버튼 노출용 편의일 뿐 — 권한 없이 눌러도
   서버가 FORBIDDEN 으로 막는다(불변식 3). localStorage 다중탭 경합은 서버 권위로 사라졌다.

   삭제는 **지연 커밋**이다(ADR-0014): 클릭은 카드를 자국(ghost)으로 바꾸고 타이머만 걸며,
   delete 뮤테이션은 타이머가 만료될 때 처음 나간다. 되돌리면 서버를 아예 건드리지 않으므로
   games 에 deleted_at 이 필요 없다 — 하드 삭제의 근거가 이 흐름이다. */

type Filter = "all" | Status;

const FILTERS: { value: Filter; label: string; odId: string }[] = [
  { value: "all", label: "전체", odId: "filter-all" },
  { value: "playing", label: "플레이중", odId: "filter-playing" },
  { value: "cleared", label: "클리어", odId: "filter-cleared" },
  { value: "played", label: "플레이함", odId: "filter-played" },
  { value: "planned", label: "예정", odId: "filter-planned" },
];

/* 되돌릴 수 있는 창. 토스트 관례(5~7초) 안에서, 키보드로 되돌리기 버튼까지 가서 누를 여유를
   두고 6초. 이 시간이 지나야 서버에 삭제가 나간다. */
const UNDO_MS = 6000;

// --rest-rot/--thumb-a 같은 CSS 커스텀 속성을 인라인 style 로 넘길 때의 타입 우회.
function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
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
  const [filter, setFilter] = useState<Filter>("all");
  const [announcement, setAnnouncement] = useState("");
  const [composing, setComposing] = useState(false);
  // 지연 커밋 대기 중인 카드(자국으로 렌더). 행 자체는 games 에 남아 있어야 되돌릴 수 있다.
  const [ghosts, setGhosts] = useState<ReadonlySet<number>>(new Set());
  // 커밋 뮤테이션이 이미 나간 카드. 왕복(수백 ms~수초) 동안 되돌리기가 눌리면 "되돌렸어요"라
  // 알린 행이 서버에서 사라진다 — 하드 삭제라 복구 경로가 없다. 그 창에서 버튼을 잠근다.
  const [committing, setCommitting] = useState<ReadonlySet<number>>(new Set());
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

  function setGhost(id: number, on: boolean) {
    setGhosts((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setCommitting_(id: number, on: boolean) {
    setCommitting((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
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

  function onFilter(f: Filter, label: string) {
    setFilter(f);
    // 아직 안 소비된 포커스 예약을 버린다 — 안 그러면 나중에 그 카드가 다시 렌더될 때
    // 방금 누른 필터 칩에서 포커스를 낚아챈다.
    pendingFocus.current = null;
    const live = games.filter((g) => !ghosts.has(g.id));
    const shown = live.filter((g) => f === "all" || g.status === f).length;
    setAnnouncement(
      f === "all" ? "전체 " + live.length + "개 표시" : label + " " + shown + "개 표시",
    );
  }

  function onAdded(row: GameRow) {
    // 최신 추가가 위로(구 보드의 prepend). 서버 정본과 같은 정렬.
    setGames((prev) => [row, ...prev]);
    setComposing(false);
    // 필터가 걸려 있으면 방금 붙인 카드가 화면에 안 나타난다 — "추가됨"이라 알려 놓고 그리드는
    // 그대로인 모순을 피하려고, 새 행이 현재 필터에 안 걸리면 전체로 되돌린다.
    setFilter((f) => (f === "all" || f === row.status ? f : "all"));
    setAnnouncement(row.categoryValue + " 추가됨");
  }

  // 삭제 클릭 = 자국으로 바꾸고 타이머만 건다. 뮤테이션은 여기서 안 나간다(ADR-0014).
  function onRemove(id: number, name: string) {
    setGhost(id, true);
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
    setGhost(id, false);
    setAnnouncement(name + " 되돌렸어요");
    pendingFocus.current = "del:" + id;
  }

  async function commitRemove(id: number, name: string) {
    timers.current.delete(id);
    setCommitting_(id, true);
    // 자국의 되돌리기 버튼에 포커스가 있었으면 그 버튼이 사라지므로 포커스를 옮겨 줘야 한다.
    const undoEl = btnRefs.current.get("undo:" + id);
    const hadFocus = !!undoEl && document.activeElement === undoEl;
    try {
      await trpc.games.remove.mutate({ id });
      setGames((prev) => prev.filter((g) => g.id !== id));
      setGhost(id, false);
      setCommitting_(id, false);
      setAnnouncement(name + " 삭제됨");
      if (hadFocus) addSlotRef.current?.focus();
    } catch {
      // 서버가 거부하면 자국을 걷고 카드를 되살린다 — 지워진 것처럼 보이게 두지 않는다.
      setGhost(id, false);
      setCommitting_(id, false);
      setAnnouncement(name + " 삭제에 실패했어요");
      if (hadFocus) pendingFocus.current = "del:" + id;
    }
  }

  // 자국(삭제 대기)은 아직 지워지지 않았지만 사용자에겐 "뗀 것"이라 세지 않는다 — 안 그러면
  // 6초 뒤 아무것도 안 눌렀는데 총계가 혼자 줄어든다.
  const live = games.filter((g) => !ghosts.has(g.id));
  const shown = live.filter((g) => filter === "all" || g.status === filter);
  // 자국은 필터와 무관하게 계속 렌더한다 — 필터를 바꿨다고 되돌릴 UI 가 사라지면 타이머만
  // 남아 되돌릴 수 없는 하드 삭제가 된다(ADR-0014 의 되돌림 창 계약이 깨진다).
  const list = games.filter((g) => ghosts.has(g.id) || filter === "all" || g.status === filter);
  const showEmpty = list.length === 0;
  const boardEmpty = live.length === 0;

  return (
    <>
      {/* HEAD */}
      <section className="head" data-od-id="play-log-head">
        <div className="wrap">
          <div className="head__row">
            <h1 data-od-id="play-log-title">플레이한 게임</h1>
            <span className="head__count">
              {filter === "all" ? (
                <>
                  총 <b>{live.length}</b>개
                </>
              ) : (
                <>
                  <b>{shown.length}</b> / {live.length}개 표시
                </>
              )}
            </span>
          </div>
          <p className="head__lead">
            챠이로 쿠냐가 방송에서 플레이한 게임 보드입니다. 상태로 골라보세요.
          </p>
        </div>
      </section>

      {composing && <GameComposer onAdded={onAdded} onClose={() => setComposing(false)} />}

      {/* BOARD */}
      <section className="board" aria-labelledby="board-h2">
        <div className="wrap">
          <h2 className="sr-only" id="board-h2">
            게임 목록
          </h2>

          <div
            className="filters"
            role="group"
            aria-label="상태로 거르기"
            data-od-id="status-filters"
          >
            {FILTERS.map((f) => (
              <button
                key={f.value}
                className="fchip"
                type="button"
                aria-pressed={filter === f.value}
                data-od-id={f.odId}
                onClick={() => onFilter(f.value, f.label)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="games" data-od-id="game-grid">
            {/* 붙이기는 드물고 사적인 행동이라 상시 폭을 먹는 접수창구 대신, 그리드 첫 칸에
                빈 폴라로이드 한 장을 꺼내 붙이는 은유(관리자에게만). 필터가 걸려도 늘 첫 칸이라
                이 상태에 게임이 하나도 없어도 붙일 자리가 남는다. 진짜 방어선은 서버 인가다. */}
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
            {list.map((g) => {
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
                        disabled={committing.has(g.id)}
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

              const st = statusOf(g.status);
              // 카드 정체성(기울기·패턴·각도)은 안정 id 해시로 고른다 — 정수 PK 를 문자열로.
              const key = String(g.id);
              const rot = ROT[axis(key, "rot", ROT.length)] ?? ROT[0];
              const ang = ANGLE[axis(key, "ang", ANGLE.length)] ?? ANGLE[0];
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
                        width={160}
                        height={120}
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
                    <div className="game__top">
                      <h3 className="game__name">{g.categoryValue}</h3>
                      <span className={"chip " + st.cls}>{st.label}</span>
                    </div>
                    {/* 삭제는 3차 액션 — 44px 히트 영역이되 투명·작은 글자라 시각 무게가 없다.
                        휴지통 아이콘은 .game__del::before 가 그린다. 서버가 인가를 다시 검사한다. */}
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
                </div>
              );
            })}
          </div>

          <div className="grid-empty" hidden={!showEmpty} data-od-id="game-grid-empty">
            <span className="t-hand">텅 비었네냥…</span>
            <span hidden={boardEmpty}>이 상태의 게임이 없어요. 다른 필터를 골라보세요.</span>
            <span hidden={!boardEmpty}>아직 등록된 게임이 없어요.</span>
          </div>

          <p className="sr-only" role="status">
            {announcement}
          </p>
        </div>
      </section>
    </>
  );
}
