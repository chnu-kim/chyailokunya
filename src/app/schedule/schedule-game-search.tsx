"use client";

import { useMachine } from "@xstate/react";
import { useEffect, useMemo, useRef } from "react";
import {
  composerActiveOption,
  composerMachine,
  composerNeedsSearch,
  composerOptionCount,
  composerResultIndex,
  composerStep,
  DIRECT_ENTRY_INDEX,
  showsDirectEntry,
  type ComposerActiveMove,
} from "@/core/composer.machine";
import { readErrorMessage, REQUEST_TIMEOUT_MS, writeErrorMessage } from "@/core/error-message";
import type { ChzzkCategory } from "@/core/games";
import { createSubmitMachine } from "@/core/submit.machine";
import type { GameCard, GameOption } from "@/features/games/service";
import { trpc } from "@/features/trpc/client";

/* 일정 항목의 게임 연결 — 인라인 검색·추가(이슈 #56 결정 11·19, 2026-07-28 구현). 게임 보드의
   `game-composer.tsx`(치지직 카테고리 검색)와 나란한 결이지만 세 가지가 다르다:

   1. **모달이 아니라 행 아래로 펼치는 인라인 블록이다** — 이 페이지는 편집기 자체가 이미 모달을
      안 쓰는 인라인 스프레드시트형이고(schedule-editor.tsx 파일 상단 주석), 여기만 모달을 끌어오면
      회귀 격리 원칙이 깨진다.
   2. **보드에 이미 있는 게임을 먼저 본다.** `localGames`(부모가 들고 있는, 이번 세션에 새로 추가한
      게임까지 포함된 로컬 목록)를 검색어로 즉시 필터링해 보여준다(부분 일치 포함) — 매주
      반복되는 게임은 네트워크 없이 한 클릭으로 잇는다(결정 11의 원래 근거, "이 선택만으로
      왕복이 없다"). 로컬에 **정확히 같은 이름**이 있을 때만 `composerMachine`(치지직 검색)의
      디바운스 검색을 안 태운다 — 부분 일치만으론 막지 않는다. "헤이데스"를 찾는데 로컬엔
      "헤이데스 2"만 있는 경우처럼, 부분 일치로 목록이 안 비는 것과 "찾는 게임이 있다"는 다른
      사실이라(적대적 리뷰가 잡은 막다른 골목 — 첫 판은 `localMatches.length` 하나로 갈라
      이 경우 치지직 검색도 직접 추가도 영영 못 열었다), `hasExactLocalMatch` 를 따로 둔다.
   3. **치지직에서 고른 건 확인 없이 바로 추가한다.** 정본 카테고리라 되돌릴 이유가 약하다.
      반면 **직접 입력(자유 텍스트)은 인라인 확인을 한 번 거친다** — 오타 하나가 영구 게임 행을
      만들 수 있어서다(치지직 pick 과 달리 정본 확인이 없다).

   `composerMachine` 은 한 글자도 안 고치고 그대로 재사용한다(게임 보드의 `game-composer.tsx` 가
   이미 이 머신을 쓰고, 로컬 필터는 그 머신이 모르는 이 페이지만의 판단이라 머신 밖 useMemo 로
   둔다 — 머신에 새 개념을 얹지 않는다). */

const addMachine = createSubmitMachine<Parameters<typeof trpc.games.add.mutate>[0], GameCard>();

// game-composer.tsx 와 같은 값 — 한글 조합 중 자모 단위 요청을 막으면서도 굼뜨지 않을 사이.
const SEARCH_DEBOUNCE_MS = 350;

const RESULTS_ID_PREFIX = "sched-game-search-results-";
const optionId = (idPrefix: string, index: number) => idPrefix + "option-" + index;

const ARROW_MOVES: Partial<Record<string, ComposerActiveMove>> = {
  ArrowDown: "next",
  ArrowUp: "prev",
};

const optionClass = (active: boolean) =>
  active ? "sched-picker__result sched-picker__result--active" : "sched-picker__result";

const keepFocusInInput = (e: React.MouseEvent) => e.preventDefault();

export function ScheduleGameSearch({
  idPrefix,
  localGames,
  currentGameId,
  onPick,
  onUnlink,
  onGameCreated,
  onClose,
}: {
  idPrefix: string;
  localGames: GameOption[];
  currentGameId: number | null;
  onPick: (gameId: number, categoryValue: string) => void;
  onUnlink: () => void;
  onGameCreated: (game: GameOption) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsId = RESULTS_ID_PREFIX + idPrefix;
  const [state, send] = useMachine(composerMachine, { input: { query: "" } });
  const [addState, sendAdd] = useMachine(addMachine, {
    input: {
      run: (values, signal) => trpc.games.add.mutate(values, { signal }),
      mapError: writeErrorMessage,
    },
  });
  const adding = addState.matches("submitting");
  const query = state.context.query.trim();
  const step = composerStep(state.context);
  const optionCount = composerOptionCount(state.context);
  const activeOption = composerActiveOption(state.context);

  // 검색창에 포커스 — 패널이 열리는 순간이 곧 마운트 시점이다(schedule-editor.tsx 가 이 컴포넌트를
  // 열렸을 때만 마운트한다).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* 보드에 이미 있는 게임 즉시 필터(네트워크 없음) — 매주 반복되는 게임은 이 목록 하나로
     끝난다(결정 11). 부분 일치까지 보여준다("헤이데스"를 치면 "헤이데스 2"도 뜬다) — 그래야
     비슷한 이름의 다른 게임이 이미 있어도 그 카드를 눈으로 확인하고 지나칠 수 있다. */
  const localMatches = useMemo(() => {
    if (query === "") return [];
    const q = query.toLowerCase();
    return localGames.filter((g) => g.categoryValue.toLowerCase().includes(q)).slice(0, 8);
  }, [localGames, query]);

  /* 로컬에 **정확히 같은 이름**이 있을 때만 치지직 검색을 안 태운다 — 그 게임을 이미 찾았다고
     본다. 부분 일치만으론 안 막는다: "헤이데스"를 찾는데 로컬엔 "헤이데스 2"만 있으면 그건
     다른 게임이라, localMatches.length 로만 가르면(첫 판의 실수 — 적대적 리뷰 지적) 원하는
     게임을 영영 치지직에서 못 찾고 직접 추가도 못 하는 막다른 골목이 된다. */
  const hasExactLocalMatch = useMemo(
    () => localMatches.some((g) => g.categoryValue.trim().toLowerCase() === query.toLowerCase()),
    [localMatches, query],
  );

  async function runSearch(submitted: string) {
    const q = submitted.trim();
    if (!q) return;
    send({ type: "searchStarted" });
    try {
      const found = await trpc.chzzk.categorySearch.query(
        { query: q, size: 12 },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      send({ type: "searchSucceeded", query: submitted, results: found });
    } catch (e) {
      send({ type: "searchFailed", query: submitted, message: readErrorMessage(e) });
    }
  }

  // 정확히 같은 이름이 로컬에 있으면 치지직 검색을 안 태운다 — game-composer.tsx 의 debounce
  // effect 와 같은 모양이되 이 페이지만의 판단(로컬 우선)이 하나 더 낀다.
  useEffect(() => {
    if (hasExactLocalMatch) return;
    if (!composerNeedsSearch(state.context)) return;
    const timer = setTimeout(() => void runSearch(state.context.query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.context.query, state.context.searched, state.context.selected, hasExactLocalMatch]);

  useEffect(() => {
    if (state.context.activeIndex < 0) return;
    document
      .getElementById(optionId(idPrefix, state.context.activeIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [state.context.activeIndex, idPrefix]);

  // 추가 성공 — 새 게임을 부모 로컬 목록에 얹고 이 항목에 곧바로 잇는다.
  useEffect(() => {
    if (!addState.matches("done")) return;
    const g = addState.context.result!;
    onGameCreated({ id: g.id, categoryValue: g.categoryValue, posterImageUrl: g.posterImageUrl });
    onPick(g.id, g.categoryValue);
    onClose();
    // onPick·onGameCreated·onClose 는 부모 렌더마다 새로 만들어지는 함수라 실으면 addState 가
    // 안 바뀌어도 이 effect 가 다시 돈다 — 의존은 addState 하나로 충분하다(전이 자체가 신호다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addState]);

  function addGame(selection: {
    categoryId: string | null;
    categoryValue: string;
    posterImageUrl: string | null;
  }) {
    sendAdd({
      type: "submit",
      values: {
        categoryId: selection.categoryId,
        categoryType: "GAME",
        categoryValue: selection.categoryValue,
        posterImageUrl: selection.posterImageUrl,
        // 일정 편집기 안에서 만드는 게임은 항상 playedDate:null 이다 — addGame(games/service.ts)
        // 이 playedDate 가 있을 때만 claimWeek 을 불러 이 주의 revision 을 건드리므로, null 로
        // 고정해야 지금 열려 있는 편집기의 CAS 가 안전하다(이슈 #56 결정 19).
        playedDate: null,
        cleared: false,
        clearedDate: "",
      },
    });
  }

  // 치지직 결과는 정본 카테고리라 확인 없이 바로 추가한다.
  function choose(option: ChzzkCategory) {
    send({
      type: "picked",
      selection: {
        categoryId: option.categoryId,
        categoryValue: option.categoryValue,
        posterImageUrl: option.posterImageUrl,
      },
    });
    addGame(option);
  }

  // 자유 입력은 detail 로만 건너간다 — 실제 추가는 아래 인라인 확인을 눌러야 나간다(오타 방지).
  function chooseDirect() {
    send({ type: "manualPicked" });
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      if (state.context.activeIndex < 0) {
        onClose();
        return;
      }
      e.preventDefault();
      send({ type: "activeMoved", to: "none" });
      return;
    }
    if (e.key === "Enter") {
      if (!activeOption) return;
      e.preventDefault();
      if (activeOption === "direct") chooseDirect();
      else choose(activeOption);
      return;
    }
    if (optionCount === 0) return;
    const to = ARROW_MOVES[e.key];
    if (!to) return;
    e.preventDefault();
    send({ type: "activeMoved", to });
  }

  const searching = query !== "" && !hasExactLocalMatch && !state.context.searched;

  return (
    <div className="sched-picker" data-od-id={idPrefix + "picker"}>
      {currentGameId !== null && (
        <button
          type="button"
          className="sched-picker__unlink"
          data-od-id={idPrefix + "unlink"}
          onClick={() => {
            onUnlink();
            onClose();
          }}
        >
          연결 해제
        </button>
      )}

      {step === "search" && (
        <>
          <label className="sr-only" htmlFor={idPrefix + "input"}>
            게임 이름
          </label>
          <input
            id={idPrefix + "input"}
            className="sched-field"
            type="search"
            placeholder="게임 이름 검색"
            value={state.context.query}
            ref={inputRef}
            autoComplete="off"
            role="combobox"
            aria-expanded={localMatches.length > 0 || optionCount > 0}
            aria-controls={resultsId}
            aria-autocomplete="list"
            aria-activedescendant={
              state.context.activeIndex >= 0
                ? optionId(idPrefix, state.context.activeIndex)
                : undefined
            }
            onChange={(e) => send({ type: "queryChanged", query: e.target.value })}
            onKeyDown={onSearchKeyDown}
            data-od-id={idPrefix + "input"}
          />

          {localMatches.length > 0 && (
            <ul className="sched-picker__local" data-od-id={idPrefix + "local"}>
              {localMatches.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    className="sched-picker__result"
                    onClick={() => {
                      onPick(g.id, g.categoryValue);
                      onClose();
                    }}
                  >
                    {g.categoryValue}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {searching && (
            <p className="sched-picker__hint" role="status">
              찾는 중…
            </p>
          )}

          {state.context.searchError && (
            <p className="sched-err" role="alert">
              {state.context.searchError}
            </p>
          )}

          {/* 로컬에 부분 일치가 있어도 정확히 같은 이름이 아니면 이 목록을 같이 보여준다 —
              hasExactLocalMatch 주석 참고(적대적 리뷰가 잡은 막다른 골목). */}
          {!hasExactLocalMatch && query !== "" && (
            <ul
              className="sched-picker__results"
              id={resultsId}
              role="listbox"
              aria-label="치지직 게임 검색 결과"
              hidden={optionCount === 0}
              onMouseDown={keepFocusInInput}
            >
              {showsDirectEntry(state.context) && (
                <li
                  className={optionClass(state.context.activeIndex === DIRECT_ENTRY_INDEX)}
                  id={optionId(idPrefix, DIRECT_ENTRY_INDEX)}
                  role="option"
                  aria-selected={state.context.activeIndex === DIRECT_ENTRY_INDEX}
                  onMouseMove={() => send({ type: "activeSet", index: DIRECT_ENTRY_INDEX })}
                  onClick={chooseDirect}
                >
                  ‘{query}’ 직접 추가
                </li>
              )}
              {state.context.results.map((c, i) => {
                const idx = composerResultIndex(state.context, i);
                return (
                  <li
                    key={c.categoryId}
                    className={optionClass(state.context.activeIndex === idx)}
                    id={optionId(idPrefix, idx)}
                    role="option"
                    aria-selected={state.context.activeIndex === idx}
                    onMouseMove={() => send({ type: "activeSet", index: idx })}
                    onClick={() => choose(c)}
                  >
                    {c.categoryValue}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {step === "detail" &&
        state.context.selected &&
        state.context.selected.categoryId === null && (
          <div className="sched-picker__confirm" data-od-id={idPrefix + "confirm"}>
            <p className="sched-picker__hint">
              ‘{state.context.selected.categoryValue}’로 새 게임을 추가하시겠습니까? 목록에 없는
              게임은 이 이름 그대로 보드에 새로 생깁니다.
            </p>
            {addState.context.error && (
              <p className="sched-err" role="alert">
                {addState.context.error}
              </p>
            )}
            <div className="sched-picker__confirm-actions">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={adding}
                onClick={() => send({ type: "back" })}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={adding}
                onClick={() => addGame(state.context.selected!)}
              >
                {adding ? "추가 중…" : "추가"}
              </button>
            </div>
          </div>
        )}

      {/* 치지직 결과는 확인 없이 바로 추가되므로(choose) 평소엔 "추가 중…" 한 줄이 곧 성공으로
          끝난다(addState.matches("done") 이 onClose 를 부른다). 실패했을 때만 에러 + 되돌아갈
          길을 보여준다 — 적대적 리뷰 지적: 실패해도 이 줄이 그냥 비워져 사용자가 무슨 일이
          있었는지도, 다시 시도할 길도 없었다. */}
      {step === "detail" &&
        state.context.selected &&
        state.context.selected.categoryId !== null && (
          <div className="sched-picker__confirm" data-od-id={idPrefix + "confirm"}>
            <p className="sched-picker__hint" role="status">
              {adding ? `‘${state.context.selected.categoryValue}’ 추가 중…` : ""}
            </p>
            {!adding && addState.context.error && (
              <>
                <p className="sched-err" role="alert">
                  {addState.context.error}
                </p>
                <div className="sched-picker__confirm-actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => send({ type: "back" })}
                  >
                    뒤로
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => addGame(state.context.selected!)}
                  >
                    다시 시도
                  </button>
                </div>
              </>
            )}
          </div>
        )}

      <button
        type="button"
        className="sched-picker__close"
        data-od-id={idPrefix + "close"}
        onClick={onClose}
      >
        닫기
      </button>
    </div>
  );
}
