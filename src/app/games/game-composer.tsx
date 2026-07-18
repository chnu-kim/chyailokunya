"use client";

import { useState, useTransition } from "react";
import type { ChzzkCategory } from "@/core/games";
import type { GameRow } from "@/db";
import { trpc } from "@/features/trpc/client";

/* 게임 추가 컴포저(ADR-0015·0017). 치지직 카테고리를 검색해(서버 인가된 tRPC, creds 는 서버에만)
   고른 뒤 games.add 뮤테이션으로 보드에 넣는다. 성공하면 onAdded 로 보드 상태를 낙관적 갱신한다.
   드물고 사적인 행동이라 상시 폭을 차지하지 않게 다이얼로그로 띄운다. 서버가 인가·중복(CONFLICT)
   을 정본으로 검사하므로 여기선 결과를 한국어로 보여줄 뿐이다. */

export function GameComposer({
  onAdded,
  onClose,
}: {
  onAdded: (row: GameRow) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChzzkCategory[]>([]);
  const [error, setError] = useState("");
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    startSearch(async () => {
      setError("");
      try {
        const found = await trpc.chzzk.categorySearch.query({ query: q, size: 12 });
        setResults(found);
        if (found.length === 0) setError("검색 결과가 없어요. 다른 이름으로 찾아보세요.");
      } catch {
        setError("검색에 실패했어요. 잠시 후 다시 시도해 주세요.");
      }
    });
  }

  function onPick(c: ChzzkCategory) {
    startAdd(async () => {
      setError("");
      try {
        const row = await trpc.games.add.mutate({
          categoryId: c.categoryId,
          categoryType: "GAME",
          categoryValue: c.categoryValue,
          posterImageUrl: c.posterImageUrl,
        });
        onAdded(row);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        setError(msg.includes("이미") ? "이미 보드에 있는 게임이에요." : "추가에 실패했어요.");
      }
    });
  }

  return (
    <div
      className="composer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="게임 추가"
      data-od-id="composer"
      onClick={onClose}
    >
      {/* 배경 클릭은 닫고, 카드 안 클릭은 전파를 멈춘다. */}
      <div className="composer" onClick={(e) => e.stopPropagation()}>
        <div className="composer__head">
          <h2 className="composer__title">게임 추가</h2>
          <button className="composer__close" type="button" aria-label="닫기" onClick={onClose}>
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <form className="composer__search" onSubmit={onSearch}>
          <input
            className="composer__input"
            type="search"
            placeholder="치지직 게임 카테고리 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-od-id="composer-input"
            autoFocus
          />
          <button className="composer__btn" type="submit" disabled={searching}>
            {searching ? "검색 중…" : "검색"}
          </button>
        </form>

        {error && (
          <p className="composer__error" role="alert">
            {error}
          </p>
        )}

        <ul className="composer__results" data-od-id="composer-results">
          {results.map((c) => (
            <li key={c.categoryId}>
              <button
                className="composer__pick"
                type="button"
                disabled={adding}
                onClick={() => onPick(c)}
              >
                {c.posterImageUrl ? (
                  <img
                    className="composer__poster"
                    src={c.posterImageUrl}
                    alt=""
                    width={40}
                    height={53}
                    loading="lazy"
                  />
                ) : (
                  <span className="composer__noposter" aria-hidden="true">
                    {c.categoryValue.charAt(0)}
                  </span>
                )}
                <span className="composer__pickname">{c.categoryValue}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
