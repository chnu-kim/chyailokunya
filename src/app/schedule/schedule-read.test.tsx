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
  /* 기본은 "팬아트 없는 주"다 — 아래 팬아트 테스트가 필요한 값만 얹어 rerender 한다. 치수는
     그림이 있어도 없을 수 있어(브라우저가 못 디코드한 파일) 두 경로를 따로 잰다. */
  fanartImageKey: null,
  fanartCredit: null,
  fanartImageWidth: null,
  fanartImageHeight: null,
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

  it("항목이 없어도 그날 시각은 보인다 — 공유 카드와 같은 값을 말한다", () => {
    /* 시각을 항목 행 안에 두면 "시각은 정했는데 뭘 할지 아직 안 정한 날"에서 화면이 그 값을
       통째로 숨긴다. 공유 카드는 요일 옆에 그리므로 두 화면이 어긋난다(코드 리뷰 지적). */
    render(
      <ScheduleReadView
        weekStartDate={WEEK_START}
        week={{
          ...WEEK,
          entries: [],
          days: [
            {
              id: 1,
              scheduledDate: "2026-07-30",
              startTime: "21:00",
              rest: false,
              createdAt: 0,
              lastUpdatedAt: 0,
            },
          ],
        }}
        games={[]}
        currentWeek={WEEK_START}
        today="2026-07-29"
      />,
    );
    const day = screen.getByTestId("schedule-day-2026-07-30");
    expect(within(day).getByText("21:00")).toBeInTheDocument();
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

describe("ScheduleReadView 의 팬아트(ADR-0028)", () => {
  const KEY = "0189d1f0-3a4b-7c8d-9e0f-1a2b3c4d5e6f.png";

  function renderFanart(over: Partial<WeekView>) {
    return render(
      <ScheduleReadView
        weekStartDate={WEEK_START}
        week={{ ...WEEK, ...over }}
        games={[]}
        currentWeek={WEEK_START}
        today="2026-07-29"
      />,
    );
  }

  it("목록 아래에 사진지로 서고, 표기는 있을 때만 붙는다", () => {
    /* 이 화면의 주인공은 일정이라 팬아트가 목록을 밀어내면 안 된다(문서 순서로 못박는다).
       표기는 선택이다 — 작가를 모르거나 본인이 그린 경우가 있다. */
    const { rerender } = renderFanart({ fanartImageKey: KEY, fanartCredit: "그린 사람" });
    const fanart = screen.getByTestId("schedule-fanart");
    // 화면은 키에서 서빙 경로를 조립한다 — DB 엔 조각만 산다(core/fanart 가 형식의 정본).
    expect(within(fanart).getByAltText("팬아트")).toHaveAttribute("src", `/api/fanart/${KEY}`);
    expect(within(fanart).getByText("그린 사람")).toBeInTheDocument();

    const list = screen.getByTestId("schedule-days");
    expect(list.compareDocumentPosition(fanart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(
      <ScheduleReadView
        weekStartDate={WEEK_START}
        week={{ ...WEEK, fanartImageKey: KEY, fanartCredit: null }}
        games={[]}
        currentWeek={WEEK_START}
        today="2026-07-29"
      />,
    );
    expect(screen.queryByText("그린 사람")).not.toBeInTheDocument();
    expect(screen.getByAltText("팬아트")).toBeInTheDocument();
  });

  it("팬아트가 없으면 그 자리 자체가 없다", () => {
    renderFanart({});
    expect(screen.queryByTestId("schedule-fanart")).not.toBeInTheDocument();
  });

  it("치수가 있으면 width·height 로 자리를 예약하고, 없으면 속성을 안 단다", () => {
    /* 속성이 있어야 그림이 로드되기 전에 브라우저가 비율을 알고 자리를 비운다 — 없으면 lazy
       로드가 끝나는 순간 아래(푸터)가 밀린다. 그래서 치수를 컬럼으로 저장한다(db/schema.ts).

       **없을 때 안 다는 것도 계약이다.** 반쪽(width 만)을 주면 브라우저가 비율을 잘못 잡아
       그림이 늘어난다 — 있으나 없으나 둘 다 온전한 상태로만 그린다. */
    const { rerender } = renderFanart({
      fanartImageKey: KEY,
      fanartImageWidth: 1200,
      fanartImageHeight: 1600,
    });
    const img = screen.getByAltText("팬아트");
    expect(img).toHaveAttribute("width", "1200");
    expect(img).toHaveAttribute("height", "1600");

    // 브라우저가 못 디코드한 파일 — 그림은 그대로 뜨고 예약만 없다(우아한 저하).
    rerender(
      <ScheduleReadView
        weekStartDate={WEEK_START}
        week={{ ...WEEK, fanartImageKey: KEY }}
        games={[]}
        currentWeek={WEEK_START}
        today="2026-07-29"
      />,
    );
    const plain = screen.getByAltText("팬아트");
    expect(plain).not.toHaveAttribute("width");
    expect(plain).not.toHaveAttribute("height");
  });
});
