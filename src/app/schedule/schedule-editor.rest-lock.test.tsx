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
   시킨 전례가 있다(AGENTS, 팬아트 5MB 업로드).

   **하루 칸 아코디언(결정 28, 2026-07-31 후속)** — 항목 조작이 패널 안으로 내려가 접힌
   상태에선 DOM 에 없다. 그래서 `gameTrigger`·`title`·`add`·`note` 를 전부 **getter** 로
   바꿨다(렌더 시점에 한 번만 잡던 옛 `!` 단언은 패널이 닫힌 채 렌더되는 순간 null 뒤의 `!`
   가 되어 모든 테스트가 클릭 전에 죽는다) — 값을 쓸 때마다 다시 찾아야 패널이 열리기 전/후
   어느 쪽에서 불러도 안전하다.

   **시각·휴방은 머리 줄로 올라갔다(결정 32, 2026-08-01)** — 접힌 채로 조작된다. 아래 첫
   테스트가 **펴지 않고** 휴방을 켜서 그 계약을 못박는다: 그 앞에 `toggle()` 을 끼우면
   "패널 안이어도 통과하는" 테스트로 되돌아가 개정 자체가 안 보이게 된다. */

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
/* 오늘 칸 표시는 이 스펙의 관심사가 아니라 **그 주 밖의 날**을 준다 — 그 주 안의 날을 주면
   "오늘" 칩과 `sched-day--today` 가 끼어 여기서 재는 것과 무관한 이유로 마크업이 흔들린다. */
const OTHER_WEEK = "2036-05-25";

function renderEditor() {
  const { container } = render(
    <ScheduleEditor
      weekStartDate={MONDAY}
      initialWeek={WEEK}
      games={GAMES}
      currentWeek={MONDAY}
      today={OTHER_WEEK}
    />,
  );
  const pick = <T extends HTMLElement>(odId: string) =>
    container.querySelector<T>(`[data-od-id="${odId}"]`);
  return {
    container,
    // 접힌 요약 줄의 펼치기 트리거 — 이걸 먼저 눌러야 아래 것들이 DOM 에 나타난다.
    toggle: () => pick<HTMLButtonElement>(`schedule-day-toggle-${MONDAY}`)!,
    restToggle: () => pick<HTMLInputElement>(`schedule-day-rest-${MONDAY}`)!,
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

  /* 결정 32 의 계약 — **접힌 채로 시각·휴방이 선다.** 옛 골격에선 둘 다 패널 안이라 이
     테스트가 `toggle()` 없이는 null 로 죽었다. 그 반대가 참인지 먼저 못박고 시작한다:
     여기가 빨개지면 둘이 다시 패널로 내려갔다는 뜻이다. */
  it("접힌 채로도 시각·휴방이 DOM 에 있고 조작된다 — 펼침은 항목 편집 전용이다", () => {
    const ui = renderEditor();

    // 접혀 있다(패널 없음, 항목 조작도 없음).
    expect(ui.toggle()).toHaveAttribute("aria-expanded", "false");
    expect(ui.container.querySelector(`[data-od-id="schedule-day-panel-${MONDAY}"]`)).toBeNull();
    expect(ui.container.querySelector('[data-od-id="schedule-entry-title-db-1"]')).toBeNull();

    // 그런데도 시각·휴방은 선다 — 그리고 **한 번도 펴지 않고** 값이 바뀐다.
    fireEvent.change(ui.time(), { target: { value: "21:30" } });
    expect(ui.time()).toHaveValue("21:30");
    fireEvent.click(ui.restToggle());
    expect(ui.restToggle()).toBeChecked();
    // 휴방을 켜면 시각이 잠긴다(이슈 #117) — 그 규칙도 접힌 채로 그대로 돈다.
    expect(ui.time()).toBeDisabled();
    // 여전히 접혀 있다 — 조작이 아코디언을 건드리지 않는다.
    expect(ui.toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("휴방을 켜면 그 날 항목 조작이 전부 잠기고 이유가 화면에 뜬다", () => {
    const ui = renderEditor();
    fireEvent.click(ui.toggle());

    // 잠그기 전엔 넷 다 살아 있어야 한다 — 이 단언이 없으면 아래 disabled 검사가 "원래부터
    // 잠겨 있었다"와 구분이 안 된다.
    expect(ui.gameTrigger()).toBeEnabled();
    expect(ui.title()).toBeEnabled();
    expect(ui.add()).toBeEnabled();
    expect(ui.note()).toBeNull();

    fireEvent.click(ui.restToggle());

    expect(ui.gameTrigger()).toBeDisabled();
    expect(ui.title()).toBeDisabled();
    expect(ui.add()).toBeDisabled();
    /* **삭제는 안 잠근다**(codex 리뷰 P2). 막았더니 빠져나갈 길이 없는 자리가 생겼다:
       "+항목 추가"로 빈 줄을 만든 뒤 그 날을 휴방으로 정하면 빈 제목이 저장을 막는데
       (firstBlankTitleEntry) 제목도 못 쓰고 삭제도 못 했다 — 그 오류 문구가 "제목을 채우거나
       삭제해 주십시오"라고 두 길을 안내하는데 화면이 둘 다 막고 있었다. */
    expect(ui.del()).toBeEnabled();
    // 시각은 이슈 #117 부터 이미 잠겨 있었다 — 그 계약이 안 깨졌는지 함께 본다.
    expect(ui.time()).toBeDisabled();
    expect(ui.note()).toHaveTextContent("휴방인 날은 항목이 나가지 않습니다");
  });

  it("패널을 연 채 휴방을 켜면 트리거가 '펼쳐짐'을 주장하지 않는다", () => {
    /* codex 리뷰 P3. 패널은 휴방일 때 언마운트되지만 `openGameSearchKey` 는 그대로 두므로
       (휴방을 도로 끄면 열어 뒀던 자리가 돌아오게), `aria-expanded` 를 같은 조건으로 안 맞추면
       "펼쳐졌다고 말하지만 펼쳐진 것이 없는" 잠긴 버튼이 남는다. */
    const ui = renderEditor();
    fireEvent.click(ui.toggle());

    fireEvent.click(ui.gameTrigger());
    expect(ui.gameTrigger()).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(ui.restToggle());

    expect(ui.gameTrigger()).toHaveAttribute("aria-expanded", "false");
    // 패널 자체도 사라져야 한다 — 속성만 고치고 검색창이 남으면 잠금이 반쪽이다.
    expect(ui.container.querySelector(".sched-picker")).toBeNull();
  });

  it("휴방을 껐다 켜도 항목은 지워지지 않는다", () => {
    const ui = renderEditor();
    fireEvent.click(ui.toggle());

    fireEvent.click(ui.restToggle());
    fireEvent.click(ui.restToggle());

    expect(ui.title()).toBeEnabled();
    // **값까지 본다.** 항목 행이 다시 그려지기만 하고 값이 비었다면 "잠그는 대신 지웠다"는
    // 뜻이고, 그건 schema.ts 가 명시적으로 거절한 설계다.
    expect(ui.title()).toHaveValue("마인크래프트");
    expect(ui.note()).toBeNull();
  });

  it("휴방인 날에도 항목을 지울 수 있다 — 빈 제목이 저장을 막는 막다른 골목을 막는다", () => {
    const ui = renderEditor();
    fireEvent.click(ui.toggle());

    fireEvent.click(ui.restToggle());
    fireEvent.click(ui.del());

    // 실제로 사라져야 한다 — 버튼이 눌리기만 하고 아무 일도 안 나면 길이 없는 건 그대로다.
    expect(ui.container.querySelector('[data-od-id="schedule-entry-title-db-1"]')).toBeNull();
    // 항목이 없어졌으니 안내도 함께 사라진다(그 문장은 "지금 들어 있는 것"을 가리킨다).
    expect(ui.note()).toBeNull();
  });

  it("항목이 없는 날에는 안내를 안 붙인다", () => {
    const { container } = render(
      <ScheduleEditor
        weekStartDate={MONDAY}
        initialWeek={{ ...WEEK, entries: [] }}
        games={GAMES}
        currentWeek={MONDAY}
        today={OTHER_WEEK}
      />,
    );
    /* 접힌 요약 줄부터 연다 — **휴방 때문이 아니라 `schedule-day-add-` 때문이다**(결정 32
       이후 시각·휴방은 접힌 채로도 있다). 아래에서 ＋ 가 잠겼는지 보려면 패널이 열려 있어야
       한다. */
    fireEvent.click(
      container.querySelector<HTMLButtonElement>(`[data-od-id="schedule-day-toggle-${MONDAY}"]`)!,
    );
    const rest = container.querySelector<HTMLInputElement>(
      `[data-od-id="schedule-day-rest-${MONDAY}"]`,
    )!;

    fireEvent.click(rest);

    /* 빈 날에도 붙이면 일곱 줄이 같은 말을 반복하고, 정작 알려야 할 사실("지금 들어 있는
       이것들이 안 나간다")이 그 반복 속에 묻힌다. */
    expect(container.querySelector(`[data-od-id="schedule-day-rest-note-${MONDAY}"]`)).toBeNull();
    // 그래도 추가는 잠긴다 — 휴방인 날에 새 항목을 만들 길이 열려 있으면 잠금이 반쪽이다.
    expect(
      container.querySelector<HTMLButtonElement>(`[data-od-id="schedule-day-add-${MONDAY}"]`),
    ).toBeDisabled();
  });
});
