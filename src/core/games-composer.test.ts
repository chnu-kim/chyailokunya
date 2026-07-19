import { describe, expect, it } from "vitest";
import {
  composerReducer,
  composerStep,
  EMPTY_DATES,
  initialComposerState,
  showsManualEntry,
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

describe("날짜 이월 방지", () => {
  const withDates: ComposerAction = {
    type: "datesChanged",
    dates: { playedAt: "2026-01-05", clearedAt: "2026-02-10" },
  };

  it("뒤로 갔다 다른 게임을 고르면 이전 게임의 날짜가 따라오지 않는다", () => {
    const s = run(
      ...searched("게임", [zelda, mario]),
      pick(zelda),
      withDates,
      { type: "back" },
      pick(mario),
    );
    expect(s.selected?.categoryValue).toBe("마리오");
    expect(s.dates).toEqual(EMPTY_DATES);
  });

  it("뒤로만 눌러도 날짜는 비워진다", () => {
    const s = run(...searched("게임", [zelda]), pick(zelda), withDates, { type: "back" });
    expect(s.dates).toEqual(EMPTY_DATES);
  });

  it("같은 게임을 다시 골라도 비워진다 — picked 가 규칙의 정본이라 경로가 갈리지 않는다", () => {
    const s = run(...searched("젤다", [zelda]), pick(zelda), withDates, pick(zelda));
    expect(s.dates).toEqual(EMPTY_DATES);
  });

  it("수동 입력으로 넘어갈 때도 이전 날짜는 끊긴다", () => {
    const s = run(
      ...searched("젤다", [zelda]),
      pick(zelda),
      withDates,
      { type: "back" },
      { type: "queryChanged", query: "없는게임" },
      { type: "searchSucceeded", query: "없는게임", results: [] },
      { type: "manualPicked" },
    );
    expect(s.selected?.categoryValue).toBe("없는게임");
    expect(s.dates).toEqual(EMPTY_DATES);
  });

  it("상세 안에서 고친 날짜는 유지된다 — 비우는 건 선택 전환뿐이다", () => {
    const s = run(...searched("젤다", [zelda]), pick(zelda), withDates);
    expect(s.dates).toEqual({ playedAt: "2026-01-05", clearedAt: "2026-02-10" });
  });
});

/* 검색 응답은 비동기라 **도착 시점의 화면**이 제출 시점과 다를 수 있다. 여기 네 케이스가
   실제로 터졌던 경로다 — 특히 늦게 온 0건이 비상구를 열어 치지직에 있는 게임을
   categoryId=null 중복 행으로 넣는 길(NULL 은 UNIQUE 밖이라 서버도 못 막는다). */
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
      { type: "searchSucceeded", query: "마인크래프트", results: [zelda, mario] },
      // 늦게 도착한 "zzz" 의 0건.
      { type: "searchSucceeded", query: "zzz", results: [] },
    );
    expect(s.results).toHaveLength(2);
    // 비상구가 열렸다면 '마인크래프트 검색 결과가 없어요'라고 거짓말하는 화면이었다.
    expect(showsManualEntry(s)).toBe(false);
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

  it("수동 입력으로 넘어가도 지워진다", () => {
    const s = run(...searched("없는게임", []), { type: "manualPicked" });
    expect(s.searchError).toBe("");
  });

  it("뒤로 돌아온 검색 화면에도 옛 에러가 없다", () => {
    const s = run(typed, failed, pick(zelda), { type: "back" });
    expect(s.searchError).toBe("");
  });

  /* 같은 검색어로 재시도하면 queryChanged 가 안 오므로, searchStarted 가 없으면 옛 실패 문구가
     응답이 올 때까지 '검색 중…' 과 한 화면에 공존한다. */
  it("같은 검색어로 다시 제출하면 옛 실패 문구가 지워진다", () => {
    const s = run(typed, failed, { type: "searchStarted" });
    expect(s.searchError).toBe("");
    // 제출은 아직 답이 아니다 — 결과·비상구 상태를 건드리면 안 된다.
    expect(s.query).toBe("젤다");
    expect(showsManualEntry(s)).toBe(false);
  });
});

/* 버리는 동작 자체는 옳다(위 "늦게 온 검색 응답"). 여기서 못박는 건 **버렸다는 흔적**이다 —
   안 남기면 목록도 에러도 없는 빈 화면만 남아 왜 아무것도 안 나왔는지 알 길이 없다. */
describe("버린 검색의 흔적", () => {
  it("검색어가 바뀌어 응답을 버리면 안내가 선다", () => {
    const s = run(
      ...searched("젤다", [zelda]),
      { type: "queryChanged", query: "젤다2" },
      { type: "searchSucceeded", query: "젤다", results: [zelda] },
    );
    expect(s.staleDropped).toBe(true);
    // 안내지 에러가 아니다 — 통신은 성공했다.
    expect(s.searchError).toBe("");
    expect(s.results).toEqual([]);
  });

  it("버린 게 실패 응답이어도 흔적은 남는다 — 화면이 비는 건 똑같다", () => {
    const s = run(
      { type: "queryChanged", query: "젤다" },
      { type: "queryChanged", query: "젤다2" },
      { type: "searchFailed", query: "젤다", message: "검색에 실패했어요." },
    );
    expect(s.staleDropped).toBe(true);
    // 옛 검색의 실패 문구는 여전히 안 뜬다.
    expect(s.searchError).toBe("");
  });

  it("상세 단계에서 버린 건 안내하지 않는다 — 뒤로 가면 결과가 그대로 있어 빈 화면이 아니다", () => {
    const s = run(...searched("젤다", [zelda]), pick(zelda), {
      type: "searchSucceeded",
      query: "젤다",
      results: [mario],
    });
    expect(s.staleDropped).toBe(false);
  });

  it("다시 검색을 제출하면 안내가 걷힌다", () => {
    const s = run(
      ...searched("젤다", [zelda]),
      { type: "queryChanged", query: "젤다2" },
      { type: "searchSucceeded", query: "젤다", results: [zelda] },
      { type: "searchStarted" },
    );
    expect(s.staleDropped).toBe(false);
  });

  it("검색어를 더 고쳐도 안내는 남는다 — '다시 검색해라'는 여전히 참이다", () => {
    const s = run(
      ...searched("젤다", [zelda]),
      { type: "queryChanged", query: "젤다2" },
      { type: "searchSucceeded", query: "젤다", results: [zelda] },
      { type: "queryChanged", query: "젤다23" },
    );
    expect(s.staleDropped).toBe(true);
  });

  /* 안내가 선 상태에서 목록이 다시 생기거나 화면이 넘어가면 안내는 거짓이 된다 — 어느 경로로
     빠져나가든 걷힌다(searchStarted 가 이미 걷지만 전이 하나만 봐도 모순이 없어야 한다). */
  it.each([
    ["결과 도착", { type: "searchSucceeded", query: "젤다2", results: [mario] } as ComposerAction],
    ["검색 실패", { type: "searchFailed", query: "젤다2", message: "실패" } as ComposerAction],
    ["게임 선택", pick(mario)],
    ["수동 입력", { type: "manualPicked" } as ComposerAction],
  ])("%s 하면 걷힌다", (_label, action) => {
    const dropped = run(
      ...searched("젤다", [zelda]),
      { type: "queryChanged", query: "젤다2" },
      { type: "searchSucceeded", query: "젤다", results: [zelda] },
    );
    expect(dropped.staleDropped).toBe(true);
    expect(composerReducer(dropped, action).staleDropped).toBe(false);
  });

  it("상세로 갔다 뒤로 돌아와도 안내는 없다 — 결과 목록이 남아 있어 빈 화면이 아니다", () => {
    const s = run(
      ...searched("젤다", [zelda]),
      { type: "queryChanged", query: "젤다2" },
      { type: "searchSucceeded", query: "젤다", results: [zelda] },
      pick(mario),
      { type: "back" },
    );
    expect(s.staleDropped).toBe(false);
  });

  it("열자마자는 안 뜬다", () => {
    expect(initialComposerState.staleDropped).toBe(false);
  });
});

describe("수동 입력 비상구", () => {
  it("열자마자는 안 뜬다 — 아직 안 찾은 것과 찾았는데 없는 것은 다르다", () => {
    expect(showsManualEntry(initialComposerState)).toBe(false);
    expect(showsManualEntry(run({ type: "queryChanged", query: "젤다" }))).toBe(false);
  });

  it("결과 0건일 때만 뜬다", () => {
    expect(showsManualEntry(run(...searched("없는게임", [])))).toBe(true);
    expect(showsManualEntry(run(...searched("젤다", [zelda])))).toBe(false);
  });

  it("검색 실패는 '결과 없음'이 아니다 — 비상구가 열리면 안 된다", () => {
    const s = run(
      { type: "queryChanged", query: "젤다" },
      { type: "searchFailed", query: "젤다", message: "검색에 실패했어요." },
    );
    expect(showsManualEntry(s)).toBe(false);
    // 실패한 검색의 이전 결과도 남지 않는다.
    expect(s.results).toEqual([]);
  });

  it("검색어를 다시 고치면 비상구가 접힌다 — 옛 검색어의 결론이라", () => {
    const s = run(...searched("없는게임", []), { type: "queryChanged", query: "없는게임2" });
    expect(showsManualEntry(s)).toBe(false);
  });

  it("검색어를 고치면 옛 결과 목록도 사라진다 — 검색어와 무관한 목록이 남으면 안 된다", () => {
    const s = run(...searched("젤다", [zelda, mario]), { type: "queryChanged", query: "마리오" });
    expect(s.results).toEqual([]);
    expect(s.searched).toBe(false);
  });

  it("검색어가 공백뿐이면 붙일 제목이 없어 닫는다", () => {
    expect(showsManualEntry(run(...searched("   ", [])))).toBe(false);
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
