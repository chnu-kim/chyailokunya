/* 게임 추가 컴포저의 상태 기계 — 순수 함수라 React 없이 그대로 검증한다.

   왜 UI 파일에서 빼냈나: 컴포저의 위험은 그리기가 아니라 **단계 사이의 상태 이월**이다.
   "결과 클릭은 선택일 뿐"·"뒤로 가도 결과 목록은 남는다"·"직접 입력은 검색을 돌린 뒤에만"
   — 셋 다 렌더가 아니라 전이 규칙이고, 이 저장소의 테스트 러너는 workerd(DOM 없음)라
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
     없음"이 구분되지 않아, 열자마자 직접 입력 항목이 뜬다. */
  searched: boolean;
  selected: ComposerSelection | null;
  /* 검색 단계의 에러 문구. 리듀서 밖 useState 로 두면 단계 전이와 어긋난다 — 검색 응답을
     기다리는 사이 옛 결과를 눌러 상세로 넘어간 뒤 검색이 실패하면, 검색 실패 문구가 상세의
     에러 자리에 떠 「추가」가 실패한 것처럼 읽힌다. 단계 전이가 리듀서 소관이면 그 단계에
     속한 에러도 리듀서 소관이다.
     서버 뮤테이션(add) 에러는 여기 두지 않는다 — 그건 리듀서가 아는 전이의 산물이 아니라
     상세 단계에 머문 채 재시도하는 별개의 사건이고, 성공하면 컴포저 자체가 닫힌다. */
  searchError: string;
  /* staleDropped("검색어가 바뀌어 앞선 결과를 접었어요 — 다시 검색해 주세요")가 여기 있었다.
     검색이 **타이핑 debounce 로 자동 발사**되면서 그 안내가 거짓말이 됐다: 버림을 일으킨
     queryChanged 자체가 다음 검색을 예약하므로, 사용자가 다시 누를 「검색」이 없고 기다리면
     결과가 온다. 안내가 답하려던 "왜 화면이 비었나"는 이제 '검색 중…' 이 답한다. 취할 조치가
     없는 안내는 화면 어디에 두든 읽는 사람의 시간만 쓴다(보드의 잠긴 칸을 없앤 것과 같은 판단). */
};

export const initialComposerState: ComposerState = {
  query: "",
  results: [],
  searched: false,
  selected: null,
  searchError: "",
};

export type ComposerAction =
  /* 검색 응답 액션은 **무엇을 검색한 요청인가**(query)를 함께 싣는다. 안 실으면 늦게 온
     옛 응답이 현재 화면을 덮는다: "zzz" 제출 → 응답 전 "마인크래프트"로 고쳐 재제출 →
     빠른 3건 뒤 느린 "zzz" 0건이 도착해 목록을 비우고 '마인크래프트 검색 결과가 없어요'
     비상구를 연다. 거기서 직접 입력하면 치지직에 실제로 있는 게임이 categoryId=null 로
     들어가고, NULL 은 UNIQUE 밖이라 서버 CONFLICT 도 이걸 못 막는다. */
  | { type: "queryChanged"; query: string }
  /* 검색 발사. 응답이 아니라 **시작**도 전이다 — 실패 뒤 재시도가 같은 검색어로 오면
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

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case "queryChanged":
      /* 검색어를 고치는 순간 옛 검색어의 결론은 전부 무효다 — 직접 입력 판정(searched)뿐 아니라
         results 도 비운다. 남기면 searchFailed 가 스스로 금지한 "검색어와 무관한 결과가
         화면에 남은" 상태를 queryChanged 가 뒷문으로 만든다. 에러 문구도 옛 검색의 것이다.

         자동 검색이라 이 비움이 타이핑마다 일어나지만, 그게 오히려 계약을 지킨다: **보이는
         목록은 언제나 지금 검색어의 결과**다. 옛 목록을 debounce 동안 남기는 흔한 절충은
         "마인크래프트 결과가 떠 있는데 검색어는 이미 젤다"인 창을 만들고, 그 창에서 클릭하면
         엉뚱한 게임이 붙는다. */
      return { ...state, query: action.query, results: [], searched: false, searchError: "" };

    case "searchStarted":
      return { ...state, searchError: "" };

    case "searchSucceeded":
      if (isStaleSearch(state, action.query)) return state;
      return { ...state, results: action.results, searched: true, searchError: "" };

    case "searchFailed":
      /* 실패한 검색의 이전 결과를 남기면 방금 검색어와 무관한 게임을 붙이게 된다 — 비운다.
         searched 는 세우지 않는다: 통신 실패는 "결과 없음"이 아니라서, 세우면 직접 입력
         항목이 "찾아봤는데 없더라"라고 거짓말하며 열린다. */
      if (isStaleSearch(state, action.query)) return state;
      return { ...state, results: [], searched: false, searchError: action.message };

    case "picked":
      return { ...state, selected: action.selection, searchError: "" };

    case "manualPicked":
      // 직접 입력은 치던 검색어가 그대로 제목이 된다 — 같은 상세 화면에 합류한다.
      return {
        ...state,
        selected: {
          categoryId: null,
          categoryValue: state.query.trim(),
          posterImageUrl: null,
        },
        searchError: "",
      };

    case "back":
      /* results 를 그대로 두어야 잘못 고른 뒤 다시 검색어를 치지 않고 목록에서 옆 항목을
         고를 수 있다. */
      /* searchError 도 함께 비운다 — picked 가 이미 비웠고 상세 단계에선 검색 응답을 통째로
         무시하니 실제로는 늘 빈 값이지만, "검색 단계로 돌아온 화면에 옛 에러가 없다"를
         이 액션 하나로 보장해 두면 나중에 경로가 늘어도 불변식이 안 새어 나간다. */
      return { ...state, selected: null, searchError: "" };
  }
}

// 지금 어느 단계인가. 선택이 곧 단계다 — 별도 step 필드를 두면 둘이 어긋날 수 있다.
export function composerStep(state: ComposerState): "search" | "detail" {
  return state.selected ? "detail" : "search";
}

/* 직접 입력을 **결과 목록의 마지막 항목**으로 열 것인가.

   한때 결과가 0건일 때만 열었다. 근거는 "상시 노출하면 치지직 카테고리보다 쉬운 길이 생겨
   보드가 중복 표기로 갈라진다"였는데, 그 방어가 실제로 막은 건 중복이 아니라 **정당한
   사용자**였다: 검색이 12건을 주는데 그 안에 찾는 게임이 없으면 길이 통째로 막혔다(치지직
   카테고리에 아직 없는 신작·인디가 그렇다).

   그래서 판정을 "결과 0건"에서 **"정확히 같은 이름의 결과가 없다"**로 옮긴다. 콤보박스의
   creatable 패턴이 이 형태로 수렴해 있다(eBay·MUI·react-select 셋이 같은 규칙을 쓴다):
   목록 끝에 `+ '○○' 추가` 한 줄을 붙이되, 이미 그 이름이 목록에 있으면 감춘다. 중복 우려는
   여기서 갚는다 — 정확히 일치하는 정본 카테고리가 보이는데도 굳이 손으로 넣는 경로는
   애초에 안 열린다. 0건일 때 열리던 옛 동작은 이 규칙의 특수한 경우로 그대로 남는다.

   검색 전(searched=false)엔 안 연다 — "아직 안 찾음"과 "찾았는데 없음"은 다르고, 검색을
   안 돌린 채 열면 검색보다 쉬운 길이 되어 옛 근거가 그대로 되살아난다.
   검색어가 비어 있으면 붙일 제목이 없으므로 이때도 닫는다. */
export function showsDirectEntry(state: ComposerState): boolean {
  const q = state.query.trim();
  if (!state.searched || q === "") return false;
  return !state.results.some((c) => equalsGameName(c.categoryValue, q));
}

/* 게임 이름이 "같다"의 판정. 대소문자와 앞뒤 공백만 무시한다 — 사용자가 'minecraft' 를 쳤을 때
   목록의 'Minecraft' 를 같은 것으로 보지 않으면 직접 추가 항목이 정본 카테고리 옆에 나란히
   떠서, 이 규칙이 막으려던 바로 그 중복을 권한다. 그보다 더 뭉개지는 않는다(공백 제거·자모
   정규화): 「리틀 나이트메어」와 「리틀나이트메어2」처럼 실제로 다른 게임을 같다고 접으면
   직접 추가가 조용히 사라져 사용자는 이유를 알 수 없다. */
function equalsGameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
