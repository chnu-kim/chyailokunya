import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { WeekView } from "@/features/schedule/service";
import { ScheduleReadView } from "./schedule-read";

/* 오늘 표시(2026-07-29)를 e2e 가 아니라 여기서 못박는 이유: 오늘이 어느 주에 드는지는 **실행
   시점**에 달렸는데, e2e 에서 그걸 재려면 "이번 주"를 발행해야 한다 — 그 순간 같은 픽스처를
   공유하는 schedule.spec 의 "미발행 현재 주는 준비 중 빈 상태"가 조용히 깨진다(AGENTS 의
   "e2e 스펙은 D1 픽스처 하나를 공유한다"와 같은 자리). 이 컴포넌트는 today 를 prop 으로 받아
   서버가 계산한 값을 그리기만 하므로, 날짜를 직접 주면 시점 의존 없이 계약을 잴 수 있다. */

const WEEK_START = "2026-07-27";

const WEEK: WeekView = {
  weekStartDate: WEEK_START,
  note: "8월 첫째 주는 정기 휴방 주간입니다.",
  publishedAt: 1753600000000,
  draft: false,
  revision: 1753600000000,
  days: [],
  entries: [
    {
      id: 1,
      scheduledDate: "2026-07-27",
      title: "겟 투 워크 켠왕",
      gameId: null,
      createdAt: 1753600000000,
      lastUpdatedAt: 1753600000000,
    },
  ],
};

function renderRead(today: string) {
  return render(
    <ScheduleReadView
      weekStartDate={WEEK_START}
      week={WEEK}
      games={[]}
      currentWeek={WEEK_START}
      today={today}
    />,
  );
}

describe("ScheduleReadView 의 오늘 표시", () => {
  it("오늘 칸에만 칩과 aria-current 가 붙는다", () => {
    renderRead("2026-07-29");

    const today = screen.getByTestId("schedule-day-2026-07-29");
    expect(within(today).getByText("오늘")).toBeInTheDocument();
    expect(today).toHaveAttribute("aria-current", "date");

    /* 나머지 엿새엔 속성 자체가 없어야 한다 — aria-current="false" 를 달면 "이 집합에 현재
       항목이 있다"는 신호가 일곱 번 나가 오늘이 어느 칸인지가 도로 흐려진다. */
    for (const date of ["2026-07-27", "2026-07-28", "2026-07-30", "2026-08-02"]) {
      const day = screen.getByTestId(`schedule-day-${date}`);
      expect(day).not.toHaveAttribute("aria-current");
      expect(within(day).queryByText("오늘")).not.toBeInTheDocument();
    }
  });

  it("오늘이 다른 주에 있으면 어느 칸에도 안 붙는다", () => {
    // 지난주·다음주를 열어 보는 흔한 조작에서 엉뚱한 칸이 오늘로 서면 안 된다.
    renderRead("2026-08-05");
    expect(screen.queryByText("오늘")).not.toBeInTheDocument();
  });

  it("공지는 카드 미리보기보다 앞에 온다", () => {
    /* 순서가 뒤집히면 카드 안 공지(week-card__note)와 같은 문장이 200px 안에서 두 번 보인다
       — 그 중복을 없애려고 정한 순서라 문서 순서로 못박는다(schedule-read.tsx 주석). */
    renderRead("2026-07-29");
    const note = screen.getByTestId("schedule-note");
    const card = screen.getByTestId("week-card-download");
    expect(note.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
