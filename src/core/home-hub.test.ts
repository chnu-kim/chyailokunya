import { describe, expect, it } from "vitest";
import { toIsoDate } from "./calendar";
import { homeHubStatus } from "./home-hub";

const SAT = toIsoDate("2026-10-03"); // 토요일 — 그 주는 9.28(월) ~ 10.4(일)

describe("homeHubStatus", () => {
  it("이번 주 범위를 그 주 월요일부터 일요일까지로 적는다", () => {
    const s = homeHubStatus({ today: SAT, weekPublished: false, recentGame: null });
    expect(s.weekRange).toBe("9.28 – 10.4");
  });

  it("월요일 당일도 같은 주로 읽는다(주 경계)", () => {
    const s = homeHubStatus({
      today: toIsoDate("2026-09-28"),
      weekPublished: false,
      recentGame: null,
    });
    expect(s.weekRange).toBe("9.28 – 10.4");
  });

  it("발행 여부를 표기로 말한다", () => {
    expect(homeHubStatus({ today: SAT, weekPublished: true, recentGame: null }).scheduleState).toBe(
      "공개",
    );
    expect(
      homeHubStatus({ today: SAT, weekPublished: false, recentGame: null }).scheduleState,
    ).toBe("준비 중");
  });

  it("최근 게임은 받은 값을 그대로 싣는다", () => {
    expect(
      homeHubStatus({ today: SAT, weekPublished: false, recentGame: "겟 투 워크" }).recentGame,
    ).toBe("겟 투 워크");
    expect(homeHubStatus({ today: SAT, weekPublished: false, recentGame: null }).recentGame).toBe(
      null,
    );
  });
});
