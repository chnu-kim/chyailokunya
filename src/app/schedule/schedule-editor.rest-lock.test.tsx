import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { WeekView } from "@/features/schedule/service";
import { ScheduleEditor } from "./schedule-editor";

/* 휴방인 날의 항목 입력을 잠그는 계약(2026-07-31).

   **왜 이게 결함이었나:** 서버(`saveWeek`)는 휴방인 날의 항목을 거절 없이 저장하는데, 읽기
   화면과 PNG 카드는 `rest ? [] : entries` 로 버린다(이슈 #117 결정 5 — 표시에서 휴방이
   이긴다). 잠그기 전엔 관리자가 휴방인 날에 게임을 연결해도 저장은 성공하고, 팬에게는 아무
   것도 안 보이며, 화면엔 그 사실을 알리는 신호가 하나도 없었다 — AGENTS 의 "가드는 방어선이고
   잠금은 표시다. 둘의 조건이 갈리면 조용한 무시가 된다"에 정확히 걸리는 자리다.

   **항목을 지우지 않는 것도 계약이다.** `db/schema.ts` 의 schedule_days 주석이 같은 규율을
   이미 적어 뒀다: "그대로 두고 화면에서만 가리므로, 실수로 휴방을 켰다 꺼면 항목이 그대로
   돌아온다. 지우는 쪽을 택하면 그 실수가 복구 불가가 된다." 그래서 이 스펙은 잠기는 것뿐
   아니라 **껐을 때 값이 그대로 살아나는 것**까지 함께 잰다 — 잠금만 재면 나중에 "잠그는 대신
   지운다"로 바꿔도 초록이다.

   e2e 가 아니라 dom 단위로 두는 이유: 판정이 전부 이 컴포넌트 안에서 끝나고(서버 왕복이 없다),
   e2e 는 이미 dev 서버 하나를 여러 스펙이 나눠 쓰느라 무거운 스펙 하나가 남을 줄줄이 타임아웃
   시킨 전례가 있다(AGENTS, 팬아트 5MB 업로드). */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    schedule: { saveWeek: { mutate: vi.fn() }, publishWeek: { mutate: vi.fn() } },
    chzzk: { categorySearch: { query: vi.fn() } },
    games: { add: { mutate: vi.fn() } },
  },
}));

// WeekCardDownload 가 캡처 때만 동적 import 하지만, 이 스펙은 버튼을 안 누르므로 실제 래스터화
// 경로에 안 닿는다 — 그래도 목을 둬 happy-dom 에 canvas 가 없다는 사실에 안 기대게 한다.
vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const MONDAY = "2036-06-02";

/* 항목이 하나 있는 월요일. 발행 안 된 주라(`publishedAt: null`) 미리보기 카드가 null 이고,
   그러면 WeekCardDownload 가 이른 반환을 타 이 스펙이 캡처 배선을 통째로 안 건드린다. */
const WEEK: WeekView = {
  weekStartDate: MONDAY,
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
      scheduledDate: MONDAY,
      title: "마인크래프트",
      gameId: 7,
      createdAt: 0,
      lastUpdatedAt: 0,
    },
  ],
  days: [],
};

const GAMES = [{ id: 7, categoryValue: "마인크래프트", posterImageUrl: null }];

function renderEditor() {
  const { container } = render(
    <ScheduleEditor weekStartDate={MONDAY} initialWeek={WEEK} games={GAMES} currentWeek={MONDAY} />,
  );
  const pick = <T extends HTMLElement>(odId: string) =>
    container.querySelector<T>(`[data-od-id="${odId}"]`);
  return {
    container,
    restToggle: pick<HTMLInputElement>(`schedule-day-rest-${MONDAY}`)!,
    // 항목 key 는 서버에서 온 행이라 `db-<id>` 다(weekToDraft).
    gameTrigger: () => pick<HTMLButtonElement>("schedule-entry-game-trigger-db-1")!,
    title: () => pick<HTMLInputElement>("schedule-entry-title-db-1")!,
    del: () => pick<HTMLButtonElement>("schedule-entry-del-db-1")!,
    add: () => pick<HTMLButtonElement>(`schedule-day-add-${MONDAY}`)!,
    time: () => pick<HTMLInputElement>(`schedule-day-time-${MONDAY}`)!,
    note: () => pick<HTMLParagraphElement>(`schedule-day-rest-note-${MONDAY}`),
  };
}

describe("ScheduleEditor — 휴방인 날은 항목을 못 고친다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("휴방을 켜면 그 날 항목 조작이 전부 잠기고 이유가 화면에 뜬다", () => {
    const ui = renderEditor();

    // 잠그기 전엔 넷 다 살아 있어야 한다 — 이 단언이 없으면 아래 disabled 검사가 "원래부터
    // 잠겨 있었다"와 구분이 안 된다.
    expect(ui.gameTrigger()).toBeEnabled();
    expect(ui.title()).toBeEnabled();
    expect(ui.del()).toBeEnabled();
    expect(ui.add()).toBeEnabled();
    expect(ui.note()).toBeNull();

    fireEvent.click(ui.restToggle);

    expect(ui.gameTrigger()).toBeDisabled();
    expect(ui.title()).toBeDisabled();
    expect(ui.del()).toBeDisabled();
    expect(ui.add()).toBeDisabled();
    // 시각은 이슈 #117 부터 이미 잠겨 있었다 — 그 계약이 안 깨졌는지 함께 본다.
    expect(ui.time()).toBeDisabled();
    expect(ui.note()).toHaveTextContent("휴방인 날은 항목이 나가지 않습니다");
  });

  it("휴방을 껐다 켜도 항목은 지워지지 않는다", () => {
    const ui = renderEditor();

    fireEvent.click(ui.restToggle);
    fireEvent.click(ui.restToggle);

    expect(ui.title()).toBeEnabled();
    // **값까지 본다.** 항목 행이 다시 그려지기만 하고 값이 비었다면 "잠그는 대신 지웠다"는
    // 뜻이고, 그건 schema.ts 가 명시적으로 거절한 설계다.
    expect(ui.title()).toHaveValue("마인크래프트");
    expect(ui.note()).toBeNull();
  });

  it("항목이 없는 날에는 안내를 안 붙인다", () => {
    const { container } = render(
      <ScheduleEditor
        weekStartDate={MONDAY}
        initialWeek={{ ...WEEK, entries: [] }}
        games={GAMES}
        currentWeek={MONDAY}
      />,
    );
    const toggle = container.querySelector<HTMLInputElement>(
      `[data-od-id="schedule-day-rest-${MONDAY}"]`,
    )!;

    fireEvent.click(toggle);

    /* 빈 날에도 붙이면 일곱 줄이 같은 말을 반복하고, 정작 알려야 할 사실("지금 들어 있는
       이것들이 안 나간다")이 그 반복 속에 묻힌다. */
    expect(container.querySelector(`[data-od-id="schedule-day-rest-note-${MONDAY}"]`)).toBeNull();
    // 그래도 추가는 잠긴다 — 휴방인 날에 새 항목을 만들 길이 열려 있으면 잠금이 반쪽이다.
    expect(
      container.querySelector<HTMLButtonElement>(`[data-od-id="schedule-day-add-${MONDAY}"]`),
    ).toBeDisabled();
  });
});
