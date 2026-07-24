"use client";

import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import {
  composerReducer,
  composerStep,
  initialComposerState,
  showsDirectEntry,
} from "@/core/games-composer";
import type { GameCard } from "@/features/games/service";
import { trpc } from "@/features/trpc/client";
import { readErrorMessage, REQUEST_TIMEOUT_MS, writeErrorMessage } from "./error-message";
import { ClearedFields, GameDialog, PlayedDateField, useClearedDraft } from "./game-dialog";

/* 게임 추가 컴포저(ADR-0015·0017). 두 단계다:

     search  — 치지직 카테고리를 검색한다(서버 인가된 tRPC, creds 는 서버에만).
     detail  — 고른 게임을 확인하고 플레이 날짜·클리어를 붙여 추가한다.

   결과 클릭이 곧 추가였던 한 단계짜리를 나눈 이유: 클릭 한 번이 곧 서버 쓰기면 잘못 고른 걸
   되돌리는 유일한 길이 삭제였다. detail 은 뒤로 갈 수 있고(결과 목록은 그대로 남는다) 그때까지
   서버는 안 건드린다.

   detail 에서 날짜와 클리어를 함께 받는다. 둘 다 한때 여기 없었고 근거도 같았다 — "정본이
   다른 데 있다"(날짜는 일정), "추가하는 순간엔 드물다"(클리어). **둘 다 왕복 비용으로 갚았다**:
   /games 에서 추가한 뒤 /schedule 로 건너가거나, 추가한 뒤 카드를 다시 열어야 했다. 여긴
   이미 한 방송을 기록하는 보드라 소급 입력이 정상 경로다. 정본은 그대로 두고 입구만 되돌린
   것이라, 여기서 넣은 날짜는 games 컬럼이 아니라 그 날의 일정 항목이 되고 서버가 게임 행과
   **한 batch** 로 함께 쓴다(service.addGame — 절반만 성공하는 상태가 없다).

   검색은 **타이핑이 멈추면 자동으로** 나간다(SEARCH_DEBOUNCE_MS). 「검색」 버튼이 있던 앞 판은
   조작이 한 단계 더 있었고, 그 단계가 안 보여서 사용자는 입력만 하고 결과를 기다렸다.

   단계 사이의 전이 규칙(선택·뒤로·직접 입력)은 전부 core/games-composer 의 순수 리듀서가
   쥔다 — 이 파일은 그리기와 통신만 한다. 그래야 "뒤로 갔다 다른 게임을 고르면 결과 목록이
   남는가" 같은 전이 버그를 DOM 없이 단위 테스트가 잡는다. */

/* 타이핑이 멈춘 걸로 치는 시간. 한글은 조합 중에도 input 이 발화해 자모 단위로 요청이 나갈
   수 있어(‘ㅁ’→‘마’→‘마ㅇ’…) 너무 짧으면 쓸모없는 검색이 쌓이고, 길면 결과가 굼떠 보인다.
   350 은 그 사이의 흔한 값이다 — 사람이 한 글자를 더 칠지 결정하는 시간보다 살짝 길다. */
const SEARCH_DEBOUNCE_MS = 350;

export function GameComposer({
  onAdded,
  onClose,
}: {
  onAdded: (row: GameCard) => void;
  onClose: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [state, dispatch] = useReducer(composerReducer, initialComposerState);
  /* 상세 단계의 서버 쓰기 에러만 여기 든다. 검색 에러(state.searchError)는 리듀서 소관이다 —
     응답이 늦게 도착할 때 어느 단계에 속한 문구인지 판단하는 건 전이 규칙이라서. */
  const [addError, setAddError] = useState("");
  /* 플레이 날짜·클리어(둘 다 선택). 리듀서가 아니라 여기 사는 이유: 단계 전이 규칙이 아니라
     폼 값이라서다. 대신 단계를 옮기는 두 핸들러(뒤로·다른 게임 선택)가 이 값을 직접 비운다 —
     effect 로 step 을 보고 비우면 effect 안 동기 setState 라 set-state-in-effect(Next 16
     error)에 걸린다. */
  const [playedDate, setPlayedDate] = useState("");
  const { draft, setDraft } = useClearedDraft({ cleared: false, clearedDate: "" });
  /* 닫기 신호와, 닫힌 뒤에 부모에게 넘길 행. 추가 성공 즉시 onAdded 를 부르면 부모가 같은
     커밋에서 컴포저를 언마운트해 닫기 effect 가 아예 안 돌고, 열린 채로 DOM 에서 빠져 포커스가
     body 로 떨어진다. 그래서 성공은 행을 쥐고 신호만 세우고, 실제 인계는 브라우저가 dialog 를
     닫은 뒤 오는 onClose 이벤트에서 한다. */
  const [closing, setClosing] = useState(false);
  const [added, setAdded] = useState<GameCard | null>(null);
  const [adding, startAdd] = useTransition();

  const { selected } = state;
  const step = composerStep(state);
  const query = state.query.trim();

  /* 단계가 바뀌면 포커스를 그 단계의 첫 조작점으로 옮긴다. 단계를 여는 버튼(결과 항목·뒤로·
     직접 입력)은 전부 **자기 자신을 언마운트**하므로, 안 옮기면 포커스가 dialog 로 떨어져
     키보드·스크린리더 사용자는 화면이 통째로 바뀐 걸 모른 채 Tab 을 처음부터 훑어야 한다.

     마운트 시 검색 입력 포커스도 이 effect 가 겸한다(초기 단계가 search). autoFocus 속성은
     여기서 무효다 — React 는 커밋 시점에 .focus() 를 대신 부르는데 그땐 dialog 가 아직 닫혀
     있어(UA 의 display:none) no-op 이고, 이후 showModal 의 포커스 단계는 autofocus "속성"을
     찾다 못 찾아 첫 포커서블(닫기 버튼)로 떨어진다. */
  useEffect(() => {
    if (step === "detail") submitRef.current?.focus();
    else searchRef.current?.focus();
  }, [step]);

  /* 검색 발사. 응답에 실어 보낼 검색어는 **제출 순간의 입력값 그대로**(trim 전)여야 한다 —
     리듀서가 state.query 와 문자열 동등으로 비교해 늦게 온 응답을 버리기 때문이다. 서버로
     나갈 때만 trim 한다. */
  async function runSearch(submitted: string) {
    const q = submitted.trim();
    if (!q) return;
    dispatch({ type: "searchStarted" });
    try {
      /* 상한이 없으면 응답이 영영 안 와도 화면이 '찾는 중…' 에 굳는다 — 실패로 떨어져야
         사용자가 검색어를 고쳐 다시 시도할 수 있다. */
      const found = await trpc.chzzk.categorySearch.query(
        { query: q, size: 12 },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      dispatch({ type: "searchSucceeded", query: submitted, results: found });
    } catch (e) {
      dispatch({ type: "searchFailed", query: submitted, message: readErrorMessage(e) });
    }
  }

  /* 타이핑이 멈추면 자동으로 검색한다. 의존성이 state.query 라 한 글자마다 타이머가 새로
     걸리고 앞 타이머는 cleanup 이 지운다 — 그게 debounce 다.

     effect 안에서 **동기로** 상태를 건드리지 않는다(setTimeout 콜백 안이라 Next 16 의
     set-state-in-effect 에 안 걸린다). 상세 단계(selected)에선 안 돈다: 그 화면엔 결과 목록이
     낄 자리가 없고, 리듀서도 그 응답을 통째로 버린다. */
  useEffect(() => {
    if (!query || selected) return;
    const timer = setTimeout(() => void runSearch(state.query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    /* query 는 state.query 의 파생값이라 배열에 안 싣는다. runSearch 도 안 싣는다 — 매 렌더
       새로 만들어지지만 읽는 건 인자로 들어오는 검색어뿐이고, 실으면 타이머가 매 렌더 새로
       걸려 debounce 가 통째로 죽는다. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.query, selected]);

  /* 아직 답을 못 받은 검색이 있는가 — **debounce 대기와 요청 중을 하나로 묶는다.** 사용자에겐
     둘이 같은 사건("치고 기다리는 중")이고, 가르면 타이핑이 멈춘 350ms 동안 목록도 안내도 없는
     빈 화면이 스친다. searched·searchError 둘 다 아직 없다는 건 이 검색어의 결론이 안 났다는
     뜻이다(queryChanged 가 둘을 함께 비운다). */
  const finding = query !== "" && !state.searched && state.searchError === "";

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    startAdd(async () => {
      setAddError("");
      try {
        // 필드를 그대로 옮길 뿐 여기서 trim·empty→null 을 다시 하지 않는다 — 그 정규화의
        // 정본은 games.add 뮤테이션의 addGameInput(Zod) 하나다(중복 정규화 금지).
        const row = await trpc.games.add.mutate(
          {
            categoryId: selected.categoryId,
            categoryType: "GAME",
            categoryValue: selected.categoryValue,
            posterImageUrl: selected.posterImageUrl,
            playedDate,
            cleared: draft.cleared,
            clearedDate: draft.clearedDate,
          },
          // 상한이 없으면 busy 가 안 풀려 닫기 잠금에 갇힌다(REQUEST_TIMEOUT_MS 주석).
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        setAdded(row);
        setClosing(true);
      } catch (e) {
        setAddError(writeErrorMessage(e));
      }
    });
  }

  // 고르던 게임을 물릴 때 그 게임에 넣던 값도 함께 버린다(다음 게임에 따라가면 안 된다).
  function resetDraft() {
    setPlayedDate("");
    setDraft({ cleared: false, clearedDate: "" });
    setAddError("");
  }

  return (
    <GameDialog
      title="게임 추가"
      odId="composer"
      closing={closing}
      busy={adding}
      /* 상세 단계에 들어온 것 자체를 "잃을 작업"으로 본다 — 검색해서 고르기까지가 이미 한 벌의
         조작이고, 배경을 잘못 스쳐 그게 날아가면 처음부터 다시다. 검색 단계는 안 묻는다:
         거기서 잃는 건 검색어 한 줄이고, 매번 되묻으면 그냥 닫으려는 사람에게 문이 하나 더 는다. */
      dirty={selected !== null}
      onClose={() => (added ? onAdded(added) : onClose())}
    >
      {selected ? (
        <form className="composer__detail" onSubmit={onAdd}>
          <p className="composer__hint">
            날짜와 클리어는 몰라도 괜찮아요 — 비워 두고 나중에 카드에서 채울 수 있어요.
          </p>

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

          {/* 새 게임이라 일정 항목이 있을 수 없다 — 빈 배열을 넘겨 잠금 분기를 끈다(조회 불필요). */}
          <PlayedDateField
            value={playedDate}
            onChange={setPlayedDate}
            idPrefix="composer"
            dates={[]}
            disabled={adding}
          />

          <ClearedFields
            draft={draft}
            onChange={setDraft}
            idPrefix="composer-clear"
            disabled={adding}
          />

          {addError && (
            <p className="err" role="alert">
              {addError}
            </p>
          )}

          <div className="composer__actions">
            <button
              className="btn btn--secondary composer__btn"
              type="button"
              data-od-id="composer-back"
              // 쓰기가 날아가는 동안은 뒤로도 막는다 — 닫기와 같은 인계 경쟁이다(GameDialog 주석).
              disabled={adding}
              onClick={() => {
                dispatch({ type: "back" });
                resetDraft();
              }}
            >
              뒤로
            </button>
            <button
              className="btn btn--primary composer__btn"
              type="submit"
              ref={submitRef}
              disabled={adding}
              data-od-id="composer-submit"
            >
              {adding ? "추가 중…" : "추가"}
            </button>
          </div>
        </form>
      ) : (
        <>
          {/* 자동 검색이라 「검색」 버튼이 없다 — 입력 하나가 이 단계의 전부다. 그래서 무엇을
              치면 되는지는 placeholder 가 아니라 라벨이 말해야 한다(placeholder 는 글자를
              치는 순간 사라져 도움이 필요한 시점에 없다). */}
          <form className="composer__search" onSubmit={(e) => e.preventDefault()}>
            <label className="composer__searchlabel" htmlFor="composer-input">
              게임 이름
            </label>
            <input
              className="field"
              type="search"
              id="composer-input"
              placeholder="예) 마인크래프트"
              value={state.query}
              ref={searchRef}
              autoComplete="off"
              onChange={(e) => dispatch({ type: "queryChanged", query: e.target.value })}
              data-od-id="composer-input"
            />
          </form>

          {state.searchError && (
            <p className="err" role="alert">
              {state.searchError}
            </p>
          )}

          {/* 검색어를 치기 전 자리. 빈 채로 두면 카드가 입력 한 줄짜리로 쪼그라들어 "여기서
              뭘 하는 화면인지"가 안 읽힌다 — 이 단계가 무엇을 하는지와, 못 찾았을 때의 길을
              미리 말해 둔다. */}
          {query === "" && (
            <p className="composer__hint" data-od-id="composer-empty">
              치지직 카테고리에서 찾아 붙여요. 목록에 없는 게임도 직접 넣을 수 있어요.
            </p>
          )}

          {finding && (
            <p className="composer__hint" role="status" data-od-id="composer-finding">
              찾는 중…
            </p>
          )}

          <ul className="composer__results" data-od-id="composer-results">
            {state.results.map((c) => (
              <li key={c.categoryId}>
                <button
                  className="composer__pick"
                  type="button"
                  onClick={() => {
                    resetDraft();
                    dispatch({
                      type: "picked",
                      selection: {
                        categoryId: c.categoryId,
                        categoryValue: c.categoryValue,
                        posterImageUrl: c.posterImageUrl,
                      },
                    });
                  }}
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

            {/* 직접 입력은 **목록의 마지막 항목**이다 — 결과와 같은 종류의 조작(고르면 상세로
                간다)이라 다른 부품으로 세우면 "검색이 실패했다"는 신호로 읽힌다. 결과가 0건이면
                이 항목만 남아 옛 비상구와 같은 화면이 된다. 노출 규칙(정확히 같은 이름이 결과에
                있으면 감춘다)의 정본은 core.showsDirectEntry. */}
            {!finding && showsDirectEntry(state) && (
              <li>
                <button
                  className="composer__pick composer__pick--direct"
                  type="button"
                  data-od-id="composer-direct"
                  onClick={() => {
                    resetDraft();
                    dispatch({ type: "manualPicked" });
                  }}
                >
                  <span className="composer__directmark" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="composer__pickname">‘{query}’ 직접 추가</span>
                </button>
              </li>
            )}
          </ul>
        </>
      )}

      {/* 단계 전환은 화면이 통째로 바뀌는 사건이라 포커스 이동만으로는 맥락이 안 실린다 —
          보드의 announcement 규약과 같이 한 줄로 알린다. */}
      <p className="sr-only" role="status">
        {selected ? selected.categoryValue + " 선택됨. 추가하려면 확인하세요." : ""}
      </p>
    </GameDialog>
  );
}
