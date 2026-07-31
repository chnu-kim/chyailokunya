import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { WeekView } from "@/features/schedule/service";
import { ScheduleEditor } from "./schedule-editor";

/* 옛 공지를 내리는 길(#56 결정 35 짝, 적대적 리뷰 2라운드 2026-08-01).

   공지 입력을 **조건 없이** 걷었더니 이미 저장된 공지가 갇혔다: 저장 경로는 그 값을 계속
   보존하고(폼이 안 보내면 전체 교체 뮤테이션이 null 로 덮으므로 보존은 필요하다) 읽기 화면·PNG
   카드는 계속 그리는데, 관리자에겐 고치거나 내릴 길이 하나도 없었다. 오타가 있든 철 지난
   내용이든 영구히 공개된 채로 남는 셈이라 "안 쓰기로 했다"가 "손댈 수 없다"가 됐다.

   그래서 `baseline.note` 가 비어 있지 않은 주에서만 입력이 뜬다 — 새 공지는 못 만들고 있는
   것만 정리한다. 이 스펙이 재는 것은 그 **가르는 기준**이다.

   e2e(schedule.spec.ts)가 같은 계약을 저장까지 태워 보지만 여기서 또 재는 이유: 조건이
   `baseline` 이냐 `draft` 냐는 **비운 직후 한 프레임**에서만 갈리는데, 그 순간을 서버 왕복 없이
   확정적으로 재려면 이 층이 맞다(e2e 는 그 뒤 저장 결과까지 함께 본다). */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    schedule: { saveWeek: { mutate: vi.fn() }, publishWeek: { mutate: vi.fn() } },
    chzzk: { categorySearch: { query: vi.fn() } },
    games: { add: { mutate: vi.fn() } },
  },
}));
vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const WEEK_START = "2036-06-02";
// 오늘 칸이 끼면 이 스펙과 무관한 이유로 마크업이 흔들린다 — 그 주 밖의 날을 준다.
const OTHER_WEEK = "2036-05-25";

function weekWith(note: string | null): WeekView {
  return {
    weekStartDate: WEEK_START,
    note,
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
}

function renderWith(note: string | null) {
  const { container } = render(
    <ScheduleEditor
      weekStartDate={WEEK_START}
      initialWeek={weekWith(note)}
      games={[]}
      currentWeek={WEEK_START}
      today={OTHER_WEEK}
    />,
  );
  return {
    container,
    box: () => container.querySelector('[data-od-id="schedule-note-legacy"]'),
    input: () => container.querySelector<HTMLInputElement>('[data-od-id="schedule-note-input"]'),
  };
}

describe("ScheduleEditor — 옛 공지", () => {
  it("공지가 없는 주엔 칸이 아예 없다", () => {
    expect(renderWith(null).box()).toBeNull();
  });

  it("공백만인 공지도 없는 것으로 본다", () => {
    /* 저장·카드 양쪽이 공백만인 공지를 `null` 로 접으므로(features/schedule/schema.ts ·
       buildWeekCard) 화면에도 보일 것이 없다 — 여기서 칸을 띄우면 "내릴 것이 없는데 내리라고
       권하는" 자리가 된다. */
    expect(renderWith("   ").box()).toBeNull();
  });

  it("이미 적어 둔 공지가 있으면 그 값으로 칸이 뜬다", () => {
    const { box, input } = renderWith("이번 주는 젤다 위주로 달립니다");
    expect(box()).not.toBeNull();
    expect(input()).toHaveValue("이번 주는 젤다 위주로 달립니다");
  });

  it("비워도 칸은 남는다 — 조건은 draft 가 아니라 baseline 이다", () => {
    /* **이 스펙이 이 파일의 존재 이유다.** 조건을 `draft.note` 로 걸면 비우는 순간 칸이 사라져
       그 편집을 저장할 수도 되돌릴 수도 없다 — 자기가 만든 상태에 자기가 갇힌다. `baseline` 은
       저장 전까지 안 변하므로 비운 채로도 칸이 남고, 저장이 끝나야 접힌다(그게 "다 치웠다"는
       신호이기도 하다). */
    const { box, input } = renderWith("내려갈 옛 공지");
    fireEvent.change(input()!, { target: { value: "" } });

    expect(input()).toHaveValue("");
    expect(box()).not.toBeNull();
  });
});
