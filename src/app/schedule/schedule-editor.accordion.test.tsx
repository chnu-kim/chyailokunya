import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { WeekView } from "@/features/schedule/service";
import { ScheduleEditor } from "./schedule-editor";

/* 하루 칸 아코디언의 세 계약(이슈 #56 결정 28, 2026-07-31) — 다른 층이 못 보는 자리라 dom
   단위로 못박는다:

   1. **한 번에 하나만 연다.** 다른 날을 열면 먼저 열려 있던 날이 접힌다 — "일주일이 한눈에"가
      항상 참이려면 지금 편집 중인 날이 화면에 하나뿐이어야 한다.
   2. **빈 제목이 저장을 막으면 그 날이 자동으로 펼쳐진다.** 접힌 채로 막히면 오류 문구
      (blankTitleMessage)가 요일을 짚어도 그 줄이 안 보인다 — schedule-editor.tsx 의 onSave 가
      firstBlankTitleEntry 를 직접 불러 그 날짜로 편다.
   3. **패널이 열린 채로도 접힌 요약이 draft 를 그대로 읽는다.** 패널을 안 접어도 타이핑이 그
      자리의 접힌 줄 텍스트를 바꾼다 — 요약이 baseline 을 읽는 실수로 퇴행하면(결정 25 와 같은
      부류의 버그) 이 테스트가 멈춘 값을 잡는다.

   e2e 가 아니라 dom 인 이유는 판정이 전부 이 컴포넌트 안에서 끝나서다(서버 왕복이 없다) —
   rest-lock 스펙과 같은 사정. */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    schedule: { saveWeek: { mutate: vi.fn() }, publishWeek: { mutate: vi.fn() } },
    chzzk: { categorySearch: { query: vi.fn() } },
    games: { add: { mutate: vi.fn() } },
  },
}));
// WeekCardDownload 가 캡처 때만 동적 import 하지만, happy-dom 에 canvas 가 없다는 사실에
// 안 기대려고 목을 둔다(rest-lock 스펙과 같은 방어).
vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const WEEK_START = "2036-06-02"; // 월요일
const TUESDAY = "2036-06-03";
// 오늘 칸 표시는 이 스펙의 관심사가 아니라 그 주 밖의 날을 준다(다른 스펙과 같은 이유).
const OTHER_WEEK = "2036-05-25";

const EMPTY_WEEK: WeekView = {
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

function renderEmptyWeek() {
  const { container } = render(
    <ScheduleEditor
      weekStartDate={WEEK_START}
      initialWeek={EMPTY_WEEK}
      games={[]}
      currentWeek={WEEK_START}
      today={OTHER_WEEK}
    />,
  );
  const pick = <T extends HTMLElement>(odId: string) =>
    container.querySelector<T>(`[data-od-id="${odId}"]`);
  return { container, pick };
}

describe("ScheduleEditor — 하루 칸 아코디언", () => {
  it("한 번에 하나만 연다 — 다른 날을 열면 먼저 열려 있던 날이 접힌다", () => {
    const { pick } = renderEmptyWeek();
    const mon = pick<HTMLButtonElement>(`schedule-day-toggle-${WEEK_START}`)!;
    const tue = pick<HTMLButtonElement>(`schedule-day-toggle-${TUESDAY}`)!;

    fireEvent.click(mon);
    expect(mon).toHaveAttribute("aria-expanded", "true");
    expect(tue).toHaveAttribute("aria-expanded", "false");
    expect(pick(`schedule-day-panel-${WEEK_START}`)).not.toBeNull();
    expect(pick(`schedule-day-panel-${TUESDAY}`)).toBeNull();

    fireEvent.click(tue);
    // 월요일은 접히고 화요일이 펼쳐진다 — 패널 둘이 동시에 있으면 "한 번에 하나" 계약이 깨진다.
    expect(mon).toHaveAttribute("aria-expanded", "false");
    expect(tue).toHaveAttribute("aria-expanded", "true");
    expect(pick(`schedule-day-panel-${WEEK_START}`)).toBeNull();
    expect(pick(`schedule-day-panel-${TUESDAY}`)).not.toBeNull();
  });

  it("빈 제목 항목이 저장을 막으면 그 날이 자동으로 펼쳐진다", () => {
    const { pick } = renderEmptyWeek();

    /* 화요일을 열어 빈 제목 항목을 만든 뒤 **다시 접는다** — 이미 열려 있으면 "자동으로
       펼친다"가 아무 일도 안 해도 통과한 것처럼 보인다. 접힌 상태에서 저장을 눌러야 이
       테스트가 실제로 재는 계약(onSave 의 firstBlankTitleEntry 호출)이 드러난다. */
    fireEvent.click(pick<HTMLButtonElement>(`schedule-day-toggle-${TUESDAY}`)!);
    fireEvent.click(pick<HTMLButtonElement>(`schedule-day-add-${TUESDAY}`)!);
    fireEvent.click(pick<HTMLButtonElement>(`schedule-day-toggle-${TUESDAY}`)!);
    expect(pick(`schedule-day-toggle-${TUESDAY}`)).toHaveAttribute("aria-expanded", "false");
    expect(pick(`schedule-day-panel-${TUESDAY}`)).toBeNull();

    fireEvent.click(pick<HTMLButtonElement>("schedule-save")!);

    expect(pick(`schedule-day-toggle-${TUESDAY}`)).toHaveAttribute("aria-expanded", "true");
    expect(pick(`schedule-day-panel-${TUESDAY}`)).not.toBeNull();
    const err = pick("schedule-save-error");
    expect(err).toHaveTextContent("화요일");
    expect(err).toHaveTextContent("제목이 없습니다");
  });

  it("패널이 열린 채로도 접힌 요약이 타이핑을 그대로 따라간다", () => {
    const { pick } = renderEmptyWeek();

    fireEvent.click(pick<HTMLButtonElement>(`schedule-day-toggle-${WEEK_START}`)!);
    fireEvent.click(pick<HTMLButtonElement>(`schedule-day-add-${WEEK_START}`)!);

    const summaryTitle = () =>
      document.querySelector(`[data-od-id="schedule-day-${WEEK_START}"] .sched-day__summary-title`);
    // 제목을 아직 안 채웠다 — 항목은 1개라 daySummaryTitle 이 "—"(0개 전용)가 아니라 그 빈
    // 제목을 그대로 돌려준다.
    expect(summaryTitle()!.textContent).toBe("");

    const titleInput = pick<HTMLInputElement>("schedule-entry-title-new-0")!;
    fireEvent.change(titleInput, { target: { value: "타이핑한 제목" } });

    /* 패널을 안 접었다 — 그런데도 접힌 줄의 요약이 바뀐다는 게 이 테스트의 핵심이다. 요약이
       baseline 을 읽는 실수로 퇴행하면(결정 25 와 같은 부류) 여기서 빈 문자열에 멈춰 빨개진다. */
    expect(pick(`schedule-day-panel-${WEEK_START}`)).not.toBeNull();
    expect(summaryTitle()!.textContent).toBe("타이핑한 제목");
  });
});
