import { assign, setup } from "xstate";
import type { ChzzkCategory } from "./games";

/* 게임 추가 컴포저의 상태 기계(에픽 #77 이슈 #83) — `games-composer.ts` 의 순수 리듀서를
   그대로 상태차트로 옮긴다. 그 파일은 이미 옳게 푼 자리였다(전이만 순수 모듈로 내려 workerd
   테스트가 회귀를 잡는다, ADR-0010 개정판의 "검증 우선" JIT 추상화) — 이 파일은 그 표현
   수단만 바꾼다. 새 간접층을 더하는 게 아니다.

   9종 액션의 전이표가 이제 **계층 상태**로 읽힌다:

     search (검색 단계)
       ├─ beforeResults — 검색 전 또는 실패("검색 전")
       └─ hasResults    — 검색 결과가 옴("결과 있음")
     detail             — 게임을 골라 확인·추가하는 단계("선택됨")

   이 하나로 두 가지가 구조로 드러난다:
   - **`searchError` 와 `addError` 가 다른 단계에 속한다**는 사실 — search 아래에서만
     검색 실패가 뜨고, detail 로 건너간 순간 그 필드를 읽는 핸들러 자체가 없다.
   - **늦게 온 검색 응답의 절반이 저절로 걸러진다** — 옛 `isStaleSearch` 는
     `state.selected !== null || query !== state.query` 두 조건을 함께 봤는데, 앞
     조건("이미 상세로 갔다")은 이제 그 이벤트를 받는 핸들러가 `search` 아래에만 있어
     `detail` 상태 자체가 걸러 준다. 남는 건 검색어 대조뿐이다.

   `activeIndex`(콤보박스 키보드 커서)가 결과 변화를 따라 접히는 규칙은 옛 리듀서처럼
   각 케이스에서 손으로 -1 을 다시 쓴다 — 상태 재진입의 entry 액션에 맡기지 않는다.
   XState 의 `assign` 은 같은 값을 넣어도 매번 새 context 객체를 만들어(실측) 재진입에
   기대면 "같은 자리를 다시 가리키면 같은 상태 객체다"(아래 테스트, mousemove 바일아웃)
   불변식이 깨진다 — 그래서 `activeMoved`·`activeSet` 은 가드로 "바뀌는 게 없으면 아무
   액션도 안 문다"를 직접 챙긴다. */

export type ComposerSelection = {
  categoryId: string | null;
  categoryValue: string;
  posterImageUrl: string | null;
};

export type ComposerContext = {
  query: string;
  results: ChzzkCategory[];
  /* 검색을 한 번이라도 돌렸는가 — results.length===0 만으로는 "아직 안 찾음"과 "찾았는데
     없음"이 안 갈린다. searchSucceeded 만 참으로 세우고 queryChanged·searchFailed 가
     즉시 되접으므로, 참이면 화면의 목록이 곧 지금 검색어의 결과다. */
  searched: boolean;
  selected: ComposerSelection | null;
  /* 검색 단계의 에러 문구. detail 로 건너가면 이 필드를 읽는 핸들러가 없어 상세의 「추가」
     에러와 자연히 섞이지 않는다(games-composer.ts 원본 주석의 위험 — 이제 계층이 막는다). */
  searchError: string;
  /* 결과 목록의 키보드 커서(WAI-ARIA 콤보박스). -1 = 없음. 포커스가 아니라 인덱스인
     이유·"컴포넌트 useState 가 아닌 이유"는 games-composer.ts 원본에 있던 그대로다 —
     결과가 바뀌었는데 커서가 안 따라오면 aria-activedescendant 가 DOM 에 없는 id 를
     가리키고, IDREF 라 틀려도 예외 없이 낭독만 조용해진다. */
  activeIndex: number;
};

export type ComposerInput = {
  /* 검색어를 채운 채 여는 출발점(ADR-0025 — 관리자가 팬의 추가 요청을 반영할 때). 그 밖엔
     "" 를 준다. query 만 채우고 searched 는 여전히 false 로 두는 것이 핵심이다 —
     composerNeedsSearch 가 곧바로 참이 되어 debounce effect 가 평소 경로 그대로 검색을
     발사한다("열자마자 한 번 검색" 같은 별도 배선이 필요 없다). */
  query: string;
};

/* 키보드가 커서를 옮기는 방향. "first"·"last" 는 없다 — Home·End 는 W3C APG 상 콤보박스의
   Textbox 키라 목록 이동으로 가로채지 않는다(games-composer.tsx 의 ARROW_MOVES 주석). */
export type ComposerActiveMove = "next" | "prev" | "none";

export type ComposerEvent =
  /* 검색 응답 액션은 **무엇을 검색한 요청인가**(query)를 함께 싣는다 — 안 실으면 늦게 온
     옛 응답이 현재 화면을 덮는다(games-composer.ts 원본의 실측 시나리오 그대로). */
  | { type: "queryChanged"; query: string }
  // 검색 발사. 응답이 아니라 시작도 전이다 — 실패 뒤 같은 검색어 재시도는 queryChanged 가
  // 안 오므로, 이게 없으면 옛 실패 문구가 응답이 올 때까지 안 지워진다.
  | { type: "searchStarted" }
  | { type: "searchSucceeded"; query: string; results: ChzzkCategory[] }
  | { type: "searchFailed"; query: string; message: string }
  | { type: "picked"; selection: ComposerSelection }
  | { type: "manualPicked" }
  | { type: "back" }
  | { type: "activeMoved"; to: ComposerActiveMove }
  // 포인터가 얹힌 행이 곧 커서다 — 절대 인덱스로 온다.
  | { type: "activeSet"; index: number };

/* 끝에서 순환한다. 직접 추가는 첫 줄(DIRECT_ENTRY_INDEX) — 시각 순서(맨 위)와 키보드
   순서(첫 인덱스)를 맞추려는 것이다. ↑ 는 반대로 마지막 결과로 들어가 끝에서부터 훑을
   길을 남긴다. (games-composer.ts 원본의 "과제 D" 주석과 같은 규칙, 같은 근거.) */
function movedActive(context: ComposerContext, to: ComposerActiveMove): number {
  const count = composerOptionCount(context);
  if (to === "none" || count === 0) return -1;
  const cur = context.activeIndex;
  switch (to) {
    case "next":
      return cur < 0 ? 0 : (cur + 1) % count;
    case "prev":
      return cur < 0 ? count - 1 : (cur - 1 + count) % count;
  }
}

/* 목록에 실제로 그려지는 항목 수 = 결과 + 직접 추가 한 줄. 키보드 이동과 렌더가 같은
   인덱스 공간을 써야 aria-activedescendant 가 실재하는 id 를 가리킨다. */
export function composerOptionCount(context: ComposerContext): number {
  return context.results.length + (showsDirectEntry(context) ? 1 : 0);
}

// 직접 추가 줄의 옵션 인덱스 — 맨 위로 고정(과제 D).
export const DIRECT_ENTRY_INDEX = 0;

/* 결과 배열의 i번째 항목이 갖는 옵션 인덱스. 직접 추가가 보이면 그 줄이 인덱스 0 을
   차지해 결과가 한 칸씩 밀린다. 화면(TSX)이 id·aria-selected·activeSet 을 지을 때
   반드시 이 함수를 거쳐야 한다 — 직접 i 를 쓰면 직접 추가가 뜨는 검색에서만 커서가
   한 칸씩 어긋난다. */
export function composerResultIndex(context: ComposerContext, i: number): number {
  return showsDirectEntry(context) ? i + 1 : i;
}

/* 지금 활성인 항목이 무엇인가. null = 없음, "direct" = 목록 맨 위의 직접 추가 줄.
   Enter 와 마우스 클릭이 같은 판정을 타도록 이 함수 하나로 모은다. */
export function composerActiveOption(context: ComposerContext): ChzzkCategory | "direct" | null {
  const i = context.activeIndex;
  if (i < 0 || i >= composerOptionCount(context)) return null;
  if (!showsDirectEntry(context)) return context.results[i] ?? null;
  return i === DIRECT_ENTRY_INDEX ? "direct" : (context.results[i - 1] ?? null);
}

// 지금 어느 단계인가. 선택이 곧 단계다 — 별도 필드를 두면 머신의 상태값과 어긋날 수 있다.
export function composerStep(context: ComposerContext): "search" | "detail" {
  return context.selected ? "detail" : "search";
}

/* 지금 이 검색어로 요청을 내보내야 하는가. 판정의 축은 searched 하나다 — 참이면 지금
   검색어의 결론이 이미 났고 그 목록이 화면에 있으니 다시 물을 게 없다. "마지막으로 성공한
   검색어를 기억해 같으면 건너뛴다"로는 안 된다(games-composer.ts 원본의 실측 — 지우고
   되치면 화면이 '찾는 중…' 에 굳는다). */
export function composerNeedsSearch(context: ComposerContext): boolean {
  return context.selected === null && !context.searched && context.query.trim() !== "";
}

/* 직접 입력을 연다 — 정확히 같은 이름의 결과가 없을 때(검색 전엔 안 연다 — "아직 안
   찾음"과 "찾았는데 없음"은 다르다). 판정을 "결과 0건"이 아니라 "정확히 같은 이름이
   없다"로 두는 근거는 games-composer.ts 원본의 "과제 D" 주석에 있다. */
export function showsDirectEntry(context: ComposerContext): boolean {
  const q = context.query.trim();
  if (!context.searched || q === "") return false;
  return !context.results.some((c) => equalsGameName(c.categoryValue, q));
}

// 대소문자·앞뒤 공백만 무시한다 — 더 뭉개면(공백 제거·자모 정규화) 실제로 다른 게임을
// 같다고 접어 직접 추가가 조용히 사라진다.
function equalsGameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export const composerMachine = setup({
  types: {} as {
    context: ComposerContext;
    events: ComposerEvent;
    input: ComposerInput;
  },
}).createMachine({
  id: "composer",
  context: ({ input }) => ({
    query: input.query,
    results: [],
    searched: false,
    selected: null,
    searchError: "",
    activeIndex: -1,
  }),
  initial: "search",
  states: {
    search: {
      initial: "beforeResults",
      /* 두 자식(beforeResults·hasResults) 모두에게 같은 뜻인 이벤트 넷은 부모에 한 번만
         적는다 — 자식마다 복붙하면 그중 하나만 고쳐질 수 있다. */
      on: {
        queryChanged: {
          target: ".beforeResults",
          /* 검색어를 고치는 순간 옛 검색어의 결론은 전부 무효다 — 직접 입력 판정(searched)뿐
             아니라 results 도 비운다. 남기면 searchFailed 가 스스로 금지한 "검색어와 무관한
             결과가 화면에 남은" 상태를 뒷문으로 만든다. */
          actions: assign({
            query: ({ event }) => event.query,
            results: [],
            searched: false,
            searchError: "",
            activeIndex: -1,
          }),
        },
        // 결과 클릭은 선택일 뿐 — 상세로 갈 뿐 서버로 나갈 입력은 그대로다. results 는
        // 안 건드린다 — 뒤로 가서 옆 항목을 고를 수 있어야 한다.
        picked: {
          target: "detail",
          actions: assign({
            selected: ({ event }) => event.selection,
            searchError: "",
            activeIndex: -1,
          }),
        },
        // 직접 입력은 치던 검색어가 그대로 제목이 된다 — 같은 상세 화면에 합류한다.
        manualPicked: {
          target: "detail",
          actions: assign({
            selected: ({ context }) => ({
              categoryId: null,
              categoryValue: context.query.trim(),
              posterImageUrl: null,
            }),
            searchError: "",
            activeIndex: -1,
          }),
        },
        /* 계산한 다음 자리가 지금과 같으면 액션 자체를 안 문다 — XState 의 assign 은 같은
           값을 넣어도 매번 새 context 를 만들어(실측) 재진입에 기대면 "같은 자리를 다시
           가리키면 같은 상태 객체다"(아래 테스트, mousemove 바일아웃) 불변식이 깨진다. */
        activeMoved: [
          { guard: ({ context, event }) => movedActive(context, event.to) === context.activeIndex },
          {
            actions: assign({
              activeIndex: ({ context, event }) => movedActive(context, event.to),
            }),
          },
        ],
        activeSet: [
          /* 범위 밖이거나 지금과 같으면 무시한다 — 목록이 갈리는 프레임에 뒤늦게 도착한
             mousemove 가 사라진 행을 가리킬 수 있고, 그 인덱스로 지은 id 는 DOM 에 없다. */
          {
            guard: ({ context, event }) =>
              event.index === context.activeIndex ||
              event.index < 0 ||
              event.index >= composerOptionCount(context),
          },
          { actions: assign({ activeIndex: ({ event }) => event.index }) },
        ],
        /* 응답 둘 다 **beforeResults·hasResults 어느 쪽에서 받아도 같은 판정**이다 — 이미
           hasResults 에 있어도 다음 응답이 지금 검색어의 것이면(재검색·재시도) 그대로
           받아야 한다("결과가 갱신되면 커서가 접힌다" 테스트가 바로 이 경로). 그래서 자식이
           아니라 부모(search)에 한 번만 적는다. */
        searchSucceeded: {
          // 응답이 답한 검색어가 지금 검색어와 다르면 늦게 온 옛 응답이다 — 버린다.
          guard: ({ context, event }) => event.query === context.query,
          target: ".hasResults",
          actions: assign({
            results: ({ event }) => event.results,
            searched: true,
            searchError: "",
            activeIndex: -1,
          }),
        },
        searchFailed: {
          guard: ({ context, event }) => event.query === context.query,
          target: ".beforeResults",
          /* searched 는 안 세운다 — 통신 실패는 "결과 없음"이 아니라서, 세우면 직접 입력
             항목이 "찾아봤는데 없더라"라고 거짓말하며 열린다. */
          actions: assign({
            results: [],
            searched: false,
            searchError: ({ event }) => event.message,
            activeIndex: -1,
          }),
        },
      },
      states: {
        // 검색 전, 또는 실패해서 결과가 낄 자리가 없는 단계.
        beforeResults: {
          on: {
            searchStarted: { actions: assign({ searchError: "" }) },
          },
        },
        // 결과가 있는 단계.
        hasResults: {},
      },
    },
    detail: {
      on: {
        /* results 는 그대로 두어야 잘못 고른 뒤 다시 검색어를 치지 않고 목록에서 옆 항목을
           고를 수 있다. searchError·activeIndex 는 picked 가 이미 비웠지만, "검색 단계로
           돌아온 화면에 옛 값이 없다"를 이 전이 하나로도 보장해 둔다. */
        back: {
          target: "search",
          actions: assign({ selected: null, searchError: "", activeIndex: -1 }),
        },
      },
    },
  },
});
