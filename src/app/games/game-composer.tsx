"use client";

import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import {
  composerActiveOption,
  composerOptionCount,
  composerReducer,
  composerResultIndex,
  composerStep,
  DIRECT_ENTRY_INDEX,
  initialComposerState,
  showsDirectEntry,
  type ComposerActiveMove,
} from "@/core/games-composer";
import type { ChzzkCategory } from "@/core/games";
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

/* 검색 단계는 WAI-ARIA 콤보박스다 — 입력이 combobox, 결과 ul 이 listbox, 각 줄이 option 이고
   **포커스는 입력에 머문 채** aria-activedescendant 만 옮긴다(항목을 button 으로 두면 role 이
   충돌하고 포커스가 목록으로 새어 이어 치던 검색어를 계속 못 친다).

   항목 id 를 치지직이 준 categoryId 가 아니라 **인덱스**로 짓는 이유: 그 값은 외부 API 가
   주는 문자열이라 공백·따옴표가 섞이면 IDREF 가 깨지는데, aria-activedescendant 는 IDREF 라
   깨져도 예외 하나 없이 낭독만 조용해진다. 인덱스가 뜻을 바꾸는 순간은 결과가 갈릴 때뿐이고
   그때 리듀서가 커서를 접는다. 컴포저는 화면에 하나뿐이라(보드가 한 번만 렌더한다) 접두사
   충돌도 없다 — 이미 입력 id 가 같은 규약으로 고정돼 있다. */
const RESULTS_ID = "composer-results";
const INPUT_HINT_ID = "composer-input-hint";
const optionId = (index: number) => "composer-option-" + index;

/* 커서를 옮기는 키. 표로 두는 이유는 분기 하나를 아끼려는 게 아니라, **여기 없는 키는 전부
   입력의 것**이라는 규칙을 한눈에 두려는 것이다 — 콤보박스가 키를 하나 더 가져갈 때마다
   텍스트 편집이 그만큼 불편해진다. 끝에서 순환할지 같은 규칙 자체는 core 가 쥔다. */
const ARROW_MOVES: Partial<Record<string, ComposerActiveMove>> = {
  ArrowDown: "next",
  ArrowUp: "prev",
  Home: "first",
  End: "last",
};

/* 커서가 얹힌 줄에만 붙는 클래스. 결과 줄과 직접 추가 줄이 **같은 표시**를 써야 하므로
   문자열을 두 군데서 짓지 않는다. */
const optionClass = (active: boolean) =>
  active ? "composer__pick composer__pick--active" : "composer__pick";

/* 포커스는 콤보박스 규약상 입력에 머문다. li 는 포커서블이 아니지만, mousedown 의 기본 동작을
   막지 않으면 누르는 순간 입력이 포커스를 잃고(포커스가 dialog 로 떨어진다) 이어 치던 검색어를
   계속 못 친다. click 은 그대로 도니 선택은 막히지 않고, 카드 밖 클릭으로 닫는 셸의 판정도
   그대로다(전파는 안 막는다). */
const keepFocusInInput = (e: React.MouseEvent) => e.preventDefault();

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
  /* 목록에 그려지는 항목 수와 지금 활성인 항목. 둘 다 리듀서 쪽 셀렉터를 쓴다 — 여기서 다시
     세면 화면과 커서가 서로 다른 목록을 보게 된다. */
  const optionCount = composerOptionCount(state);
  const activeOption = composerActiveOption(state);

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

  /* 활성 항목이 스크롤 밖이면 끌어온다. 목록은 카드 본문(.composer__body)이 스크롤하는데
     scroll-behavior:smooth 는 html 에만 걸려 있어 여기선 즉시 이동이다 — 새 애니메이션이
     아니라 감축 가드가 따로 필요 없다. block:"nearest" 라 이미 보이는 항목은 화면을 안 흔든다.
     effect 안에서 상태를 안 건드리므로 set-state-in-effect 에도 안 걸린다. */
  useEffect(() => {
    if (state.activeIndex < 0) return;
    document.getElementById(optionId(state.activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [state.activeIndex]);

  /* 항목을 고른다. **Enter 와 클릭이 같은 함수를 탄다** — 갈라 두면 한쪽만 고쳐진 채로 오래
     간다(키보드 경로는 눈에 안 띄니 늘 그쪽이 남는다). */
  function choose(option: ChzzkCategory | "direct") {
    resetDraft();
    if (option === "direct") {
      dispatch({ type: "manualPicked" });
      return;
    }
    dispatch({
      type: "picked",
      selection: {
        categoryId: option.categoryId,
        categoryValue: option.categoryValue,
        posterImageUrl: option.posterImageUrl,
      },
    });
  }

  /* 검색 입력의 키 조작(콤보박스 규약).

     조합 중(isComposing)엔 통째로 흘려보낸다: 한글은 Enter 로 조합을 확정하고 ↑↓ 로 후보를
     고르는 입력기 위에서 쳐지므로, 그걸 항목 선택으로 읽으면 '마인크래프트'를 확정하려던
     Enter 가 엉뚱한 게임을 붙인다.

     목록이 비어 있을 때도 흘려보낸다 — ↑↓·Home·End 는 원래 캐럿을 옮기는 텍스트 편집 키다.
     가로챌 목록이 없는데 뺏으면 입력이 평범한 텍스트 상자로도 안 굴러간다. */
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;

    if (e.key === "Escape") {
      /* 커서가 있으면 **그것만** 접고 이벤트를 소비한다. 통째로 뺏으면 안 된다 — 이 모달의
         Esc 는 이미 '닫기'로 확립돼 있고(GameDialog 의 onCancel), 커서가 없으면 흘려보내야
         그 뜻이 산다. keydown 의 기본 동작을 막는 것이 곧 dialog 의 close request 를 막는
         길이다(close watcher 는 취소된 keydown 을 안 처리한다).
         흘려보낸 Esc 를 곧장 dialog 가 받는 건 아니다: type=search 라 검색어가 남아 있으면
         UA 가 먼저 값을 비우고, 그러고도 남는 Esc 가 모달을 닫는다(실측). 우리 규칙이 아니라
         UA 동작이라 그대로 두고, 순서는 e2e 가 못박는다. */
      if (state.activeIndex < 0) return;
      e.preventDefault();
      dispatch({ type: "activeMoved", to: "none" });
      return;
    }

    if (e.key === "Enter") {
      // 가리키는 항목이 없으면 아무 일도 안 한다(폼 자체가 submit 을 이미 막는다).
      if (!activeOption) return;
      e.preventDefault();
      choose(activeOption);
      return;
    }

    if (optionCount === 0) return;
    const to = ARROW_MOVES[e.key];
    if (!to) return;
    e.preventDefault();
    dispatch({ type: "activeMoved", to });
  }

  /* 아직 답을 못 받은 검색이 있는가 — **debounce 대기와 요청 중을 하나로 묶는다.** 사용자에겐
     둘이 같은 사건("치고 기다리는 중")이고, 가르면 타이핑이 멈춘 350ms 동안 목록도 안내도 없는
     빈 화면이 스친다. searched·searchError 둘 다 아직 없다는 건 이 검색어의 결론이 안 났다는
     뜻이다(queryChanged 가 둘을 함께 비운다). */
  const finding = query !== "" && !state.searched && state.searchError === "";

  /* 아래 라이브 리전이 읽을 문구. 검색 실패는 여기서 말하지 않는다 — 그건 role="alert" 문단이
     삽입되며 이미 알린다(같은 사실을 두 번 말하는 게 더 나쁘다). 상세 단계에선 비운다:
     화면에 없는 목록을 계속 말하고 있으면 뒤로 돌아왔을 때 다시 알려 줄 변화가 없다. */
  const searchStatus =
    selected || !state.searched
      ? ""
      : state.results.length > 0
        ? `‘${query}’ 검색 결과 ${state.results.length}건이에요.`
        : `‘${query}’ 검색 결과가 없어요. 목록 맨 위에서 직접 추가할 수 있어요.`;

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
              role="combobox"
              // 목록이 실제로 그려질 때만 펼침이다 — 빈 listbox 를 펼쳤다고 말하면 ↓ 를 눌러도
              // 아무 일이 없는 이유를 사용자가 알 길이 없다.
              aria-expanded={optionCount > 0}
              aria-controls={RESULTS_ID}
              aria-autocomplete="list"
              /* 가리키는 항목이 없으면 **속성 자체를 뺀다.** 빈 문자열이나 없는 id 를 남기면
                 AT 는 "가리키는 항목이 있다"고 믿고 그걸 찾다가 입력 낭독까지 조용해진다. */
              aria-activedescendant={
                state.activeIndex >= 0 ? optionId(state.activeIndex) : undefined
              }
              aria-describedby={INPUT_HINT_ID}
              onChange={(e) => dispatch({ type: "queryChanged", query: e.target.value })}
              onKeyDown={onSearchKeyDown}
              data-od-id="composer-input"
            />
            {/* 조작법은 라이브 리전이 아니라 입력의 **설명**으로 단다 — 검색마다 되풀이하면
                그게 소음이고, describedby 는 입력에 포커스가 갈 때 한 번 읽힌다. 눈으로 보는
                사람에겐 커서 표시가 같은 말을 하므로 화면엔 안 낸다. */}
            <p className="sr-only" id={INPUT_HINT_ID}>
              이름을 치면 자동으로 찾아요. 결과가 뜨면 위아래 화살표 키로 고르고 엔터 키로 선택해요.
            </p>
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

          {/* 항목이 li 자체다(안에 button 을 두지 않는다) — listbox 안의 option 이 button 이면
              role 이 충돌하고, 눌러서 포커스가 목록으로 옮겨 가면 "포커스는 입력에 머문다"는
              콤보박스 규약이 그 자리에서 깨진다. 클릭이 계속 도는 건 li 의 onClick 덕이고,
              44 하한은 .composer__pick 이 들고 있던 min-height 가 그대로 li 로 옮겨간 것이다. */}
          <ul
            className="composer__results"
            id={RESULTS_ID}
            role="listbox"
            aria-label="게임 검색 결과"
            data-od-id="composer-results"
          >
            {/* 직접 입력은 이제 **목록 맨 위**다(과제 D) — 검색이 12건을 주면 그 끝까지
                스크롤해야 만나던 자리를, 찾는 게임이 없어서 손으로 넣으려는 사람이 정확히
                그 상황에 있다는 이유로 앞으로 옮겼다. 노출 규칙(정확히 같은 이름이 결과에
                있으면 감춘다)의 정본은 그대로 core.showsDirectEntry — 바뀐 건 자리뿐이다.

                자리가 위계를 못 지므로 이제 문구와 형태가 진다: 라벨이 "찾는 게임이 없다면"
                으로 시작해 이 줄이 정답이 아니라 결과에 없을 때의 길임을 먼저 말하고,
                .composer__pick--direct 의 구분선(games.css)이 실제 결과와 시각으로 가른다.
                그래도 같은 .composer__pick 을 입혀 결과와 같은 종류의 조작(고르면 상세로
                간다)으로 읽히게 한다 — 통째로 다른 부품으로 세우면 "검색이 실패했다"는
                신호가 되어 결과가 멀쩡히 있는데도 사용자를 멈춰 세운다.

                인덱스는 **0**(DIRECT_ENTRY_INDEX, core)이다. 맨 위인데 인덱스가 끝(옛 자리)
                이면 아무것도 안 가리키던 상태에서 ↓ 첫 타가 화면 두 번째 줄(첫 결과)을 잡아
                시각 순서와 키보드 순서가 어긋난다 — 그래서 결과 쪽 인덱스를 아래에서
                core.composerResultIndex 로 한 칸씩 밀었다. 화면과 core 양쪽이 이 두 함수를
                거치지 않고 인덱스를 다시 계산하면 그 순간 커서가 없는 id 를 가리킨다.

                앞에 !finding 가드가 하나 더 있었다. showsDirectEntry 는 searched 를 요구하고
                finding 은 !searched 를 요구하니 둘은 같은 시점에 참일 수 없어 늘 통과하던
                조건이었고, 남겨 두면 "이 줄이 그려지는가"의 답이 두 군데가 되어 리듀서가 세는
                항목 수와 어긋날 여지가 생긴다. */}
            {showsDirectEntry(state) && (
              <li
                className={
                  optionClass(state.activeIndex === DIRECT_ENTRY_INDEX) + " composer__pick--direct"
                }
                id={optionId(DIRECT_ENTRY_INDEX)}
                role="option"
                aria-selected={state.activeIndex === DIRECT_ENTRY_INDEX}
                data-od-id="composer-direct"
                onMouseMove={() => dispatch({ type: "activeSet", index: DIRECT_ENTRY_INDEX })}
                onMouseDown={keepFocusInInput}
                onClick={() => choose("direct")}
              >
                <span className="composer__directmark" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="composer__pickname">찾는 게임이 없다면 ‘{query}’ 직접 추가</span>
              </li>
            )}

            {state.results.map((c, i) => {
              const idx = composerResultIndex(state, i);
              return (
                <li
                  className={optionClass(state.activeIndex === idx)}
                  key={c.categoryId}
                  id={optionId(idx)}
                  role="option"
                  aria-selected={state.activeIndex === idx}
                  onMouseMove={() => dispatch({ type: "activeSet", index: idx })}
                  onMouseDown={keepFocusInInput}
                  onClick={() => choose(c)}
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
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* 단계 전환은 화면이 통째로 바뀌는 사건이라 포커스 이동만으로는 맥락이 안 실린다 —
          보드의 announcement 규약과 같이 한 줄로 알린다. */}
      <p className="sr-only" role="status">
        {selected ? selected.categoryValue + " 선택됨. 추가하려면 확인하세요." : ""}
      </p>

      {/* 검색 결론을 알리는 자리. 자동 검색이라 "검색 버튼을 눌렀다"는 사건이 아예 없어서,
          이게 없으면 결과가 도착한 사실 자체를 눈으로 안 보는 사람은 알 방법이 없다.

          **결론이 난 시점(searched)에만** 말한다 — 타이핑마다 발화하면 그게 소음이고, 진행 중은
          눈에 보이는 '찾는 중…' 문단이 자기 라이브 리전으로 이미 말한다. 둘을 한 노드에 합치면
          서로를 덮어써 결론이 진행 안내에 지워진다. 선택됨 안내와도 나눠 두는 이유가
          같다: 한 노드에 두 사건을 실으면 늦게 온 쪽이 앞의 말을 자른다.

          단계와 무관하게 **늘 마운트해 둔다.** 라이브 리전은 글자가 바뀔 때 발화하는데,
          텍스트를 품은 채 새로 삽입되면 발화를 건너뛰는 리더가 있다 — 검색 단계 안에 두면
          결과가 도착할 때마다 그 함정을 새로 밟는다.

          문구에 검색어를 싣는 이유도 같은 규칙에서 나온다: 글자가 그대로면 아무 말도 안 나가서,
          다른 검색어가 같은 건수를 주면(3건 → 3건) 두 번째 결과는 통째로 조용하다. */}
      <p className="sr-only" role="status" data-od-id="composer-search-status">
        {searchStatus}
      </p>
    </GameDialog>
  );
}
