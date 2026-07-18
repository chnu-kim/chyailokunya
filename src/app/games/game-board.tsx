"use client";

import { useState, type CSSProperties } from "react";
import { ANGLE, axis, PATTERNS, ROT, statusOf, type Status } from "@/core/games";
import type { GameRow } from "@/db";

/* 읽기 전용 게임 보드. 목록의 정본은 D1 이다 — 서버 컴포넌트(page.tsx)가 읽어 props 로 넘기고,
   여기선 상태 필터(클라이언트 상호작용)만 한다. 추가·삭제(컴포저 카테고리 검색·뮤테이션)는
   인증(#6)이 세션·권한을 주면 붙는다 — 서버 쓰기 API 는 이미 tRPC 로 서 있고 단위테스트로
   증명됐다(이슈 #5). 그래서 이 컴포넌트엔 localStorage·useSyncExternalStore·낙관적 편집이
   없다. */

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

export function GameBoard({ initialGames }: { initialGames: GameRow[] }) {
  const games = initialGames;
  const [filter, setFilter] = useState<Filter>("all");
  const [announcement, setAnnouncement] = useState("");

  function onFilter(f: Filter, label: string) {
    setFilter(f);
    const shown = games.filter((g) => f === "all" || g.status === f).length;
    setAnnouncement(
      f === "all" ? "전체 " + games.length + "개 표시" : label + " " + shown + "개 표시",
    );
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
                      // 치지직 포스터 스냅샷(ADR-0015). Workers 엔 이미지 옵티마이저가 없어 평범한
                      // <img> + width/height 로 CLS 만 막는다(thumb 이 4/3 을 이미 예약).
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
