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
     없음"이 구분되지 않아, 열자마자 직접 입력 항목이 뜬다.
     읽는 방법이 하나 더 있다 — **지금 검색어의 결론이 났는가.** 이 값을 세우는 건
     searchSucceeded 하나뿐이고 queryChanged·searchFailed 가 즉시 되접으므로, 참이면 화면의
     목록이 곧 지금 검색어의 결과다. 아래 composerNeedsSearch 가 그 불변식 위에 선다. */
  searched: boolean;
  selected: ComposerSelection | null;
  /* 검색 단계의 에러 문구. 리듀서 밖 useState 로 두면 단계 전이와 어긋난다 — 검색 응답을
     기다리는 사이 옛 결과를 눌러 상세로 넘어간 뒤 검색이 실패하면, 검색 실패 문구가 상세의
     에러 자리에 떠 「추가」가 실패한 것처럼 읽힌다. 단계 전이가 리듀서 소관이면 그 단계에
     속한 에러도 리듀서 소관이다.
     서버 뮤테이션(add) 에러는 여기 두지 않는다 — 그건 리듀서가 아는 전이의 산물이 아니라
     상세 단계에 머문 채 재시도하는 별개의 사건이고, 성공하면 컴포저 자체가 닫힌다. */
  searchError: string;
  /* staleDropped("검색어가 바뀌어 앞선 결과를 접었습니다 — 다시 검색해 주십시오")가 여기 있었다.
     검색이 **타이핑 debounce 로 자동 발사**되면서 그 안내가 거짓말이 됐다: 버림을 일으킨
     queryChanged 자체가 다음 검색을 예약하므로, 사용자가 다시 누를 「검색」이 없고 기다리면
     결과가 온다. 안내가 답하려던 "왜 화면이 비었나"는 이제 '검색 중…' 이 답한다. 취할 조치가
     없는 안내는 화면 어디에 두든 읽는 사람의 시간만 쓴다(보드의 잠긴 칸을 없앤 것과 같은 판단). */
  /* 결과 목록에서 지금 활성인 항목의 인덱스(콤보박스의 키보드 커서). -1 = 없음.
     포커스가 아니라 인덱스인 이유: WAI-ARIA 콤보박스는 포커스를 **입력에 묶어 둔 채**
     aria-activedescendant 로만 커서를 옮긴다. 항목으로 포커스를 옮기면 그 순간 입력이
     포커스를 잃어 이어 치던 검색어를 계속 못 친다.

     왜 컴포넌트 useState 가 아니라 리듀서인가: 이 값의 위험은 그리기가 아니라 **결과가
     바뀌었는데 커서가 안 따라오는 것**이다 — 3번째를 가리킨 채 결과가 1건으로 줄면
     aria-activedescendant 가 DOM 에 없는 id 를 가리키고, IDREF 라 틀려도 예외 하나 없이
     낭독만 조용해진다. 그건 액션마다의 이월 규칙이라 이 리듀서 소관이고, 그래야 DOM 없는
     러너에서도 회귀가 잡힌다. 순수 폼 값(플레이 날짜·클리어)이 컴포넌트에 남는 것과
     갈리는 지점이 여기다 — 저건 단계와 무관하고, 이건 단계·결과가 바뀔 때마다 접힌다. */
  activeIndex: number;
};

export const initialComposerState: ComposerState = {
  query: "",
  results: [],
  searched: false,
  selected: null,
  searchError: "",
  activeIndex: -1,
};

/* 검색어가 채워진 채로 여는 초기 상태. 관리자가 팬의 **추가 요청을 반영**할 때 그 이름으로
   컴포저를 여는 자리에 쓴다(ADR-0025) — 요청은 자유 이름이라 정본 카테고리를 여기서 고른다.

   query 만 채우면 끝인 게 핵심이다: searched 가 거짓이라 composerNeedsSearch 가 곧바로 참이 되고,
   컴포넌트의 debounce effect 가 평소 경로 그대로 검색을 발사한다. "열자마자 한 번 검색" 같은
   별도 배선을 만들면 그 경로만 늦게 온 응답을 버리는 규칙(searchSucceeded 의 query 대조)을
   비껴갈 수 있다. */
export function composerStateWithQuery(query: string): ComposerState {
  return { ...initialComposerState, query };
}

/* 키보드가 커서를 옮기는 방향. 인덱스가 아니라 **뜻**을 싣는다 — 끝에서 순환할지, 아무것도
   안 가리킬 때 ↑ 가 어디로 갈지 같은 규칙이 컴포넌트로 새면 그 규칙엔 테스트가 안 붙는다.

   **"first"·"last" 는 없다.** Home·End 가 한때 이 값을 보내 목록의 처음·끝으로 커서를
   가로챘지만, W3C APG 상 그 둘은 Listbox 가 아니라 Textbox 의 키다(games-composer.tsx 의
   ARROW_MOVES 주석). 그 호출자가 사라지며 이 두 뜻도 같이 걷어냈다 — 리듀서에 죽은 분기를
   남기면 "여기서도 Home 이 커서를 옮기나"를 다시 물어야 한다. */
export type ComposerActiveMove = "next" | "prev" | "none";

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
  | { type: "back" }
  // 키보드(↓↑·Esc, 그리고 커서가 있을 때의 Home·End)가 커서를 옮긴다.
  | { type: "activeMoved"; to: ComposerActiveMove }
  /* 포인터가 얹힌 행이 곧 커서다 — 절대 인덱스로 온다. hover 를 별도 스타일로 두지 않고
     커서 자체를 옮기는 이유는 games.css 의 .composer__pick--active 주석에 있다. */
  | { type: "activeSet"; index: number };

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
      // 커서도 함께 접는다 — 목록이 비므로 가리킬 행 자체가 없다.
      return {
        ...state,
        query: action.query,
        results: [],
        searched: false,
        searchError: "",
        activeIndex: -1,
      };

    case "searchStarted":
      /* 커서는 안 건드린다. 이 액션이 오는 시점의 목록은 **비어 있다** — 결과가 화면에 있으면
         searched 가 참이고, 그때는 composerNeedsSearch 가 요청 자체를 안 내보낸다. 접을 커서가
         애초에 없으니, 여기서 -1 을 굳이 다시 쓰면 "요청 하나가 사용자가 세운 커서를 지운다"는
         경로만 새로 연다(searchSucceeded 에서 실제로 터졌던 그 경로다). */
      return { ...state, searchError: "" };

    case "searchSucceeded":
      if (isStaleSearch(state, action.query)) return state;
      /* 새 결과는 **새 목록**이다. 앞 목록의 3번째를 가리킨 채 두면 이름이 전혀 다른 행이
         활성이 되고, 결과가 그보다 짧게 오면 없는 항목을 가리킨다.

         이 -1 이 **사용자의 커서를 뺏지 않는** 근거는 두 겹이다: 늦게 온 옛 응답은 위에서
         통째로 버려지고, 살아남은 응답은 늘 **빈 목록** 위에 도착한다(결과가 이미 있으면
         composerNeedsSearch 가 안 쏜다). 그 두 번째 겹이 없던 판에선 「뒤로」가 같은 검색어를
         한 번 더 쏴서, **글자 하나 안 바뀐 목록**이 방금 세운 커서만 지웠다(실측: 요청 1→2,
         aria-activedescendant 가 composer-option-1 에서 사라지고 이어 친 Enter 가 죽는다).
         화면이 그대로라 원인이 화면 어디에도 안 보인다. */
      return {
        ...state,
        results: action.results,
        searched: true,
        searchError: "",
        activeIndex: -1,
      };

    case "searchFailed":
      /* 실패한 검색의 이전 결과를 남기면 방금 검색어와 무관한 게임을 붙이게 된다 — 비운다.
         searched 는 세우지 않는다: 통신 실패는 "결과 없음"이 아니라서, 세우면 직접 입력
         항목이 "찾아봤는데 없더라"라고 거짓말하며 열린다. */
      if (isStaleSearch(state, action.query)) return state;
      return {
        ...state,
        results: [],
        searched: false,
        searchError: action.message,
        activeIndex: -1,
      };

    case "picked":
      /* 상세로 나가며 커서를 접는다 — 뒤로 돌아온 목록에 커서가 남아 있으면 "이미 고른 행"
         으로 읽힌다. 활성 항목엔 aria-selected 가 붙으므로 낭독은 실제로 그렇게 말한다. */
      return { ...state, selected: action.selection, searchError: "", activeIndex: -1 };

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
        activeIndex: -1,
      };

    case "back":
      /* results 를 그대로 두어야 잘못 고른 뒤 다시 검색어를 치지 않고 목록에서 옆 항목을
         고를 수 있다. */
      /* searchError 도 함께 비운다 — picked 가 이미 비웠고 상세 단계에선 검색 응답을 통째로
         무시하니 실제로는 늘 빈 값이지만, "검색 단계로 돌아온 화면에 옛 에러가 없다"를
         이 액션 하나로 보장해 두면 나중에 경로가 늘어도 불변식이 안 새어 나간다. */
      // activeIndex 도 같은 이유로 여기서 한 번 더 접는다(picked 가 이미 접었다).
      return { ...state, selected: null, searchError: "", activeIndex: -1 };

    case "activeMoved":
      return withActive(state, movedActive(state, action.to));

    case "activeSet":
      /* 범위 밖이면 무시한다 — 목록이 갈리는 프레임에 뒤늦게 도착한 mousemove 가 사라진 행을
         가리킬 수 있고, 그 인덱스로 지은 id 는 DOM 에 없다. */
      return action.index < 0 || action.index >= composerOptionCount(state)
        ? state
        : withActive(state, action.index);
  }
}

/* 같은 값이면 **같은 객체**를 돌려준다 — mousemove 는 한 행 위에서 손을 미는 동안에도 픽셀마다
   발화하므로, 매번 새 객체를 만들면 React 가 바일아웃을 못 해 렌더가 계속 돈다. */
function withActive(state: ComposerState, activeIndex: number): ComposerState {
  return state.activeIndex === activeIndex ? state : { ...state, activeIndex };
}

/* 끝에서 **순환**한다. 목록은 결과 12건 상한 + 직접 추가 한 줄이라 최대 13행이다. 순환은
   흔한 콤보박스(react-select·downshift·MUI Autocomplete)가 전부 쓰는 규칙이라 손에 익은
   쪽이기도 하다.

   직접 추가는 **첫 줄**이다(과제 D — 검색 결과에 밀려 12건 스크롤 끝에야 만나던 자리를
   맨 위로 옮겼다). 그래서 아무것도 안 가리키던 상태에서 ↓ 는 곧장 그 줄로 들어간다 — 시각
   순서(맨 위)와 키보드 순서(첫 인덱스)를 맞추려는 것이다(아래 DIRECT_ENTRY_INDEX). 결과를
   훑으려면 ↓ 를 한 번 더 눌러야 하지만, 반대로 ↑ 는 **마지막 결과**로 들어가 끝에서부터
   훑을 길을 남겨 둔다 — 검색 결과를 찾던 사람이 이 이동으로 손해 보지 않게. */
function movedActive(state: ComposerState, to: ComposerActiveMove): number {
  const count = composerOptionCount(state);
  // 가리킬 게 없으면 어떤 방향이든 -1 이다. 나머지 계산이 전부 count 로 나누므로 여기서 막는다.
  if (to === "none" || count === 0) return -1;
  const cur = state.activeIndex;
  switch (to) {
    case "next":
      return cur < 0 ? 0 : (cur + 1) % count;
    case "prev":
      return cur < 0 ? count - 1 : (cur - 1 + count) % count;
  }
}

/* 목록에 **실제로 그려지는** 항목 수 = 결과 + 직접 추가 한 줄. 키보드 이동과 렌더가 같은
   인덱스 공간을 써야 aria-activedescendant 가 실재하는 id 를 가리킨다 — 그래서 "직접 추가가
   보이는가"의 답은 여기와 화면 양쪽에서 showsDirectEntry 하나로만 나온다. 그 인덱스 공간
   **안에서 무엇이 어디 있는가**는 아래 DIRECT_ENTRY_INDEX·composerResultIndex 가 정한다. */
export function composerOptionCount(state: ComposerState): number {
  return state.results.length + (showsDirectEntry(state) ? 1 : 0);
}

/* 직접 추가 줄의 옵션 인덱스. 과제 D 로 목록 맨 위에 고정되며 0 이 됐다 — 화면이 이 값을 안
   거치고 스스로 0 을 적으면, 나중에 자리가 다시 바뀔 때 core 와 화면 중 한쪽만 고쳐질 수
   있다. (showsDirectEntry 가 거짓이면 이 인덱스는 아예 안 쓰인다 — 그 줄 자체가 없다.) */
export const DIRECT_ENTRY_INDEX = 0;

/* 결과 배열의 i번째 항목이 갖는 옵션 인덱스. 직접 추가가 보이면 그 줄이 인덱스 0 을 차지해
   결과가 한 칸씩 밀리고, 감춰지면 밀리지 않는다. 화면(TSX)이 id·aria-selected·activeSet 을
   지을 때 반드시 이 함수를 거쳐야 한다 — 직접 i 를 쓰면 직접 추가가 뜨는 검색에서만 커서가
   한 칸씩 어긋난다(평소엔 안 보이다가 특정 검색어에서만 터지는 종류의 버그다). */
export function composerResultIndex(state: ComposerState, i: number): number {
  return showsDirectEntry(state) ? i + 1 : i;
}

/* 지금 활성인 항목이 무엇인가. null = 없음, "direct" = 목록 맨 위의 직접 추가 줄.
   Enter 와 마우스 클릭은 **같은 동작**이어야 하므로 그 판정을 여기 하나로 모은다 —
   컴포넌트에서 인덱스를 다시 풀면 두 경로가 갈려 한쪽만 고쳐진다. */
export function composerActiveOption(state: ComposerState): ChzzkCategory | "direct" | null {
  const i = state.activeIndex;
  if (i < 0 || i >= composerOptionCount(state)) return null;
  if (!showsDirectEntry(state)) return state.results[i] ?? null;
  // 범위 검사를 이미 통과했으니 0 이 아니면 반드시 results[i-1] 이 있다.
  return i === DIRECT_ENTRY_INDEX ? "direct" : (state.results[i - 1] ?? null);
}

// 지금 어느 단계인가. 선택이 곧 단계다 — 별도 step 필드를 두면 둘이 어긋날 수 있다.
export function composerStep(state: ComposerState): "search" | "detail" {
  return state.selected ? "detail" : "search";
}

/* 지금 이 검색어로 요청을 **내보내야 하는가.** 화면의 debounce effect 가 발사 직전에 묻는다.
   판정이 여기 있는 이유는 낭비 한 번을 아끼려는 게 아니다 — "언제 쏘는가"도 결국 이월 규칙이고,
   그게 화면에만 살면 리듀서가 세운 상태와 조용히 어긋난다. 실제로 「뒤로」가 그렇게 어긋났다
   (searchSucceeded 주석의 실측).

   판정의 축은 searched 하나다. 참이면 지금 검색어의 결론이 이미 났고 그 목록이 화면에 있으니
   다시 물을 게 없다. 나머지 둘은 보낼 것·받을 자리가 없는 경우다 — 검색어가 공백뿐이거나,
   상세 단계라 결과가 낄 자리가 없다(그 응답은 isStaleSearch 가 어차피 버린다).

   **"마지막으로 성공한 검색어를 기억해 같으면 건너뛴다"로는 안 된다.** 지우고 되치는 길이
   막힌다: '게임' 성공 → 검색어를 지움 → 다시 '게임' 이면 queryChanged 가 목록을 이미 비웠는데
   기억한 검색어는 같아서 요청이 안 나가고, 화면이 '찾는 중…' 에 굳는다(실측: 그 판은 되친 뒤
   요청 1회 · 결과 0줄 · '찾는 중…' 이 그대로. 이 판은 요청 2회 · 결과 4줄 · '찾는 중…' 0).
   지우기는 드문 길이 아니다 — type=search 의 X 버튼과 Esc 가 그걸 한 번에 만든다.
   검색 **실패**는 searched 를 안 세우니 같은 검색어 재시도 길도 여기선 안 막힌다 —
   실패는 완료가 아니다. */
export function composerNeedsSearch(state: ComposerState): boolean {
  return state.selected === null && !state.searched && state.query.trim() !== "";
}

/* 직접 입력을 **연다** — 정확히 같은 이름의 결과가 없을 때. 화면 어디에 그리는지는 이 함수의
   소관이 아니다(과제 D 로 위치가 바뀌었지만 이 노출 판정은 그대로다 — 아래 문단을 보라).

   한때 결과가 0건일 때만 열었다. 근거는 "상시 노출하면 치지직 카테고리보다 쉬운 길이 생겨
   보드가 중복 표기로 갈라진다"였는데, 그 방어가 실제로 막은 건 중복이 아니라 **정당한
   사용자**였다: 검색이 12건을 주는데 그 안에 찾는 게임이 없으면 길이 통째로 막혔다(치지직
   카테고리에 아직 없는 신작·인디가 그렇다).

   그래서 판정을 "결과 0건"에서 **"정확히 같은 이름의 결과가 없다"**로 옮긴다. 콤보박스의
   creatable 패턴이 이 형태로 수렴해 있다(eBay·MUI·react-select 셋이 같은 규칙을 쓴다) —
   다만 그 셋은 목록 **끝**에 `+ '○○' 추가` 한 줄을 붙이는데, 이 저장소는 검색이 12건을 주면
   그 끝까지 스크롤해야 만나는 게 문제였다. 그래서 자리를 **맨 위**로 옮겼다(과제 D — TSX
   렌더 순서 + DIRECT_ENTRY_INDEX). 노출 조건(이미 그 이름이 목록에 있으면 감춘다) 자체는
   그 세 라이브러리와 같다 — 갈린 건 위치뿐이다. 중복 우려는 여기서 갚는다 — 정확히 일치하는
   정본 카테고리가 보이는데도 굳이 손으로 넣는 경로는 애초에 안 열린다. 0건일 때 열리던 옛
   동작은 이 규칙의 특수한 경우로 그대로 남는다.

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
