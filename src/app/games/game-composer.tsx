"use client";

import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import {
  composerReducer,
  composerStep,
  initialComposerState,
  showsManualEntry,
} from "@/core/games-composer";
import type { GameRow } from "@/db";
import { trpc } from "@/features/trpc/client";
import { DateFields, dateOrderError, GameDialog, messageFor } from "./game-dialog";

/* 게임 추가 컴포저(ADR-0015·0017). 두 단계다:

     search  — 치지직 카테고리를 검색한다(서버 인가된 tRPC, creds 는 서버에만).
     detail  — 고른 게임의 포스터·제목을 확인하고 날짜 두 개를 넣은 뒤 추가한다.

   결과 클릭이 곧 추가였던 한 단계짜리를 나눈 이유: 날짜는 붙인 뒤에 고치는 값이 아니라 붙일
   때 아는 값이고, 클릭 한 번이 곧 서버 쓰기면 잘못 고른 걸 되돌리는 유일한 길이 삭제였다.
   detail 은 뒤로 갈 수 있고(결과 목록은 그대로 남는다) 그때까지 서버는 안 건드린다.

   단계 사이의 전이 규칙(선택·뒤로·수동 입력 비상구·날짜 초기화)은 전부 core/games-composer
   의 순수 리듀서가 쥔다 — 이 파일은 그리기와 통신만 한다. 그래야 "뒤로 갔다 다른 게임을
   고르면 이전 날짜가 따라오는가" 같은 전이 버그를 DOM 없이 단위 테스트가 잡는다. */

export function GameComposer({
  onAdded,
  onClose,
}: {
  onAdded: (row: GameRow) => void;
  onClose: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const firstDateRef = useRef<HTMLInputElement>(null);
  const [state, dispatch] = useReducer(composerReducer, initialComposerState);
  const [error, setError] = useState("");
  /* 닫기 신호와, 닫힌 뒤에 부모에게 넘길 행. 추가 성공 즉시 onAdded 를 부르면 부모가 같은
     커밋에서 컴포저를 언마운트해 닫기 effect 가 아예 안 돌고, 열린 채로 DOM 에서 빠져 포커스가
     body 로 떨어진다. 그래서 성공은 행을 쥐고 신호만 세우고, 실제 인계는 브라우저가 dialog 를
     닫은 뒤 오는 onClose 이벤트에서 한다. */
  const [closing, setClosing] = useState(false);
  const [added, setAdded] = useState<GameRow | null>(null);
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  const { selected, dates } = state;
  const step = composerStep(state);
  const orderError = dateOrderError(dates);

  /* 단계가 바뀌면 포커스를 그 단계의 첫 조작점으로 옮긴다. 단계를 여는 버튼(결과 항목·뒤로·
     직접 입력)은 전부 **자기 자신을 언마운트**하므로, 안 옮기면 포커스가 dialog 로 떨어져
     키보드·스크린리더 사용자는 화면이 통째로 바뀐 걸 모른 채 Tab 을 처음부터 훑어야 한다.
     보드의 pendingFocus 규약과 같은 취지다.

     마운트 시 검색 입력 포커스도 이 effect 가 겸한다(초기 단계가 search). autoFocus 속성은
     여기서 무효다 — React 는 커밋 시점에 .focus() 를 대신 부르는데 그땐 dialog 가 아직 닫혀
     있어(UA 의 display:none) no-op 이고, 이후 showModal 의 포커스 단계는 autofocus "속성"을
     찾다 못 찾아 첫 포커서블(닫기 버튼)로 떨어진다. */
  useEffect(() => {
    if (step === "detail") firstDateRef.current?.focus();
    else searchRef.current?.focus();
  }, [step]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = state.query.trim();
    if (!q) return;
    startSearch(async () => {
      setError("");
      try {
        const found = await trpc.chzzk.categorySearch.query({ query: q, size: 12 });
        dispatch({ type: "searchSucceeded", results: found });
      } catch (e) {
        dispatch({ type: "searchFailed" });
        setError(messageFor(e, "검색에 실패했어요. 잠시 후 다시 시도해 주세요."));
      }
    });
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || orderError) return;
    startAdd(async () => {
      setError("");
      try {
        // 필드를 그대로 옮길 뿐 여기서 trim·empty→null 을 다시 하지 않는다 — 그 정규화의
        // 정본은 games.add 뮤테이션의 addGameInput(Zod) 하나다(중복 정규화 금지).
        const row = await trpc.games.add.mutate({
          categoryId: selected.categoryId,
          categoryType: "GAME",
          categoryValue: selected.categoryValue,
          posterImageUrl: selected.posterImageUrl,
          playedAt: dates.playedAt,
          clearedAt: dates.clearedAt,
        });
        setAdded(row);
        setClosing(true);
      } catch (e) {
        setError(messageFor(e, "추가에 실패했어요."));
      }
    });
  }

  return (
    <GameDialog
      title="게임 추가"
      odId="composer"
      closing={closing}
      onClose={() => (added ? onAdded(added) : onClose())}
    >
      {selected ? (
        <form className="composer__detail" onSubmit={onAdd}>
          <p className="composer__hint">언제 플레이했는지 적어 두면 보드가 시간순으로 서요.</p>

          <div className="composer__chosen" data-od-id="composer-chosen">
            {selected.posterImageUrl ? (
              <img
                className="composer__poster composer__poster--lg"
                src={selected.posterImageUrl}
                alt=""
                width={72}
                height={96}
              />
            ) : (
              <span className="composer__noposter composer__poster--lg" aria-hidden="true">
                {selected.categoryValue.charAt(0)}
              </span>
            )}
            <span className="composer__chosenname">{selected.categoryValue}</span>
          </div>

          <DateFields
            dates={dates}
            onChange={(next) => dispatch({ type: "datesChanged", dates: next })}
            idPrefix="composer-date"
            firstFieldRef={firstDateRef}
          />

          {(orderError || error) && (
            <p className="err" role="alert">
              {orderError || error}
            </p>
          )}

          <div className="composer__actions">
            <button
              className="btn btn--secondary composer__btn"
              type="button"
              data-od-id="composer-back"
              onClick={() => {
                dispatch({ type: "back" });
                setError("");
              }}
            >
              뒤로
            </button>
            <button
              className="btn btn--primary composer__btn"
              type="submit"
              disabled={adding || !!orderError}
              data-od-id="composer-submit"
            >
              {adding ? "추가 중…" : "추가"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="composer__hint">치지직 게임 카테고리를 검색해 보드에 붙여요.</p>

          <form className="composer__search" onSubmit={onSearch}>
            <input
              className="field"
              type="search"
              placeholder="게임 이름으로 검색"
              value={state.query}
              ref={searchRef}
              onChange={(e) => dispatch({ type: "queryChanged", query: e.target.value })}
              data-od-id="composer-input"
            />
            <button className="btn btn--secondary composer__btn" type="submit" disabled={searching}>
              {searching ? "검색 중…" : "검색"}
            </button>
          </form>

          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}

          <ul className="composer__results" data-od-id="composer-results">
            {state.results.map((c) => (
              <li key={c.categoryId}>
                <button
                  className="composer__pick"
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "picked",
                      selection: {
                        categoryId: c.categoryId,
                        categoryValue: c.categoryValue,
                        posterImageUrl: c.posterImageUrl,
                      },
                    })
                  }
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

          {showsManualEntry(state) && (
            <div className="composer__manual" data-od-id="composer-manual">
              <p className="composer__hint">
                ‘{state.query.trim()}’ 검색 결과가 없어요 — 직접 입력할까요?
              </p>
              <button
                className="btn btn--secondary composer__btn"
                type="button"
                data-od-id="composer-manual-go"
                onClick={() => dispatch({ type: "manualPicked" })}
              >
                직접 입력으로 추가
              </button>
            </div>
          )}
        </>
      )}

      {/* 단계 전환은 화면이 통째로 바뀌는 사건이라 포커스 이동만으로는 맥락이 안 실린다 —
          보드의 announcement 규약과 같이 한 줄로 알린다. */}
      <p className="sr-only" role="status">
        {selected ? selected.categoryValue + " 선택됨. 날짜를 입력하세요." : ""}
      </p>
    </GameDialog>
  );
}
