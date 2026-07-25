import { describe, expect, it } from "vitest";
import {
  diffSuggestion,
  isEmptyEditSuggestion,
  isSuggestedValuesValid,
  type CurrentValues,
  type SuggestedValues,
} from "./suggestions";

// 안 깬 게임 + 플레이 기록 하나. 대부분의 제안이 이 상태에서 출발한다.
const current: CurrentValues = { cleared: false, clearedDate: null, lastPlayed: "2026-07-11" };
const same: SuggestedValues = { cleared: false, clearedDate: null, playedDate: "2026-07-11" };

describe("diffSuggestion", () => {
  it("지금 값과 같으면 아무 변경도 없다", () => {
    expect(diffSuggestion(current, same)).toEqual([]);
  });

  it("클리어를 켜면서 날짜를 붙이면 두 줄이다", () => {
    expect(
      diffSuggestion(current, {
        cleared: true,
        clearedDate: "2026-07-20",
        playedDate: "2026-07-11",
      }),
    ).toEqual([
      { field: "cleared", from: false, to: true },
      { field: "clearedDate", from: null, to: "2026-07-20" },
    ]);
  });

  it("깬 채로 클리어한 날만 고치면 그 한 줄이다", () => {
    const cleared: CurrentValues = {
      cleared: true,
      clearedDate: "2026-07-20",
      lastPlayed: "2026-07-11",
    };
    expect(
      diffSuggestion(cleared, {
        cleared: true,
        clearedDate: "2026-07-21",
        playedDate: "2026-07-11",
      }),
    ).toEqual([{ field: "clearedDate", from: "2026-07-20", to: "2026-07-21" }]);
  });

  /* 플래그가 내려가면 날짜는 딸려서 비는 것이라(games CHECK) 별도 변경으로 세지 않는다 —
     세면 관리자가 두 줄을 읽고 같은 사실을 두 번 판단한다. */
  it("클리어를 푸는 제안은 날짜 줄을 접고 플래그 한 줄만 남긴다", () => {
    const cleared: CurrentValues = {
      cleared: true,
      clearedDate: "2026-07-20",
      lastPlayed: "2026-07-11",
    };
    expect(
      diffSuggestion(cleared, { cleared: false, clearedDate: null, playedDate: "2026-07-11" }),
    ).toEqual([{ field: "cleared", from: true, to: false }]);
  });

  it("'깼는데 날짜 모름'으로 가는 제안도 플래그 한 줄이다", () => {
    expect(
      diffSuggestion(current, { cleared: true, clearedDate: null, playedDate: "2026-07-11" }),
    ).toEqual([{ field: "cleared", from: false, to: true }]);
  });

  it("플레이한 날 변경을 센다 — 아직 기록이 없던 게임도", () => {
    expect(diffSuggestion(current, { ...same, playedDate: "2026-07-20" })).toEqual([
      { field: "playedDate", from: "2026-07-11", to: "2026-07-20" },
    ]);
    expect(
      diffSuggestion({ cleared: false, clearedDate: null, lastPlayed: null }, { ...same }),
    ).toEqual([{ field: "playedDate", from: null, to: "2026-07-11" }]);
  });

  it("플레이한 날을 비우는 제안도 변경이다 — 연결 해제를 뜻한다", () => {
    expect(diffSuggestion(current, { ...same, playedDate: null })).toEqual([
      { field: "playedDate", from: "2026-07-11", to: null },
    ]);
  });
});

describe("isEmptyEditSuggestion", () => {
  it("값도 그대로고 한마디도 없으면 아무 말도 안 하는 제안이다", () => {
    expect(isEmptyEditSuggestion(current, same, null)).toBe(true);
    expect(isEmptyEditSuggestion(current, same, "   ")).toBe(true);
  });

  /* 값으로 표현 못 하는 제보(제목 오타·포스터 오류)는 관리자도 폼으로 못 고치는 스냅샷
     필드라 글로만 전할 수 있다 — 값 변경을 필수로 두면 그 길이 막힌다. */
  it("한마디만 있어도 유효하다", () => {
    expect(isEmptyEditSuggestion(current, same, "포스터가 다른 게임이에요")).toBe(false);
  });

  it("값이 바뀌면 한마디가 없어도 유효하다", () => {
    expect(isEmptyEditSuggestion(current, { ...same, playedDate: "2026-07-20" }, null)).toBe(false);
  });
});

describe("isSuggestedValuesValid", () => {
  it("안 깬 게임에 클리어 날짜가 붙으면 거짓 — games CHECK 와 같은 판정", () => {
    expect(
      isSuggestedValuesValid({ cleared: false, clearedDate: "2026-07-20", playedDate: null }),
    ).toBe(false);
  });

  it("깬 채 날짜를 모르는 건 참", () => {
    expect(isSuggestedValuesValid({ cleared: true, clearedDate: null, playedDate: null })).toBe(
      true,
    );
  });
});
