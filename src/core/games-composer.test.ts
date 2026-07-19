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
  { type: "searchSucceeded", results },
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
      { type: "searchSucceeded", results: [] },
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
    const s = run({ type: "queryChanged", query: "젤다" }, { type: "searchFailed" });
    expect(showsManualEntry(s)).toBe(false);
    // 실패한 검색의 이전 결과도 남지 않는다.
    expect(s.results).toEqual([]);
  });

  it("검색어를 다시 고치면 비상구가 접힌다 — 옛 검색어의 결론이라", () => {
    const s = run(...searched("없는게임", []), { type: "queryChanged", query: "없는게임2" });
    expect(showsManualEntry(s)).toBe(false);
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
