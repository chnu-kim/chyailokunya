"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import { ANGLE, axis, PATTERNS, ROT, statusOf, type Status } from "@/core/games";
import type { GameRow } from "@/db";
import { trpc } from "@/features/trpc/client";
import { GameComposer } from "./game-composer";

/* 게임 보드. 목록의 정본은 D1 이다 — 서버 컴포넌트(page.tsx)가 읽어 props 로 넘기고, 여기선
   상태 필터 + 쓰기(추가·삭제)를 한다. 쓰기는 tRPC 뮤테이션(서버 인가가 정본)을 부르고 로컬
   상태를 낙관적으로 갱신한다. canWrite/canDelete 는 버튼 노출용 편의일 뿐 — 권한 없이 눌러도
   서버가 FORBIDDEN 으로 막는다(불변식 3). localStorage 다중탭 경합은 서버 권위로 사라졌다. */

type Filter = "all" | Status;

const FILTERS: { value: Filter; label: string; odId: string }[] = [
  { value: "all", label: "전체", odId: "filter-all" },
  { value: "playing", label: "플레이중", odId: "filter-playing" },
  { value: "cleared", label: "클리어", odId: "filter-cleared" },
  { value: "played", label: "플레이함", odId: "filter-played" },
  { value: "planned", label: "예정", odId: "filter-planned" },
];

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
  const [removing, startRemove] = useTransition();
  // 삭제된 카드는 포커스를 문 버튼째 언마운트한다 — 포커스가 body 로 떨어지지 않게 안정적으로
  // 남는 addslot 트리거로 옮긴다(삭제 권한 canDelete 는 canWrite 를 수반하므로 addslot 은 늘 있다).
  const addSlotRef = useRef<HTMLButtonElement>(null);

  function onFilter(f: Filter, label: string) {
    setFilter(f);
    const shown = games.filter((g) => f === "all" || g.status === f).length;
    setAnnouncement(
      f === "all" ? "전체 " + games.length + "개 표시" : label + " " + shown + "개 표시",
    );
  }

  function onAdded(row: GameRow) {
    // 최신 추가가 위로(구 보드의 prepend). 서버 정본과 같은 정렬.
    setGames((prev) => [row, ...prev]);
    setComposing(false);
    setAnnouncement(row.categoryValue + " 추가됨");
  }

  function onRemove(id: number, name: string) {
    startRemove(async () => {
      try {
        await trpc.games.remove.mutate({ id });
        setGames((prev) => prev.filter((g) => g.id !== id));
        setAnnouncement(name + " 삭제됨");
        addSlotRef.current?.focus();
      } catch {
        setAnnouncement("삭제에 실패했어요");
      }
    });
  }

  const list = games.filter((g) => filter === "all" || g.status === filter);
  const showEmpty = list.length === 0;
  const boardEmpty = games.length === 0;

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
                  총 <b>{games.length}</b>개
                </>
              ) : (
                <>
                  <b>{list.length}</b> / {games.length}개 표시
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
                        disabled={removing}
                        data-od-id={"game-del-" + g.id}
                        onClick={() => onRemove(g.id, g.categoryValue)}
                      >
                        삭제
                        <span className="sr-only">{" " + g.categoryValue}</span>
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
