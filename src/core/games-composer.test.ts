import { describe, expect, it } from "vitest";
import {
  composerReducer,
  composerStep,
  initialComposerState,
  showsDirectEntry,
  type ComposerAction,
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
