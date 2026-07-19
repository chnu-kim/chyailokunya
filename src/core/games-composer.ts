/* 게임 추가 컴포저의 상태 기계 — 순수 함수라 React 없이 그대로 검증한다.

   왜 UI 파일에서 빼냈나: 컴포저의 위험은 그리기가 아니라 **단계 사이의 상태 이월**이다.
   "결과 클릭은 선택일 뿐"·"뒤로 가도 결과 목록은 남는다"·"수동 입력 비상구는 결과 0건일
   때만"·"선택이 바뀌면 날짜는 따라오지 않는다" — 넷 다 렌더가 아니라 전이 규칙이고, 이
   저장소의 테스트 러너는 workerd(DOM 없음)라 전이를 컴포넌트째로는 못 잡는다. 전이만
   순수 모듈로 내리면 기존 게이트가 그대로 회귀를 막는다(ADR-0010 의 JIT 추상화).

   컴포저는 한 번 마운트된 채 여러 게임을 거치는 유일한 화면이다 — 날짜 수정 모달은 editing
   이 null 을 거쳐 매번 리마운트되므로 이월이 구조적으로 불가능하다. 그 차이가 이 파일의
   존재 이유다. */

import type { ChzzkCategory } from "./games";

// 고른 게임. categoryId 가 null 이면 치지직 검색에 없어 손으로 넣은 게임이다.
export type ComposerSelection = {
  categoryId: string | null;
  categoryValue: string;
  posterImageUrl: string | null;
};

export type DatePair = { playedAt: string; clearedAt: string };

/* 빈 날짜 한 쌍. "모름"의 표현은 빈 문자열 하나뿐이어야 한다 — 서버 dateInput 이 이걸
   null 로 접는다(중복 정규화 금지). */
export const EMPTY_DATES: DatePair = { playedAt: "", clearedAt: "" };

export type ComposerState = {
  query: string;
  results: ChzzkCategory[];
  /* 검색을 한 번이라도 돌렸는가. results.length === 0 만으로는 "아직 안 찾음"과 "찾았는데
     없음"이 구분되지 않아, 열자마자 수동 입력 비상구가 뜬다. */
  searched: boolean;
  selected: ComposerSelection | null;
  dates: DatePair;
};

export const initialComposerState: ComposerState = {
  query: "",
  results: [],
  searched: false,
  selected: null,
  dates: EMPTY_DATES,
};

export type ComposerAction =
  | { type: "queryChanged"; query: string }
  | { type: "searchSucceeded"; results: ChzzkCategory[] }
  | { type: "searchFailed" }
  | { type: "picked"; selection: ComposerSelection }
  | { type: "manualPicked" }
  | { type: "datesChanged"; dates: DatePair }
  | { type: "back" };

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case "queryChanged":
      // 검색어를 고치는 순간 "결과 없음"은 옛 검색어의 결론이다 — 비상구를 접는다.
      return { ...state, query: action.query, searched: false };

    case "searchSucceeded":
      return { ...state, results: action.results, searched: true };

    case "searchFailed":
      /* 실패한 검색의 이전 결과를 남기면 방금 검색어와 무관한 게임을 붙이게 된다 — 비운다.
         searched 는 세우지 않는다: 통신 실패는 "결과 없음"이 아니라서, 세우면 수동 입력
         비상구가 "찾아봤는데 없더라"라고 거짓말하며 열린다. */
      return { ...state, results: [], searched: false };

    case "picked":
      /* 선택이 바뀌면 날짜는 **반드시** 초기화한다. 컴포저는 한 번 마운트된 채 뒤로/선택을
         오가므로, 안 비우면 게임 A 에 넣은 날짜가 게임 B 의 상세 화면에 그대로 남는다 —
         포스터·제목만 바뀌고 날짜는 이미 시선이 지나간 자리라, 그대로 「추가」를 누르면
         B 가 A 의 날짜로 저장된다. 서버 Zod 는 형식·순서만 보므로 통과하고, 틀린 날짜가
         보드 정렬까지 바꾼다. 같은 게임을 다시 고른 경우까지 한 규칙으로 덮으려고
         "뒤로"가 아니라 여기서 비운다. */
      return { ...state, selected: action.selection, dates: EMPTY_DATES };

    case "manualPicked":
      // 수동 입력은 치던 검색어가 그대로 제목이 된다 — 같은 상세 화면에 합류한다.
      return {
        ...state,
        selected: {
          categoryId: null,
          categoryValue: state.query.trim(),
          posterImageUrl: null,
        },
        dates: EMPTY_DATES,
      };

    case "datesChanged":
      return { ...state, dates: action.dates };

    case "back":
      /* results 를 그대로 두어야 잘못 고른 뒤 다시 검색어를 치지 않고 목록에서 옆 항목을
         고를 수 있다. 날짜도 여기서 비운다 — picked 가 어차피 다시 비우지만, 뒤로 간
         상태에서 화면에 남은 값이 없어야 "이건 아직 아무 게임의 날짜도 아니다"가 참이다. */
      return { ...state, selected: null, dates: EMPTY_DATES };
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
