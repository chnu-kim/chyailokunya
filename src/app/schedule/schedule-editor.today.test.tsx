import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { WeekView } from "@/features/schedule/service";
import { ScheduleEditor } from "./schedule-editor";

/* 편집기의 오늘 칸(2026-07-31).

   읽기 화면은 진작 오늘을 표시했는데(`schedule-read.tsx`) **편집기만 없었다** — 정작 한 주를
   짜는 사람이 "지금 어느 칸인가"를 못 봤다. 주간 일정표에서 그건 첫 질문이다.

   `today` 는 **서버가 준다**(page.tsx). 클라이언트가 다시 읽으면 안 되는 이유가 둘이다:
   `Temporal.Now` 는 배포 Workers 에서 에포크 0 을 돌려주고(eslint 가 막는다), `Date.now()` 로
   읽더라도 SSR 이 그린 주와 갈리는 순간 하이드레이션이 튄다. 그래서 이 스펙은 prop 으로 들어온
   값이 화면에 그대로 반영되는지만 본다 — 시계를 읽는 자리가 아니다.

   **칩과 속성을 함께 잰다.** 칩 글자는 시각 사용자에게만 가고 `aria-current` 는 보조 기술에만
   간다 — 한쪽만 재면 나머지 절반이 빠져도 초록이다. */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    schedule: { saveWeek: { mutate: vi.fn() }, publishWeek: { mutate: vi.fn() } },
    chzzk: { categorySearch: { query: vi.fn() } },
    games: { add: { mutate: vi.fn() } },
  },
}));
vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const WEEK_START = "2036-06-02"; // 월요일
const WEDNESDAY = "2036-06-04";

const WEEK: WeekView = {
  weekStartDate: WEEK_START,
  note: null,
  publishedAt: null,
  draft: false,
  revision: 1,
  fanartImageKey: null,
  fanartCredit: null,
  fanartImageWidth: null,
  fanartImageHeight: null,
  entries: [],
  days: [],
};

function renderWith(today: string) {
  const { container } = render(
    <ScheduleEditor
      weekStartDate={WEEK_START}
      initialWeek={WEEK}
      games={[]}
      currentWeek={WEEK_START}
      today={today}
    />,
  );
  return container;
}

describe("ScheduleEditor — 오늘 칸", () => {
  it("오늘이 그 주 안이면 그 날에만 표시가 붙는다", () => {
    const container = renderWith(WEDNESDAY);

    const wed = container.querySelector(`[data-od-id="schedule-day-${WEDNESDAY}"]`)!;
    expect(wed).toHaveClass("sched-day--today");
    expect(wed).toHaveAttribute("aria-current", "date");
    expect(wed).toHaveTextContent("오늘");

    // **다른 날엔 안 붙는다** — 이 단언이 없으면 "전부 오늘"로 그려도 위가 통과한다.
    expect(container.querySelectorAll(".sched-day--today")).toHaveLength(1);
    expect(container.querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  it("오늘이 그 주 밖이면 어느 칸에도 안 붙는다", () => {
    // 지난 주를 열어 둔 상태 — 그 주엔 오늘이 없으므로 아무 칸도 오늘이 아니다.
    const container = renderWith("2036-05-25");

    expect(container.querySelectorAll(".sched-day--today")).toHaveLength(0);
    /* `aria-current="false"` 를 다는 것도 아니어야 한다 — 그건 "이 집합에 현재 항목이 있다"는
       잘못된 신호다(읽기 화면의 같은 자리 주석). 속성 자체가 없어야 한다. */
    expect(container.querySelectorAll("[aria-current]")).toHaveLength(0);
  });
});
