import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RecentGameStatus, ScheduleStatus } from "./home-status";

const HUB = {
  weekRange: "9.28 – 10.4",
  scheduleState: "준비 중",
  recentGame: "겟 투 워크",
} as const;

describe("홈 카드 상태 줄", () => {
  it("일정 상태는 범위와 발행 여부를 낱말 사이 공백과 함께 말한다(접근 이름이 붙지 않게)", () => {
    const { container } = render(<ScheduleStatus hub={HUB} />);
    expect(container.textContent).toBe("이번 주 9.28 – 10.4 준비 중");
  });

  it("최근 게임 줄은 이름을 싣는다", () => {
    const { container } = render(<RecentGameStatus hub={HUB} />);
    expect(container.textContent).toBe("최근 겟 투 워크");
  });

  /* 조회 실패(hub null)나 기록 없음은 줄을 아예 안 그린다 — "준비 중"이나 빈 칸으로 꾸미면
     모르는 것을 아는 척하게 된다. */
  it("값이 없으면 아무것도 그리지 않는다", () => {
    expect(render(<ScheduleStatus hub={null} />).container.innerHTML).toBe("");
    expect(render(<RecentGameStatus hub={null} />).container.innerHTML).toBe("");
    expect(
      render(<RecentGameStatus hub={{ ...HUB, recentGame: null }} />).container.innerHTML,
    ).toBe("");
  });
});
