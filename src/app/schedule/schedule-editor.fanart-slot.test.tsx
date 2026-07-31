import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { WeekView } from "@/features/schedule/service";
import { ScheduleEditor } from "./schedule-editor";

/* 팬아트 슬롯의 계약(이슈 #56 결정 36, 2026-08-01).

   **슬롯은 하나이고 두 상태가 서로를 대체한다** — 빈 드롭존과 그림이 동시에 안 선다. e2e
   (`fanart.spec.ts`)가 진짜 업로드 왕복과 ✕ 의 호버·포커스 노출을 보고, 여기선 그 층이 못
   보거나 비싸게 보는 것을 잰다:

   1. **`dragover` 를 취소하는가** — 안 하면 브라우저 기본값이 "받지 않음"이라 진짜 드래그에서
      `drop` 이 아예 안 나는데 화면엔 아무 신호가 없다. `fireEvent` 는 `preventDefault()` 가
      불렸으면 false 를 돌려주므로 그 값을 그대로 읽는다.
   2. **`dragleave` 가 자식 위를 지날 때는 안 꺼지는가** — 흔한 버그다. 드롭존 안의 아이콘 위를
      지나는 순간 강조가 깜빡인다. `relatedTarget` 이 상자 안인지로 가른다.
   3. **저장 중에는 잠기는가** — 머신이 팬아트 이벤트를 `ready` 에서만 받으므로, 잠그지 않으면
      조작이 아무 문구 없이 드롭된다(이 저장소가 이미 한 번 겪은 자리).

   업로드 자체는 Route Handler 라 `fetch` 를 목으로 세운다 — tRPC 목으로는 안 잡히는 유일한
   쓰기 경로다(schedule-editor.tsx 의 `uploadRun` 주석). */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    schedule: { saveWeek: { mutate: vi.fn() }, publishWeek: { mutate: vi.fn() } },
    chzzk: { categorySearch: { query: vi.fn() } },
    games: { add: { mutate: vi.fn() } },
  },
}));
vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const MONDAY = "2039-03-07";
const OTHER_WEEK = "2039-02-21";

function week(over: Partial<WeekView> = {}): WeekView {
  return {
    weekStartDate: MONDAY,
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
    ...over,
  };
}

function renderEditor(initialWeek: WeekView) {
  const { container } = render(
    <ScheduleEditor
      weekStartDate={MONDAY}
      initialWeek={initialWeek}
      games={[]}
      currentWeek={MONDAY}
      today={OTHER_WEEK}
    />,
  );
  const pick = <T extends HTMLElement>(odId: string) =>
    container.querySelector<T>(`[data-od-id="${odId}"]`);
  return {
    container,
    slot: () => pick<HTMLDivElement>("schedule-fanart-slot")!,
    label: () => container.querySelector<HTMLLabelElement>(".sched-fanart__pick")!,
    thumb: () => pick<HTMLImageElement>("schedule-fanart-thumb"),
    remove: () => pick<HTMLButtonElement>("schedule-fanart-remove"),
    file: () => pick<HTMLInputElement>("schedule-fanart-file")!,
  };
}

// `dataTransfer` 는 happy-dom 에 생성자가 없다 — 핸들러가 읽는 것만 흉내 낸다.
const transfer = (files: File[]) => ({ files, items: [], types: ["Files"] });
const png = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", {
    type: "image/png",
  });

describe("ScheduleEditor — 팬아트 슬롯", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("빈 상태와 그림 상태가 서로를 대체한다 — 둘이 동시에 안 선다", () => {
    const empty = renderEditor(week());
    expect(empty.label().textContent).toContain("그림을 끌어 놓거나 눌러서 고릅니다");
    expect(empty.thumb()).toBeNull();
    expect(empty.remove()).toBeNull();

    const filled = renderEditor(week({ fanartImageKey: "abc.png" }));
    expect(filled.thumb()).not.toBeNull();
    expect(filled.remove()).not.toBeNull();
    // 드롭존 문구가 사라진다 — 남아 있으면 "슬롯 하나"가 거짓이 된다.
    expect(filled.label().textContent).not.toContain("끌어 놓거나");
  });

  it("dragover 를 취소한다 — 안 하면 진짜 드래그에서 drop 이 안 난다", () => {
    const ui = renderEditor(week());
    // fireEvent 는 preventDefault() 가 불리면 false 를 돌려준다.
    expect(fireEvent.dragOver(ui.slot(), { dataTransfer: transfer([]) })).toBe(false);
  });

  /* **자식 위를 지나는 `dragleave` 는 여기서 못 잰다** — happy-dom 의 합성 드래그 이벤트는
     `relatedTarget` 을 안 싣는다(실측: 핸들러가 받는 값이 `undefined` 다). 그래서 "떠난 것인가"
     판정이 이 층에선 늘 "떠났다"로 접힌다. 그 계약은 진짜 Chromium 이 보는 `fanart.spec.ts`
     쪽에 있다. 여기선 켜지는 것과 **창 밖으로 나가 꺼지는 것**(relatedTarget 이 null 인 경우)
     까지만 본다 — 그 둘은 이 층에서도 정직하게 재진다. */
  it("드래그가 들어오면 강조가 켜지고 창 밖으로 나가면 꺼진다", () => {
    const ui = renderEditor(week());
    fireEvent.dragEnter(ui.slot(), { dataTransfer: transfer([]) });
    expect(ui.slot().className).toContain("is-dragging");

    fireEvent.dragLeave(ui.slot(), { relatedTarget: null });
    expect(ui.slot().className).not.toContain("is-dragging");
  });

  it("파일을 떨구면 업로드가 나가고 그 키가 슬롯에 붙는다", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ key: "dropped.png" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const ui = renderEditor(week());
    fireEvent.drop(ui.slot(), { dataTransfer: transfer([png()]) });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/fanart", expect.anything());
    await waitFor(() => expect(ui.thumb()).not.toBeNull());
    expect(ui.thumb()!.src).toContain("/api/fanart/dropped.png");
    // 강조도 함께 꺼진다 — 남으면 업로드가 끝난 뒤에도 "받는 중"으로 보인다.
    expect(ui.slot().className).not.toContain("is-dragging");
  });

  it("잠긴 동안 떨군 파일은 업로드를 안 낸다 — 화면과 머신 가드가 같은 조건이어야 한다", () => {
    /* 저장 중을 만든다: 저장이 끝나지 않는 run 을 주고 SAVE 를 보낸다. 그동안 팬아트 이벤트는
       머신이 안 받으므로(ready 전용), 화면도 같이 잠겨야 조용한 무시가 안 생긴다. */
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ui = renderEditor(week({ fanartImageKey: "abc.png" }));

    // 잠그기 전엔 조작이 살아 있다 — 이 단언이 없으면 아래가 "원래부터 잠김"과 구분이 안 된다.
    expect(ui.file()).toBeEnabled();
    expect(ui.remove()).toBeEnabled();

    fireEvent.change(ui.file(), { target: { files: [png()] } });
    // 업로드 중이 됐다(uploading) — 이 상태에서도 잠긴다.
    expect(ui.file()).toBeDisabled();
    expect(ui.remove()).toBeDisabled();

    // 그 사이 떨궈도 새 업로드가 안 나간다.
    const before = fetchMock.mock.calls.length;
    fireEvent.drop(ui.slot(), { dataTransfer: transfer([png()]) });
    expect(fetchMock.mock.calls.length).toBe(before);

    /* **그런데 취소는 여전히 한다.** 잠겼다고 `dragover` 를 그냥 흘리면 브라우저 기본 동작이
       살아나 떨군 파일로 탭이 이동하고 **저장 안 된 편집이 통째로 날아간다** — 저장 중이
       정확히 그 순간이다. 잠금은 "업로드를 안 낸다"이지 "브라우저에 넘긴다"가 아니다
       (codex 두 채널이 독립적으로 잡은 결함). */
    expect(
      fireEvent.dragOver(ui.slot(), { dataTransfer: transfer([png()]) }),
      "잠긴 동안에도 dragover 를 취소한다",
    ).toBe(false);
    // 강조는 안 켜진다 — 받을 수 없는 자리라고 화면이 말해야 한다.
    fireEvent.dragEnter(ui.slot(), { dataTransfer: transfer([png()]) });
    expect(ui.slot().className).not.toContain("is-dragging");
  });
});
