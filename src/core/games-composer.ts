/* 게임 추가 컴포저의 상태 기계 — 순수 함수라 React 없이 그대로 검증한다.

   왜 UI 파일에서 빼냈나: 컴포저의 위험은 그리기가 아니라 **단계 사이의 상태 이월**이다.
   "결과 클릭은 선택일 뿐"·"뒤로 가도 결과 목록은 남는다"·"수동 입력 비상구는 결과 0건일
   때만" — 셋 다 렌더가 아니라 전이 규칙이고, 이 저장소의 테스트 러너는 workerd(DOM 없음)라
   전이를 컴포넌트째로는 못 잡는다. 전이만 순수 모듈로 내리면 기존 게이트가 그대로 회귀를
   막는다(ADR-0010 의 JIT 추상화).

   한때 이 리듀서의 핵심 위험은 **날짜 이월**이었다("게임 A 에 넣은 날짜가 B 의 상세에 남는다").
   플레이 날짜가 일정 정본으로 옮겨가며(이슈 #56) 컴포저의 날짜 단계가 사라져 그 위험째 없어졌다
   — 이제 상세 단계는 고른 게임을 확인하고 추가하는 자리일 뿐이고, 클리어는 추가 뒤 편집 모달에서
   붙인다. 남은 이월 규칙은 선택·결과·비상구 셋이다. */

import type { ChzzkCategory } from "./games";

// 고른 게임. categoryId 가 null 이면 치지직 검색에 없어 손으로 넣은 게임이다.
export type ComposerSelection = {
  categoryId: string | null;
  categoryValue: string;
  posterImageUrl: string | null;
};

export type ComposerState = {
  query: string;
  results: ChzzkCategory[];
  /* 검색을 한 번이라도 돌렸는가. results.length === 0 만으로는 "아직 안 찾음"과 "찾았는데
     없음"이 구분되지 않아, 열자마자 수동 입력 비상구가 뜬다. */
  searched: boolean;
  selected: ComposerSelection | null;
  /* 검색 단계의 에러 문구. 리듀서 밖 useState 로 두면 단계 전이와 어긋난다 — 검색 응답을
     기다리는 사이 옛 결과를 눌러 상세로 넘어간 뒤 검색이 실패하면, 검색 실패 문구가 상세의
     에러 자리에 떠 「추가」가 실패한 것처럼 읽힌다. 단계 전이가 리듀서 소관이면 그 단계에
     속한 에러도 리듀서 소관이다.
     서버 뮤테이션(add) 에러는 여기 두지 않는다 — 그건 리듀서가 아는 전이의 산물이 아니라
     상세 단계에 머문 채 재시도하는 별개의 사건이고, 성공하면 컴포저 자체가 닫힌다. */
  searchError: string;
  /* 검색어가 바뀌어 응답을 버렸는가. 버리는 것 자체는 옳지만(늦게 온 옛 응답이 화면을 덮으면
     안 된다), 아무 흔적도 안 남기면 화면엔 목록도 에러도 없는 빈 상태만 남아 사용자가 "왜
     아무것도 안 나왔지"를 알 방법이 없다 — 「검색」을 다시 눌러야 한다는 걸 이 플래그가 말한다.
     에러가 아니라 안내다(통신은 성공했고, 사용자가 스스로 검색어를 바꾼 결과다). */
  staleDropped: boolean;
};

export const initialComposerState: ComposerState = {
  query: "",
  results: [],
  searched: false,
  selected: null,
  searchError: "",
  staleDropped: false,
};

export type ComposerAction =
  /* 검색 응답 액션은 **무엇을 검색한 요청인가**(query)를 함께 싣는다. 안 실으면 늦게 온
     옛 응답이 현재 화면을 덮는다: "zzz" 제출 → 응답 전 "마인크래프트"로 고쳐 재제출 →
     빠른 3건 뒤 느린 "zzz" 0건이 도착해 목록을 비우고 '마인크래프트 검색 결과가 없어요'
     비상구를 연다. 거기서 직접 입력하면 치지직에 실제로 있는 게임이 categoryId=null 로
     들어가고, NULL 은 UNIQUE 밖이라 서버 CONFLICT 도 이걸 못 막는다. */
  | { type: "queryChanged"; query: string }
  /* 검색 제출. 응답이 아니라 **시작**도 전이다 — 같은 검색어로 「검색」을 다시 누르면
     queryChanged 가 안 오므로 이 액션이 없으면 옛 실패 문구가 안 지워져, 응답이 올 때까지
     '검색 중…' 과 '검색에 실패했어요' 가 한 화면에 공존한다. */
  | { type: "searchStarted" }
  | { type: "searchSucceeded"; query: string; results: ChzzkCategory[] }
  | { type: "searchFailed"; query: string; message: string }
  | { type: "picked"; selection: ComposerSelection }
  | { type: "manualPicked" }
  | { type: "back" };

/* 이 검색 응답을 버려야 하는가. 둘 중 하나면 버린다:
   - 응답이 답한 검색어가 지금 입력창의 검색어와 다르다(늦게 온 옛 응답).
   - 사용자가 이미 상세 단계로 갔다 — 그 화면엔 검색 결과도, 검색 에러도 낄 자리가 없다.
     (뒤로 돌아오면 검색어는 그대로 남아 있으니 다시 검색하면 된다.) */
function isStaleSearch(state: ComposerState, query: string): boolean {
  return state.selected !== null || query !== state.query;
}

/* 버렸다는 걸 화면에 남길 것인가. **검색어가 어긋나서** 버린 경우만이다 — 상세 단계에서
   버린 건 사용자가 이미 다음 화면으로 넘어간 것이라 알릴 자리도 이유도 없고, 뒤로 돌아오면
   결과 목록이 그대로 있어 빈 화면 문제 자체가 없다. */
function droppedByQueryChange(state: ComposerState, query: string): boolean {
  return state.selected === null && query !== state.query;
}

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case "queryChanged":
      /* 검색어를 고치는 순간 옛 검색어의 결론은 전부 무효다 — 비상구(searched)뿐 아니라
         results 도 비운다. 남기면 searchFailed 가 스스로 금지한 "검색어와 무관한 결과가
         화면에 남은" 상태를 queryChanged 가 뒷문으로 만든다. 에러 문구도 옛 검색의 것이다. */
      /* staleDropped 는 여기서 안 지운다 — 이 액션이야말로 버림을 **일으키는** 쪽이고,
         "검색어가 바뀌었으니 다시 검색해라"는 안내는 검색어를 더 고쳐도 여전히 참이다.
         지우는 건 실제로 그 상태를 벗어나는 전이(재검색·선택·뒤로)뿐이다. */
      return { ...state, query: action.query, results: [], searched: false, searchError: "" };

    case "searchStarted":
      return { ...state, searchError: "", staleDropped: false };

    case "searchSucceeded":
      if (isStaleSearch(state, action.query))
        return droppedByQueryChange(state, action.query) ? { ...state, staleDropped: true } : state;
      /* 답이 도착한 순간 "버려서 비었다"는 거짓이 된다 — searchStarted 가 이미 걷었지만,
         전이 하나만 봐도 상태가 모순이 아니게 여기서도 내린다. */
      return {
        ...state,
        results: action.results,
        searched: true,
        searchError: "",
        staleDropped: false,
      };

    case "searchFailed":
      /* 실패한 검색의 이전 결과를 남기면 방금 검색어와 무관한 게임을 붙이게 된다 — 비운다.
         searched 는 세우지 않는다: 통신 실패는 "결과 없음"이 아니라서, 세우면 수동 입력
         비상구가 "찾아봤는데 없더라"라고 거짓말하며 열린다. */
      if (isStaleSearch(state, action.query))
        return droppedByQueryChange(state, action.query) ? { ...state, staleDropped: true } : state;
      // 에러 문구가 섰으면 안내는 물러난다 — 한 화면에 이유가 둘이면 어느 쪽도 안 읽힌다.
      return {
        ...state,
        results: [],
        searched: false,
        searchError: action.message,
        staleDropped: false,
      };

    case "picked":
      return {
        ...state,
        selected: action.selection,
        searchError: "",
        staleDropped: false,
      };

    case "manualPicked":
      // 수동 입력은 치던 검색어가 그대로 제목이 된다 — 같은 상세 화면에 합류한다.
      return {
        ...state,
        selected: {
          categoryId: null,
          categoryValue: state.query.trim(),
          posterImageUrl: null,
        },
        searchError: "",
        staleDropped: false,
      };

    case "back":
      /* results 를 그대로 두어야 잘못 고른 뒤 다시 검색어를 치지 않고 목록에서 옆 항목을
         고를 수 있다. */
      /* searchError 도 함께 비운다 — picked 가 이미 비웠고 상세 단계에선 검색 응답을 통째로
         무시하니 실제로는 늘 빈 값이지만, "검색 단계로 돌아온 화면에 옛 에러가 없다"를
         이 액션 하나로 보장해 두면 나중에 경로가 늘어도 불변식이 안 새어 나간다. */
      /* staleDropped 도 비운다 — 뒤로 돌아온 화면엔 results 가 그대로 있어 "버려서 비었다"가
         거짓이 된다(안내가 있는 목록은 서로 모순이다). */
      return {
        ...state,
        selected: null,
        searchError: "",
        staleDropped: false,
      };
  }
}

// 지금 어느 단계인가. 선택이 곧 단계다 — 별도 step 필드를 두면 둘이 어긋날 수 있다.
export function composerStep(state: ComposerState): "search" | "detail" {
  return state.selected ? "detail" : "search";
}

/* 수동 입력 비상구는 **검색 결과가 0건일 때만** 연다. 상시 노출하면 치지직 카테고리
   (=categoryId 가 있는 정본 게임)보다 쉬운 길이 생겨 보드가 중복 표기로 갈라진다.
   검색어가 비어 있으면 붙일 제목이 없으므로 이때도 닫는다. */
export function showsManualEntry(state: ComposerState): boolean {
  return state.searched && state.results.length === 0 && state.query.trim() !== "";
}
