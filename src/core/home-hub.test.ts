import { describe, expect, it } from "vitest";
import { toIsoDate } from "./calendar";
import { homeHubStatus } from "./home-hub";

const SAT = toIsoDate("2026-10-03"); // 토요일 — 그 주는 9.28(월) ~ 10.4(일)

describe("homeHubStatus", () => {
  it("이번 주 범위를 그 주 월요일부터 일요일까지로 적는다", () => {
    const s = homeHubStatus({ today: SAT, weekPublished: false, gamesByRecency: [] });
    expect(s.weekRange).toBe("9.28 – 10.4");
  });

  it("월요일 당일도 같은 주로 읽는다(주 경계)", () => {
    const s = homeHubStatus({
      today: toIsoDate("2026-09-28"),
      weekPublished: false,
      gamesByRecency: [],
    });
    expect(s.weekRange).toBe("9.28 – 10.4");
  });

  it("발행 여부를 표기로 말한다", () => {
    expect(
      homeHubStatus({ today: SAT, weekPublished: true, gamesByRecency: [] }).scheduleState,
    ).toBe("공개");
    expect(
      homeHubStatus({ today: SAT, weekPublished: false, gamesByRecency: [] }).scheduleState,
    ).toBe("준비 중");
  });

  it("최근 게임은 플레이 기록이 있는 첫 게임이다", () => {
    const s = homeHubStatus({
      today: SAT,
      weekPublished: false,
      gamesByRecency: [
        { categoryValue: "겟 투 워크", lastPlayed: "2026-09-30" },
        { categoryValue: "팰월드", lastPlayed: "2026-09-01" },
      ],
    });
    expect(s.recentGame).toBe("겟 투 워크");
  });

  /* 순서를 다시 매기지 않는다는 계약 — 정렬의 정본은 listGames 의 SQL 이다. 이 단언이 없으면
     여기서 날짜로 재정렬하는 변경이 초록으로 지나가고, 두 자리의 규칙이 갈린다. */
  it("받은 순서를 그대로 믿는다(재정렬하지 않는다)", () => {
    const s = homeHubStatus({
      today: SAT,
      weekPublished: false,
      gamesByRecency: [
        { categoryValue: "먼저 온 것", lastPlayed: "2026-01-01" },
        { categoryValue: "날짜는 더 늦은 것", lastPlayed: "2026-09-30" },
      ],
    });
    expect(s.recentGame).toBe("먼저 온 것");
  });

  it("기록 없는 게임은 건너뛰고, 하나도 없으면 null 이다", () => {
    expect(
      homeHubStatus({
        today: SAT,
        weekPublished: false,
        gamesByRecency: [
          { categoryValue: "기록 없음", lastPlayed: null },
          { categoryValue: "기록 있음", lastPlayed: "2026-09-01" },
        ],
      }).recentGame,
    ).toBe("기록 있음");
    expect(
      homeHubStatus({
        today: SAT,
        weekPublished: false,
        gamesByRecency: [{ categoryValue: "기록 없음", lastPlayed: null }],
      }).recentGame,
    ).toBeNull();
  });
});
