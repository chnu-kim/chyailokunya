import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { WeekView } from "@/features/schedule/service";
import { ScheduleEditor } from "./schedule-editor";

/* 연결된 게임이 **눈에 보이는가**(적대적 리뷰 지적, 2026-07-31).

   게임 트리거가 44×44 아이콘이 되면서 게임명이 `aria-label`·`title` 로 옮겨갔는데, `title` 은
   hover 전용이라 터치·키보드 사용자에겐 없는 것과 같고 표지 없는 게임은 이니셜 한 글자로
   접힌다. `gameId` 는 저장돼 공개 화면과 게임 보드를 좌우하므로, 잘못 이어진 항목을 화면에서
   잡을 길이 없으면 그대로 나간다.

   그래서 **제목이 게임명을 대신 말하지 못할 때만** 행 아래에 연결을 적는다. 이 스펙은 그 두
   갈래를 모두 잰다 — 한쪽만 재면 "항상 적는다"로 바뀌어도(아이콘화로 얻은 자리를 도로 내주는
   변경) 초록이다. */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    schedule: { saveWeek: { mutate: vi.fn() }, publishWeek: { mutate: vi.fn() } },
    chzzk: { categorySearch: { query: vi.fn() } },
    games: { add: { mutate: vi.fn() } },
  },
}));
vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const WEEK_START = "2036-06-02";
const GAMES = [{ id: 7, categoryValue: "엘든 링", posterImageUrl: null }];
/* 오늘 칸 표시는 이 스펙의 관심사가 아니라 **그 주 밖의 날**을 준다 — 그 주 안의 날을 주면
   "오늘" 칩과 `sched-day--today` 가 끼어 여기서 재는 것과 무관한 이유로 마크업이 흔들린다. */
const OTHER_WEEK = "2036-05-25";

function weekWith(title: string): WeekView {
  return {
    weekStartDate: WEEK_START,
    note: null,
    publishedAt: null,
    draft: false,
    revision: 1,
    fanartImageKey: null,
    fanartCredit: null,
    fanartImageWidth: null,
    fanartImageHeight: null,
    entries: [
      {
        id: 1,
        scheduledDate: WEEK_START,
        title,
        gameId: 7,
        createdAt: 0,
        lastUpdatedAt: 0,
      },
    ],
    days: [],
  };
}

function renderWith(title: string) {
  const { container } = render(
    <ScheduleEditor
      weekStartDate={WEEK_START}
      initialWeek={weekWith(title)}
      games={GAMES}
      currentWeek={WEEK_START}
      today={OTHER_WEEK}
    />,
  );
  return {
    linked: container.querySelector('[data-od-id="schedule-entry-linked-db-1"]'),
    trigger: container.querySelector('[data-od-id="schedule-entry-game-trigger-db-1"]'),
  };
}

describe("ScheduleEditor — 연결된 게임을 눈으로 확인할 수 있다", () => {
  it("제목이 게임명과 다르면 연결을 글자로 적는다", () => {
    const { linked } = renderWith("저챗 — 이번 주 계획 이야기");

    // 정확히 이 경우가 위험하다: 화면 어디에도 "엘든 링"이 없으면 잘못 이어진 걸 못 잡는다.
    expect(linked).toHaveTextContent("연결: 엘든 링");
  });

  it("제목이 게임명과 같으면 안 적는다", () => {
    const { linked, trigger } = renderWith("엘든 링");

    // 같은 글자가 한 행에 두 번 서면 아이콘화로 얻은 자리를 도로 내주는 셈이다.
    expect(linked).toBeNull();
    // 그래도 보조 기술에는 항상 이름이 간다 — 표지만으론 무엇인지 알 수 없다.
    expect(trigger).toHaveAttribute("aria-label", "게임 연결: 엘든 링");
  });

  it("앞뒤 공백만 다른 제목은 같은 것으로 본다", () => {
    // 사용자가 의도한 차이가 아니라서 이걸 다르다고 보면 안 뜨는 게 정상인 자리에 표기가 뜬다.
    expect(renderWith("  엘든 링  ").linked).toBeNull();
  });
});
