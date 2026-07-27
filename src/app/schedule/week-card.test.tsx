import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { WeekCardData } from "@/features/schedule/card";
import { WeekCard } from "./week-card";

/* 스냅샷이 아니라 명시적 단언으로 못박는다(이슈 #109 작업순서 1) — 이 컴포넌트는 데이터를
   받은 대로 그리기만 하므로(7일 폴딩·하루 상한은 작업순서 2 의 buildWeekCard 몫), 각 필드가
   화면의 어느 자리에 어떤 모양으로 나오는지만 확인하면 된다. */

const CARD: WeekCardData = {
  rangeLabel: "7.20 – 7.26",
  note: "임시 휴방 있습니다",
  days: [
    { dow: "월", date: "7.20", entries: [{ time: "21:00", title: "저챗" }], overflow: 0 },
    { dow: "화", date: "7.21", entries: [{ time: null, title: "심야 게임" }], overflow: 0 },
    { dow: "수", date: "7.22", entries: [], overflow: 0 },
    {
      dow: "목",
      date: "7.23",
      entries: [{ time: "20:00", title: "항목 1" }],
      overflow: 2,
    },
    { dow: "금", date: "7.24", entries: [], overflow: 0 },
    { dow: "토", date: "7.25", entries: [{ time: "19:00", title: "주말 방송" }], overflow: 0 },
    { dow: "일", date: "7.26", entries: [], overflow: 0 },
  ],
};

describe("WeekCard", () => {
  it("주 범위와 요일별 라벨을 그대로 그린다", () => {
    render(<WeekCard card={CARD} />);
    expect(screen.getByText("7.20 – 7.26")).toBeInTheDocument();
    for (const day of CARD.days) {
      const el = screen.getByTestId(`week-card-day-${day.date}`);
      expect(within(el).getByText(day.dow)).toBeInTheDocument();
      expect(within(el).getByText(day.date)).toBeInTheDocument();
    }
  });

  it("항목 없는 날은 빈 표기(—)와 스크린리더용 텍스트를 함께 그린다", () => {
    render(<WeekCard card={CARD} />);
    const wed = screen.getByTestId("week-card-day-7.22");
    expect(within(wed).getByText("—")).toBeInTheDocument();
    expect(within(wed).getByText("일정 없음")).toBeInTheDocument();
  });

  it("항목이 있으면 제목을 그리고, 시각이 있을 때만 시각 배지를 그린다", () => {
    render(<WeekCard card={CARD} />);
    const mon = screen.getByTestId("week-card-day-7.20");
    expect(within(mon).getByText("저챗")).toBeInTheDocument();
    expect(within(mon).getByText("21:00")).toBeInTheDocument();

    const tue = screen.getByTestId("week-card-day-7.21");
    expect(within(tue).getByText("심야 게임")).toBeInTheDocument();
    expect(tue.querySelector(".week-card__entry-time")).toBeNull();
  });

  it("overflow 가 0 보다 클 때만 '+N개' 칩을 그린다", () => {
    render(<WeekCard card={CARD} />);
    const thu = screen.getByTestId("week-card-day-7.23");
    expect(within(thu).getByText("+2개")).toBeInTheDocument();

    const mon = screen.getByTestId("week-card-day-7.20");
    expect(within(mon).queryByText(/^\+\d+개$/)).toBeNull();
  });

  it("토·일요일 요일 라벨만 주말 색 클래스를 받는다", () => {
    render(<WeekCard card={CARD} />);
    expect(within(screen.getByTestId("week-card-day-7.20")).getByText("월")).not.toHaveClass(
      "week-card__dow--weekend",
    );
    expect(within(screen.getByTestId("week-card-day-7.25")).getByText("토")).toHaveClass(
      "week-card__dow--weekend",
    );
    expect(within(screen.getByTestId("week-card-day-7.26")).getByText("일")).toHaveClass(
      "week-card__dow--weekend",
    );
  });

  it("공지가 있으면 그리고, 없으면(null) 안 그린다", () => {
    const { container, rerender } = render(<WeekCard card={CARD} />);
    expect(screen.getByText("임시 휴방 있습니다")).toBeInTheDocument();

    rerender(<WeekCard card={{ ...CARD, note: null }} />);
    expect(container.querySelector(".week-card__note")).toBeNull();
  });
});
