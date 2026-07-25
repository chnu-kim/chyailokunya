import { describe, expect, it } from "vitest";
import {
  composerActiveOption,
  composerNeedsSearch,
  composerOptionCount,
  composerReducer,
  composerResultIndex,
  composerStep,
  initialComposerState,
  showsDirectEntry,
  type ComposerAction,
  type ComposerActiveMove,
  type ComposerState,
} from "./games-composer";
import type { ChzzkCategory } from "./games";

const zelda: ChzzkCategory = {
  categoryType: "GAME",
  categoryId: "c-zelda",
  categoryValue: "젤다",
  posterImageUrl: "https://img/zelda.jpg",
};
const mario: ChzzkCategory = {
  categoryType: "GAME",
  categoryId: "c-mario",
  categoryValue: "마리오",
  posterImageUrl: "https://img/mario.jpg",
};
const minecraft: ChzzkCategory = {
  categoryType: "GAME",
  categoryId: "c-minecraft",
  categoryValue: "마인크래프트",
  posterImageUrl: "https://img/minecraft.jpg",
};

// 액션을 순서대로 접어 최종 상태를 얻는다 — 이 컴포저의 버그는 늘 "경로"에서 나온다.
function run(...actions: ComposerAction[]): ComposerState {
  return actions.reduce(composerReducer, initialComposerState);
}

const searched = (q: string, results: ChzzkCategory[]): ComposerAction[] => [
  { type: "queryChanged", query: q },
  { type: "searchSucceeded", query: q, results },
];

const pick = (c: ChzzkCategory): ComposerAction => ({
  type: "picked",
  selection: {
    categoryId: c.categoryId,
    categoryValue: c.categoryValue,
    posterImageUrl: c.posterImageUrl,
  },
});

describe("단계 전이", () => {
  it("결과 클릭은 선택일 뿐 — 상세로 갈 뿐 서버로 나갈 입력은 그대로다", () => {
    const s = run(...searched("젤다", [zelda]), pick(zelda));
    expect(composerStep(s)).toBe("detail");
    expect(s.selected?.categoryId).toBe("c-zelda");
    // 결과 목록은 남는다 — 뒤로 가서 옆 항목을 고를 수 있어야 한다.
    expect(s.results).toHaveLength(1);
  });

  it("뒤로는 검색 단계로 돌아가되 결과 목록·검색어는 남긴다", () => {
    const s = run(...searched("젤다", [zelda, mario]), pick(zelda), { type: "back" });
    expect(composerStep(s)).toBe("search");
    expect(s.selected).toBeNull();
    expect(s.results).toHaveLength(2);
    expect(s.query).toBe("젤다");
  });
});

/* 언제 요청을 내보내는가. 화면의 debounce effect 가 이 판정 하나만 보고 쏘므로 여기가 정본이다.
   걸린 것은 낭비가 아니라 **커서 소실**이다: 같은 검색어를 한 번 더 받아 오면 목록은 글자 하나
   안 바뀐 채 searchSucceeded 가 사용자가 방금 세운 커서를 접는다. 화면에 원인이 안 남는 종류라
   눈으로는 못 지킨다. */
describe("검색 발사 판정", () => {
  it("검색어를 치면 내보낸다", () => {
    expect(composerNeedsSearch(run({ type: "queryChanged", query: "게임" }))).toBe(true);
  });

  it("열자마자·공백뿐인 검색어는 안 내보낸다 — 보낼 것이 없다", () => {
    expect(composerNeedsSearch(initialComposerState)).toBe(false);
    expect(composerNeedsSearch(run({ type: "queryChanged", query: "   " }))).toBe(false);
  });

  it("결과가 이미 화면에 있으면 안 내보낸다 — 지금 검색어의 결론이 이미 났다", () => {
    expect(composerNeedsSearch(run(...searched("게임", [zelda, mario])))).toBe(false);
  });

  /* 이 한 줄이 이 describe 의 이유다. 「뒤로」는 검색어도 목록도 그대로 두는데(위 '단계 전이'),
     발사 판정이 그걸 안 보면 상세에서 돌아오는 것만으로 같은 검색을 다시 쏜다. */
  it("「뒤로」로 검색 화면에 돌아와도 다시 안 내보낸다 — 목록이 그대로 남아 있으므로", () => {
    const s = run(...searched("게임", [zelda, mario]), pick(zelda), { type: "back" });
    expect(s.results).toHaveLength(2);
    expect(composerNeedsSearch(s)).toBe(false);
  });

  it("검색이 실패했으면 같은 검색어라도 내보낸다 — 실패는 완료가 아니다", () => {
    const s = run(
      { type: "queryChanged", query: "게임" },
      { type: "searchFailed", query: "게임", message: "검색에 실패했어요." },
    );
    expect(composerNeedsSearch(s)).toBe(true);
  });

  /* 지우고 **같은 검색어**를 되치는 길(type=search 의 X 버튼·Esc 가 실제로 만든다).
     "마지막으로 성공한 검색어와 같으면 건너뛴다"로 막았다면 여기가 죽는다 — queryChanged 가
     목록을 이미 비웠는데 요청이 안 나가 화면이 '찾는 중…' 에 굳는다. */
  it("지우고 같은 검색어를 되치면 다시 내보낸다 — 목록은 이미 비워졌다", () => {
    const s = run(
      ...searched("게임", [zelda, mario]),
      { type: "queryChanged", query: "" },
      { type: "queryChanged", query: "게임" },
    );
    expect(s.results).toEqual([]);
    expect(composerNeedsSearch(s)).toBe(true);
  });

  it("상세 단계에선 안 내보낸다 — 결과가 낄 자리가 없다", () => {
    expect(composerNeedsSearch(run(...searched("게임", [zelda]), pick(zelda)))).toBe(false);
  });

  /* searchStarted 가 커서를 안 건드리는 근거이기도 하다: 발사되는 시점의 목록은 늘 비어 있다
     (결과가 있으면 위에서 판정이 거짓이라 애초에 안 쏜다). */
  it("내보내는 시점의 목록은 비어 있다 — 그래서 발사가 지울 커서가 없다", () => {
    for (const s of [
      run({ type: "queryChanged", query: "게임" }),
      run(
        { type: "queryChanged", query: "게임" },
        { type: "searchFailed", query: "게임", message: "검색에 실패했어요." },
      ),
      run(...searched("게임", [zelda, mario]), { type: "queryChanged", query: "게임2" }),
    ]) {
      expect(composerNeedsSearch(s)).toBe(true);
      expect(s.results).toEqual([]);
      expect(s.activeIndex).toBe(-1);
    }
  });
});

/* 검색 응답은 비동기라 **도착 시점의 화면**이 제출 시점과 다를 수 있다. 여기 네 케이스가
   실제로 터졌던 경로다 — 특히 늦게 온 0건이 직접 입력을 열어 치지직에 있는 게임을
   categoryId=null 중복 행으로 넣는 길(NULL 은 UNIQUE 밖이라 서버도 못 막는다).
   타이핑 자동 검색은 이 창을 **넓힌다** — 사람이 「검색」을 누르던 때보다 요청이 훨씬 자주
   나가 응답이 뒤섞일 기회가 늘어난다. 그래서 이 describe 는 자동 검색에서 더 중요해졌다. */
describe("늦게 온 검색 응답", () => {
  const failed = (q: string): ComposerAction => ({
    type: "searchFailed",
    query: q,
    message: "검색에 실패했어요.",
  });

  it("옛 검색어의 성공 응답은 통째로 무시된다 — 현재 검색어의 결과를 못 덮는다", () => {
    const s = run(
      { type: "queryChanged", query: "zzz" },
      { type: "queryChanged", query: "마인크래프트" },
      /* 결과에 검색어와 **정확히 같은 이름**이 있어야 이 테스트가 이빨을 갖는다. 그 일치가
         직접 입력을 감추는 유일한 근거이므로, 늦게 온 0건이 목록을 비우면 근거가 사라져
         아래 단언이 빨개진다(검색어와 무관한 픽스처를 쓰면 어느 쪽이든 열려 못 잡는다). */
      { type: "searchSucceeded", query: "마인크래프트", results: [minecraft, mario] },
      // 늦게 도착한 "zzz" 의 0건.
      { type: "searchSucceeded", query: "zzz", results: [] },
    );
    expect(s.results).toHaveLength(2);
    /* 늦게 온 0건이 results 를 비웠다면 직접 입력이 열려, 치지직에 실제로 있는
       「마인크래프트」를 categoryId=null 로 넣는 길이 생긴다. */
    expect(showsDirectEntry(s)).toBe(false);
  });

  it("옛 검색어의 실패 응답도 무시된다 — 현재 결과를 비우거나 에러를 띄우지 않는다", () => {
    const s = run(
      { type: "queryChanged", query: "zzz" },
      { type: "queryChanged", query: "마리오" },
      { type: "searchSucceeded", query: "마리오", results: [mario] },
      failed("zzz"),
    );
    expect(s.results).toEqual([mario]);
    expect(s.searchError).toBe("");
  });

  it("상세 단계에 도착한 성공 응답은 무시된다 — 그 화면엔 결과 목록이 낄 자리가 없다", () => {
    const s = run(...searched("젤다", [zelda]), pick(zelda), {
      type: "searchSucceeded",
      query: "젤다",
      results: [mario],
    });
    expect(composerStep(s)).toBe("detail");
    expect(s.selected?.categoryValue).toBe("젤다");
    expect(s.results).toEqual([zelda]);
  });

  it("상세 단계에 도착한 실패 응답은 무시된다 — 검색 실패가 「추가」 실패로 읽히면 안 된다", () => {
    const s = run(...searched("젤다", [zelda]), pick(zelda), failed("젤다"));
    expect(composerStep(s)).toBe("detail");
    expect(s.searchError).toBe("");
    // 상세로 넘어온 뒤에도 결과 목록은 남아야 뒤로 갔을 때 옆 항목을 고를 수 있다.
    expect(s.results).toEqual([zelda]);
  });
});

describe("검색 에러의 수명", () => {
  const failed: ComposerAction = {
    type: "searchFailed",
    query: "젤다",
    message: "검색에 실패했어요.",
  };
  const typed: ComposerAction = { type: "queryChanged", query: "젤다" };

  it("실패는 검색 단계의 에러로 남는다", () => {
    expect(run(typed, failed).searchError).toBe("검색에 실패했어요.");
  });

  it("검색어를 고치면 지워진다 — 옛 검색의 결론이라", () => {
    const s = run(typed, failed, { type: "queryChanged", query: "젤다2" });
    expect(s.searchError).toBe("");
  });

  it("재검색이 성공하면 지워진다", () => {
    const s = run(typed, failed, { type: "searchSucceeded", query: "젤다", results: [zelda] });
    expect(s.searchError).toBe("");
  });

  it("게임을 고르면 지워진다 — 상세 화면에 검색 에러가 따라가면 안 된다", () => {
    expect(run(typed, failed, pick(zelda)).searchError).toBe("");
  });

  it("직접 입력으로 넘어가도 지워진다", () => {
    const s = run(...searched("없는게임", []), { type: "manualPicked" });
    expect(s.searchError).toBe("");
  });

  it("뒤로 돌아온 검색 화면에도 옛 에러가 없다", () => {
    const s = run(typed, failed, pick(zelda), { type: "back" });
    expect(s.searchError).toBe("");
  });

  /* 같은 검색어로 재시도하면 queryChanged 가 안 오므로, searchStarted 가 없으면 옛 실패 문구가
     응답이 올 때까지 '검색 중…' 과 한 화면에 공존한다. */
  it("같은 검색어로 다시 발사하면 옛 실패 문구가 지워진다", () => {
    const s = run(typed, failed, { type: "searchStarted" });
    expect(s.searchError).toBe("");
    // 발사는 아직 답이 아니다 — 결과·직접 입력 상태를 건드리면 안 된다.
    expect(s.query).toBe("젤다");
    expect(showsDirectEntry(s)).toBe(false);
  });
});

/* 직접 입력이 결과 목록의 마지막 항목으로 내려오면서 판정이 "결과 0건"에서 "정확히 같은
   이름이 결과에 없다"로 바뀌었다. 이 describe 가 그 규칙의 정본이다 — 특히 **결과가 있는데도
   열리는** 케이스는 이번에 새로 생긴 길이라, 없으면 다음 사람이 옛 규칙으로 되돌려도 초록이다. */
describe("직접 입력 항목", () => {
  it("열자마자는 안 뜬다 — 아직 안 찾은 것과 찾았는데 없는 것은 다르다", () => {
    expect(showsDirectEntry(initialComposerState)).toBe(false);
    expect(showsDirectEntry(run({ type: "queryChanged", query: "젤다" }))).toBe(false);
  });

  it("결과 0건이면 뜬다 — 옛 비상구가 이 규칙의 특수한 경우로 남는다", () => {
    expect(showsDirectEntry(run(...searched("없는게임", [])))).toBe(true);
  });

  it("결과가 있어도 그 중 같은 이름이 없으면 뜬다", () => {
    // 「젤다 무쌍」을 찾는데 목록엔 「젤다」뿐 — 옛 규칙은 여기서 길을 통째로 막았다.
    expect(showsDirectEntry(run(...searched("젤다 무쌍", [zelda, mario])))).toBe(true);
  });

  it("정확히 같은 이름이 결과에 있으면 감춘다 — 정본 카테고리 옆에 중복을 권하지 않는다", () => {
    expect(showsDirectEntry(run(...searched("젤다", [zelda, mario])))).toBe(false);
  });

  it("대소문자·앞뒤 공백은 같은 이름으로 본다", () => {
    const minecraft: ChzzkCategory = {
      categoryType: "GAME",
      categoryId: "c-minecraft",
      categoryValue: "Minecraft",
      posterImageUrl: null,
    };
    expect(showsDirectEntry(run(...searched("  minecraft  ", [minecraft])))).toBe(false);
  });

  it("이름이 겹쳐도 정확히 같지 않으면 뜬다 — 부분 일치로 접으면 다른 게임을 못 넣는다", () => {
    const little: ChzzkCategory = {
      categoryType: "GAME",
      categoryId: "c-little",
      categoryValue: "리틀 나이트메어",
      posterImageUrl: null,
    };
    expect(showsDirectEntry(run(...searched("리틀 나이트메어 2", [little])))).toBe(true);
  });

  it("검색 실패는 '결과 없음'이 아니다 — 직접 입력이 열리면 안 된다", () => {
    const s = run(
      { type: "queryChanged", query: "젤다" },
      { type: "searchFailed", query: "젤다", message: "검색에 실패했어요." },
    );
    expect(showsDirectEntry(s)).toBe(false);
    // 실패한 검색의 이전 결과도 남지 않는다.
    expect(s.results).toEqual([]);
  });

  it("검색어를 다시 고치면 접힌다 — 옛 검색어의 결론이라", () => {
    const s = run(...searched("없는게임", []), { type: "queryChanged", query: "없는게임2" });
    expect(showsDirectEntry(s)).toBe(false);
  });

  it("검색어를 고치면 옛 결과 목록도 사라진다 — 검색어와 무관한 목록이 남으면 안 된다", () => {
    const s = run(...searched("젤다", [zelda, mario]), { type: "queryChanged", query: "마리오" });
    expect(s.results).toEqual([]);
    expect(s.searched).toBe(false);
  });

  it("검색어가 공백뿐이면 붙일 제목이 없어 닫는다", () => {
    expect(showsDirectEntry(run(...searched("   ", [])))).toBe(false);
  });

  it("검색어가 제목으로 넘어가고 categoryId·포스터는 null 이다", () => {
    const s = run(...searched("  손으로 넣은 게임  ", []), { type: "manualPicked" });
    expect(s.selected).toEqual({
      categoryId: null,
      categoryValue: "손으로 넣은 게임",
      posterImageUrl: null,
    });
    expect(composerStep(s)).toBe("detail");
  });
});

/* 콤보박스의 키보드 커서(activeIndex). 이 규칙들이 리듀서에 사는 이유는 상태 정의 주석에 있고,
   여기가 그 정본이다 — 화면에선 커서가 틀려도 조용하다(aria-activedescendant 는 IDREF 라
   없는 id 를 가리켜도 예외가 안 난다). 그래서 "결과가 갈리면 접힌다"는 눈으로는 못 지킨다. */
describe("결과 목록의 키보드 커서", () => {
  const move = (to: ComposerActiveMove): ComposerAction => ({ type: "activeMoved", to });
  const point = (index: number): ComposerAction => ({ type: "activeSet", index });
  /* 검색어와 정확히 같은 이름이 없는 목록 — 직접 추가가 **맨 위로** 붙어 항목이 4개다.
     커서 규칙은 그 줄까지 포함해야 하므로 기본 픽스처를 이쪽으로 잡는다(바로 아래 테스트가
     그 줄이 인덱스 0 임을 못박는다 — 자리를 옮긴 게 과제 D 다). */
  const four = searched("게임", [zelda, mario, minecraft]);
  // 정확히 같은 이름이 있어 직접 추가가 감춰진 목록 — 항목은 결과 2개뿐이다.
  const two = searched("젤다", [zelda, mario]);

  it("열자마자는 아무것도 안 가리킨다", () => {
    expect(initialComposerState.activeIndex).toBe(-1);
    expect(composerActiveOption(initialComposerState)).toBeNull();
  });

  it("직접 추가 줄이 목록의 첫 인덱스다(과제 D) — 화면과 같은 인덱스 공간이어야 한다", () => {
    const s = run(...four);
    expect(composerOptionCount(s)).toBe(4);
    // 맨 위로 옮기며 인덱스도 0 이 됐다 — 시각 순서(맨 위)와 키보드 순서(첫 인덱스)가 맞아야
    // 아무것도 안 가리키던 상태에서 ↓ 한 번이 화면 첫 줄을 그대로 잡는다. point 로 그 인덱스
    // 공간을 직접 찌른다 — 이 테스트의 관심은 방향키 순서가 아니라 자리 자체라서다.
    expect(composerActiveOption(run(...four, point(0)))).toBe("direct");
    // 감춰지면 밀림 없이 결과 그대로다.
    expect(composerOptionCount(run(...two))).toBe(2);
    expect(composerActiveOption(run(...two, point(1)))).toEqual(mario);
  });

  it("결과 인덱스는 직접 추가가 보일 때만 한 칸씩 밀린다", () => {
    const shown = run(...four); // "게임" 은 결과 어느 것과도 정확히 안 겹쳐 직접 추가가 뜬다.
    expect(composerResultIndex(shown, 0)).toBe(1);
    expect(composerResultIndex(shown, 2)).toBe(3);

    const hidden = run(...two); // "젤다" 는 zelda 와 정확히 겹쳐 직접 추가가 감춰진다.
    expect(composerResultIndex(hidden, 0)).toBe(0);
    expect(composerResultIndex(hidden, 1)).toBe(1);
  });

  it("↓ 는 첫 항목(직접 추가)부터 차례로 내려간다", () => {
    expect(run(...four, move("next")).activeIndex).toBe(0);
    expect(composerActiveOption(run(...four, move("next")))).toBe("direct");
    expect(run(...four, move("next"), move("next")).activeIndex).toBe(1);
    expect(composerActiveOption(run(...four, move("next"), move("next")))).toEqual(zelda);
  });

  it("끝(마지막 결과)에서 ↓ 는 처음(직접 추가)으로 돈다", () => {
    // move("prev") 는 아무것도 안 가리킨 채(-1) 부르면 곧장 마지막으로 간다 — 아래 테스트가
    // 그 자체를 못박는다. 여기선 그걸 "끝에 서는" 수단으로 재사용한다.
    expect(run(...four, move("prev"), move("next")).activeIndex).toBe(0);
    expect(composerActiveOption(run(...four, move("prev"), move("next")))).toBe("direct");
  });

  it("아무것도 안 가리킬 때 ↑ 는 마지막 결과로 들어간다 — 직접 추가는 이미 첫 줄이라 ↓ 한 번으로 닿는다", () => {
    expect(run(...four, move("prev")).activeIndex).toBe(3);
    expect(composerActiveOption(run(...four, move("prev")))).toEqual(minecraft);
    // 처음(0)에서 ↑ 도 같은 순환을 타 마지막으로 돈다 — 경계가 한쪽만 특별하지 않다.
    expect(run(...four, point(0), move("prev")).activeIndex).toBe(3);
  });

  it("해제(Esc)는 커서만 접는다 — 목록·검색어는 그대로다", () => {
    const s = run(...four, move("next"), move("none"));
    expect(s.activeIndex).toBe(-1);
    expect(s.results).toHaveLength(3);
    expect(s.query).toBe("게임");
  });

  it("목록이 비어 있으면 어느 방향도 커서를 안 세운다", () => {
    const empty = run({ type: "queryChanged", query: "젤다" });
    for (const to of ["next", "prev"] as const) {
      expect(composerReducer(empty, move(to)).activeIndex).toBe(-1);
    }
  });

  it("포인터는 절대 인덱스로 커서를 옮기고, 범위 밖은 무시한다", () => {
    expect(run(...four, point(2)).activeIndex).toBe(2);
    // 목록이 갈리는 프레임에 뒤늦게 온 mousemove — 그 인덱스의 id 는 이미 DOM 에 없다.
    expect(run(...four, point(4)).activeIndex).toBe(-1);
    expect(run(...four, move("next"), point(-1)).activeIndex).toBe(0);
  });

  it("같은 자리를 다시 가리키면 같은 상태 객체다 — mousemove 가 렌더를 못 돌린다", () => {
    const s = run(...four, point(1));
    expect(composerReducer(s, point(1))).toBe(s);
    expect(composerReducer(s, move("none"))).not.toBe(s);
  });

  /* 3번째를 가리킨 채 결과가 짧아지면 커서가 없는 항목을 가리키고, 그 순간
     aria-activedescendant 는 DOM 에 없는 id 를 든다 — 낭독이 조용해지는 것 말고는 신호가 없다. */
  it("결과가 갱신되면 커서가 접힌다", () => {
    const s = run(...four, point(3), {
      type: "searchSucceeded",
      query: "게임",
      results: [zelda],
    });
    expect(s.activeIndex).toBe(-1);
    expect(composerActiveOption(s)).toBeNull();
  });

  it("검색어를 고치면 접힌다 — 목록이 통째로 비므로 가리킬 행이 없다", () => {
    expect(run(...four, move("next"), { type: "queryChanged", query: "게임2" }).activeIndex).toBe(
      -1,
    );
  });

  it("검색이 실패해도 접힌다 — 결과가 비워지는 길은 여기도 마찬가지다", () => {
    const s = run(...four, move("next"), {
      type: "searchFailed",
      query: "게임",
      message: "검색에 실패했어요.",
    });
    expect(s.activeIndex).toBe(-1);
  });

  it("늦게 온 응답은 커서를 안 건드린다 — 버려진 응답이 화면 커서를 흔들면 안 된다", () => {
    const s = run(...two, move("next"), { type: "searchSucceeded", query: "zzz", results: [] });
    expect(s.activeIndex).toBe(0);
    expect(composerActiveOption(s)).toEqual(zelda);
  });

  it("게임을 고르면 접히고 뒤로 돌아와도 안 살아난다 — 남으면 '이미 고른 행'으로 읽힌다", () => {
    const picked = run(...two, move("next"), pick(zelda));
    expect(picked.activeIndex).toBe(-1);
    expect(composerReducer(picked, { type: "back" }).activeIndex).toBe(-1);
  });

  it("직접 추가로 넘어가도 접힌다", () => {
    expect(run(...four, point(3), { type: "manualPicked" }).activeIndex).toBe(-1);
  });
});
