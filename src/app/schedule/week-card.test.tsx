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
    {
      dow: "월",
      date: "7.20",
      time: "21:00",
      rest: false,
      entries: [{ title: "저챗" }],
      overflow: 0,
    },
    {
      dow: "화",
      date: "7.21",
      time: null,
      rest: false,
      entries: [{ title: "심야 게임" }],
      overflow: 0,
    },
    { dow: "수", date: "7.22", time: null, rest: false, entries: [], overflow: 0 },
    {
      dow: "목",
      date: "7.23",
      time: null,
      rest: false,
      entries: [{ title: "항목 1" }],
      overflow: 2,
    },
    { dow: "금", date: "7.24", time: null, rest: false, entries: [], overflow: 0 },
    {
      dow: "토",
      date: "7.25",
      time: null,
      rest: true,
      entries: [],
      overflow: 0,
    },
    { dow: "일", date: "7.26", time: null, rest: false, entries: [], overflow: 0 },
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

  it("시각은 요일 옆에 한 번만 선다 — 항목마다 반복하지 않는다", () => {
    /* 시각이 하루의 속성이 되면서(이슈 #117) 배지 자리가 항목에서 요일 라벨로 옮겼다.
       시각 없는 날은 배지 자체가 없다(미정을 빈칸으로 두는 게 이 카드의 표기다). */
    render(<WeekCard card={CARD} />);
    const mon = screen.getByTestId("week-card-day-7.20");
    expect(within(mon).getByText("저챗")).toBeInTheDocument();
    expect(within(mon).getByText("21:00")).toBeInTheDocument();
    expect(mon.querySelectorAll(".week-card__time")).toHaveLength(1);

    const tue = screen.getByTestId("week-card-day-7.21");
    expect(within(tue).getByText("심야 게임")).toBeInTheDocument();
    expect(tue.querySelector(".week-card__time")).toBeNull();
  });

  it("휴방인 날은 항목 대신 휴방이라고 말한다", () => {
    /* "아직 미정"(—)과 다른 사실이라 카드가 달리 그린다 — 카페·트위터에 올라간 그림에서 둘이
       같은 모양이면 팬이 "정해지면 올라오겠지"로 읽는다(이슈 #117 결정 4). */
    render(<WeekCard card={CARD} />);
    const rest = screen.getByTestId("week-card-day-7.25");
    expect(within(rest).getByText("휴방")).toBeInTheDocument();
    expect(within(rest).queryByText("주말 방송")).not.toBeInTheDocument();
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
