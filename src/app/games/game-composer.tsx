"use client";

import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import {
  composerReducer,
  composerStep,
  initialComposerState,
  showsManualEntry,
} from "@/core/games-composer";
import type { GameCard } from "@/features/games/service";
import { trpc } from "@/features/trpc/client";
import { readErrorMessage, REQUEST_TIMEOUT_MS, writeErrorMessage } from "./error-message";
import { GameDialog, PlayedDateField } from "./game-dialog";

/* 게임 추가 컴포저(ADR-0015·0017). 두 단계다:

     search  — 치지직 카테고리를 검색한다(서버 인가된 tRPC, creds 는 서버에만).
     detail  — 고른 게임의 포스터·제목을 확인하고 추가한다.

   결과 클릭이 곧 추가였던 한 단계짜리를 나눈 이유: 클릭 한 번이 곧 서버 쓰기면 잘못 고른 걸
   되돌리는 유일한 길이 삭제였다. detail 은 뒤로 갈 수 있고(결과 목록은 그대로 남는다) 그때까지
   서버는 안 건드린다.

   detail 에서 플레이 날짜를 받는다. 한때 이 입력이 사라졌었다 — 플레이 날짜의 정본이 일정으로
   옮겨가며(이슈 #56) 게임 폼에서 뺐는데, 그러자 새 게임에 날짜를 붙이려면 /games 에서 추가한 뒤
   /schedule 로 건너가야 했다. **정본은 그대로 일정에 두고 입구만 되돌린 것이다**: 여기서 넣은
   날짜는 games 컬럼이 아니라 그 날의 일정 항목이 되고, 서버가 게임 행과 **한 batch** 로 함께
   쓴다(service.addGame — 절반만 성공하는 상태가 없다). 클리어는 여전히 추가 뒤 카드에서 붙인다:
   추가하는 순간 이미 깬 게임은 드물어 매번 묻는 값이 낮다.

   단계 사이의 전이 규칙(선택·뒤로·수동 입력 비상구)은 전부 core/games-composer 의 순수 리듀서가
   쥔다 — 이 파일은 그리기와 통신만 한다. 그래야 "뒤로 갔다 다른 게임을 고르면 결과 목록이
   남는가" 같은 전이 버그를 DOM 없이 단위 테스트가 잡는다. */

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
  /* 플레이 날짜(선택). 리듀서가 아니라 여기 사는 이유: 단계 전이 규칙이 아니라 폼 값이라서다.
     대신 단계를 옮기는 두 핸들러(뒤로·다른 게임 선택)가 이 값을 직접 비운다 — effect 로 step
     을 보고 비우면 effect 안 동기 setState 라 set-state-in-effect(Next 16 error)에 걸린다. */
  const [playedDate, setPlayedDate] = useState("");
  /* 닫기 신호와, 닫힌 뒤에 부모에게 넘길 행. 추가 성공 즉시 onAdded 를 부르면 부모가 같은
     커밋에서 컴포저를 언마운트해 닫기 effect 가 아예 안 돌고, 열린 채로 DOM 에서 빠져 포커스가
     body 로 떨어진다. 그래서 성공은 행을 쥐고 신호만 세우고, 실제 인계는 브라우저가 dialog 를
     닫은 뒤 오는 onClose 이벤트에서 한다. */
  const [closing, setClosing] = useState(false);
  const [added, setAdded] = useState<GameCard | null>(null);
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  const { selected } = state;
  const step = composerStep(state);

  /* 단계가 바뀌면 포커스를 그 단계의 첫 조작점으로 옮긴다. 단계를 여는 버튼(결과 항목·뒤로·
     직접 입력)은 전부 **자기 자신을 언마운트**하므로, 안 옮기면 포커스가 dialog 로 떨어져
     키보드·스크린리더 사용자는 화면이 통째로 바뀐 걸 모른 채 Tab 을 처음부터 훑어야 한다.
     보드의 pendingFocus 규약과 같은 취지다.

     마운트 시 검색 입력 포커스도 이 effect 가 겸한다(초기 단계가 search). autoFocus 속성은
     여기서 무효다 — React 는 커밋 시점에 .focus() 를 대신 부르는데 그땐 dialog 가 아직 닫혀
     있어(UA 의 display:none) no-op 이고, 이후 showModal 의 포커스 단계는 autofocus "속성"을
     찾다 못 찾아 첫 포커서블(닫기 버튼)로 떨어진다. */
  useEffect(() => {
    if (step === "detail") submitRef.current?.focus();
    else searchRef.current?.focus();
  }, [step]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    /* 응답에 실어 보낼 검색어는 **제출 순간의 입력값 그대로**(trim 전)여야 한다 — 리듀서가
       state.query 와 문자열 동등으로 비교해 늦게 온 응답을 버리기 때문이다. 서버로 나갈 때만
       trim 한다. */
    const submitted = state.query;
    const q = submitted.trim();
    if (!q) return;
    dispatch({ type: "searchStarted" });
    startSearch(async () => {
      try {
        /* 검색에도 같은 상한을 건다. 여기선 닫기를 안 잠그므로 갇히지는 않지만, 상한이 없으면
           '검색 중…' 이 영영 돌며 「검색」이 disabled 로 남아 재시도조차 못 한다 — 끝나야
           다시 누를 수 있다. */
        const found = await trpc.chzzk.categorySearch.query(
          { query: q, size: 12 },
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        dispatch({ type: "searchSucceeded", query: submitted, results: found });
      } catch (e) {
        dispatch({
          type: "searchFailed",
          query: submitted,
          message: readErrorMessage(e),
        });
      }
    });
  }

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

  return (
    <GameDialog
      title="게임 추가"
      odId="composer"
      closing={closing}
      busy={adding}
      onClose={() => (added ? onAdded(added) : onClose())}
    >
      {selected ? (
        <form className="composer__detail" onSubmit={onAdd}>
          <p className="composer__hint">
            이 게임을 보드에 올릴게요. 클리어 표시는 추가한 뒤 카드에서 붙일 수 있어요.
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
                setAddError("");
                // 고른 게임을 물렸으니 그 게임에 넣던 날짜도 함께 버린다.
                setPlayedDate("");
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
          <p className="composer__hint">게임을 검색합니다.</p>

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

          {state.searchError && (
            <p className="err" role="alert">
              {state.searchError}
            </p>
          )}

          {/* 에러가 아니므로 err 스타일을 안 쓴다 — 통신은 성공했고, 사용자가 스스로 검색어를
              바꿔 결과가 무효가 된 것뿐이다. 모달 바깥은 inert 라 페이지 하단 라이브 영역이
              안 읽히므로 카드 안에서 status 로 말한다. */}
          {state.staleDropped && (
            <p className="composer__hint" role="status" data-od-id="composer-stale">
              검색어가 바뀌어서 앞선 결과는 접었어요 — 다시 검색해 주세요.
            </p>
          )}

          <ul className="composer__results" data-od-id="composer-results">
            {state.results.map((c) => (
              <li key={c.categoryId}>
                <button
                  className="composer__pick"
                  type="button"
                  onClick={() => {
                    // 다른 게임을 고르면 앞 게임에 넣던 날짜가 따라오면 안 된다.
                    setPlayedDate("");
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
        {selected ? selected.categoryValue + " 선택됨. 추가하려면 확인하세요." : ""}
      </p>
    </GameDialog>
  );
}
