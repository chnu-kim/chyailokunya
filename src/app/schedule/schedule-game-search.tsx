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

/* 결과 한 줄 앞의 표지 마크(2026-07-31). 30×40 은 치지직 포스터의 실제 비율(300×400, 실측)
   이고 읽기 화면의 항목 표지와 같은 값이라, 같은 게임이 두 화면에서 같은 크기로 선다.

   **이름을 대신하지 않는다** — `alt=""`(폴백은 `aria-hidden`)이라 접근 가능한 이름은 옆
   글자에서만 나온다. 표지는 "맞게 골랐나"를 눈으로 한 번 더 확인시키는 보조다: 비슷한 이름의
   다른 게임이 이미 보드에 있을 때 그 차이가 글자보다 그림에서 먼저 보인다. */
function PosterMark({ src, initial }: { src: string | null; initial: string }) {
  if (src) return <img className="sched-picker__poster" src={src} alt="" width={30} height={40} />;
  /* 표지가 없는 게임은 이니셜만. 게임 보드 폴백의 빗금 패턴은 안 가져온다 — 30×40 상자에서
     9px 주기 빗금이 글자를 덮는다(편집기 행 트리거와 같은 근거). */
  return (
    <span className="sched-picker__poster sched-picker__poster--none" aria-hidden="true">
      {initial}
    </span>
  );
}

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
  /* 지금 걸린 게임. 부모가 id 만 넘기므로(patch 가 다루는 값이 id 다) 이름은 여기서 찾는다 —
     `localGames` 는 이번 세션에 새로 추가한 게임까지 포함된 목록이라 방금 만든 게임도 잡힌다. */
  const currentGame =
    currentGameId !== null ? (localGames.find((g) => g.id === currentGameId) ?? null) : null;
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
     비슷한 이름의 다른 게임이 이미 있어도 그 카드를 눈으로 확인하고 지나칠 수 있다.

     **정확히 같은 이름인지는 잘라내기 전의 전체 목록에서 본다**(아래 hasExactLocalMatch) —
     화면에 보여줄 8개로 자른 뒤에 판정하면(첫 판의 실수 — 5라운드 리뷰 지적), 부분 일치가
     8개를 넘고 정확히 같은 이름이 9번째 이후(사전순 정렬이라 흔하다)에 있을 때 "이미 있다"는
     사실 자체를 놓쳐 치지직/직접 추가로 새어 나가고, 직접 추가는 categoryId 가 null 이라 DB
     UNIQUE 제약도 안 걸려 같은 게임이 두 번 생긴다. */
  const exactLocalMatch = useMemo(() => {
    if (query === "") return null;
    const q = query.trim().toLowerCase();
    return localGames.find((g) => g.categoryValue.trim().toLowerCase() === q) ?? null;
  }, [localGames, query]);
  const hasExactLocalMatch = exactLocalMatch !== null;

  /* 정확히 같은 이름은 잘라내기 전에 맨 앞으로 — 부분 일치가 8개를 넘어도 "이미 있는 게임"이
     화면에서 안 보이는 일이 없게 한다(exactLocalMatch 와 같은 이유: 그게 있는데도 안 보이면
     사용자는 그걸 못 고르고 결국 직접 추가로 중복을 만든다). */
  const localMatches = useMemo(() => {
    if (query === "") return [];
    const q = query.toLowerCase();
    return localGames
      .filter((g) => g.categoryValue.toLowerCase().includes(q))
      .sort((a, b) => {
        const aExact = a.categoryValue.trim().toLowerCase() === q ? 0 : 1;
        const bExact = b.categoryValue.trim().toLowerCase() === q ? 0 : 1;
        return aExact - bExact;
      })
      .slice(0, 8);
  }, [localGames, query]);

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

  // searchError 가 있으면 searched 는 여전히 false 다(요청이 결론 없이 실패했으므로) — 그
  // 실패까지 "찾는 중…"으로 읽으면 에러 문구 옆에서 로딩 표시가 영원히 안 풀린다(리뷰 지적,
  // PR #114 7라운드). game-composer.tsx 의 finding 판정과 같은 이유로 같은 예외를 둔다.
  const searching =
    query !== "" &&
    !hasExactLocalMatch &&
    !state.context.searched &&
    state.context.searchError === "";

  return (
    <div className="sched-picker" data-od-id={idPrefix + "picker"}>
      {/* **무엇이 연결돼 있는지 먼저 말한다**(적대적 리뷰 지적, 2026-07-31). 전엔 "연결 해제"
          버튼만 있어서 무엇을 해제하는지가 화면 어디에도 없었다 — 트리거가 아이콘이 되면서
          그 이름을 볼 수 있는 자리가 더 줄었으므로, 해제를 누르기 전에 확인할 곳이 필요하다.
          목록에 없는 게임이면(다른 관리자가 방금 지웠다) 이름 대신 그 사실을 말한다: 여기서
          이름을 지어내면 관리자가 없는 게임을 그대로 두고 넘어간다. */}
      {currentGameId !== null && (
        <div className="sched-picker__current">
          <p className="sched-picker__current-name" data-od-id={idPrefix + "current"}>
            지금 연결: {currentGame?.categoryValue ?? "보드에 없는 게임"}
          </p>
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
        </div>
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
                    <PosterMark src={g.posterImageUrl} initial={g.categoryValue.charAt(0)} />
                    <span className="sched-picker__result-name">{g.categoryValue}</span>
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
                  {/* 이 줄만 표지 자리에 ＋ 를 세운다 — 아직 게임이 아니라 표지가 없고, 빈
                      자리로 두면 아래 결과들과 글자 시작선이 어긋난다. */}
                  <span
                    className="sched-picker__poster sched-picker__poster--new"
                    aria-hidden="true"
                  >
                    +
                  </span>
                  <span className="sched-picker__result-name">‘{query}’ 직접 추가</span>
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
                    <PosterMark src={c.posterImageUrl} initial={c.categoryValue.charAt(0)} />
                    <span className="sched-picker__result-name">{c.categoryValue}</span>
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
