import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { WeekCardData } from "@/features/schedule/card";
import { WeekCardDownload } from "./week-card-download";

/* PNG 다운로드 배선(이슈 #109 작업순서 3). html-to-image 는 실제 canvas 래스터화가 필요해
   happy-dom 에선 못 돈다(캡처 자체의 시각 정확성은 이 스펙의 관심사가 아니다 — 브라우저에서
   직접 눈으로 확인한다, week-card-download.tsx 주석) — 그래서 mock 해 "버튼을 누르면 캡처
   함수가 옳은 인자로 불리고, 결과를 다운로드로 잇는가"만 못박는다. */
vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

/* submit 머신이 15초(REQUEST_TIMEOUT_MS) 뒤 run 에 넘기는 AbortSignal 이 실제로 걸리는지
   보려고 그 값만 20ms 로 줄인다(적대적 리뷰 지적 — toPng 이 안 끝나면 버튼이 영영 안 풀렸다).
   나머지(isAborted 등)는 실제 구현 그대로 써야 downloadErrorMessage 의 분기가 진짜로 맞물린다. */
vi.mock("@/core/error-message", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/error-message")>();
  return { ...actual, REQUEST_TIMEOUT_MS: 20 };
});

import { toPng } from "html-to-image";

const CARD: WeekCardData = {
  rangeLabel: "7.20 – 7.26",
  note: null,
  days: [
    { dow: "월", date: "7.20", time: null, rest: false, entries: [], overflow: 0 },
    { dow: "화", date: "7.21", time: null, rest: false, entries: [], overflow: 0 },
    { dow: "수", date: "7.22", time: null, rest: false, entries: [], overflow: 0 },
    { dow: "목", date: "7.23", time: null, rest: false, entries: [], overflow: 0 },
    { dow: "금", date: "7.24", time: null, rest: false, entries: [], overflow: 0 },
    { dow: "토", date: "7.25", time: null, rest: false, entries: [], overflow: 0 },
    { dow: "일", date: "7.26", time: null, rest: false, entries: [], overflow: 0 },
  ],
  fanart: null,
};

const FANART_CARD: WeekCardData = {
  ...CARD,
  fanart: { imageKey: "b7f3.png", credit: "그림 · @someone", size: null },
};

const NEXT_WEEK_CARD: WeekCardData = {
  ...CARD,
  rangeLabel: "7.27 – 8.2",
  days: CARD.days.map((d) => ({ ...d, date: d.date === "7.20" ? "7.27" : d.date })),
};

let capturedAnchor: HTMLAnchorElement | null = null;

beforeEach(() => {
  vi.mocked(toPng).mockReset();
  capturedAnchor = null;
  // happy-dom 은 document.fonts 를 안 구현한다(실측) — 실제 브라우저엔 늘 있는 API 라 프로덕션
  // 코드에서 방어할 이유는 없고, 테스트에서만 채워 준다.
  Object.defineProperty(document, "fonts", {
    value: { ready: Promise.resolve() },
    configurable: true,
  });
  // 다운로드 트리거(<a download> 클릭)를 가로챈다 — jsdom·happy-dom 은 실제 파일 다운로드를
  // 안 하므로, 클릭이 옳은 href·download 속성으로 났는지만 본다.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    capturedAnchor = this;
  });
  /* 캡처 전 그림 인라인(inlineImages)이 쓰는 fetch. 기본값을 성공으로 둬 **모든** 테스트가
     네트워크 없이 같은 경로를 타게 한다 — 안 두면 팬아트가 있는 카드를 쓰는 테스트마다
     실제 요청이 나가 실패까지의 대기가 tick 수를 흔든다. `mockClear` 로 호출 기록을
     테스트마다 비운다(spyOn 은 같은 spy 를 돌려주므로 기록이 파일 전체에 누적된다). */
  vi.spyOn(globalThis, "fetch").mockClear().mockResolvedValue(pngResponse());
});

// happy-dom 의 Response 는 blob() 계약이 이 용도에 안 맞는다 — inlineImages 가 실제로 쓰는
// 두 가지(ok·blob())만 갖춘 최소 객체를 준다.
function pngResponse(): Response {
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  return { ok: true, blob: async () => blob } as unknown as Response;
}

// 시간 초과 뒤에도 배경에서 계속 도는 toPng mock(안 끝남)은 startCapture 의 snapshotCard 가
// document.body 에 붙인 복제 노드를 finally 로 못 지운다(toPng 이 안 끝나므로) — 그 조각이
// 다음 테스트의 getByTestId("week-card") 를 "여러 개 찾음"으로 깨뜨리지 않도록 매번 치운다.
afterEach(() => {
  document.body.innerHTML = "";
});

describe("WeekCardDownload", () => {
  /* **카드가 없으면 아무것도 안 그린다**(결정 35, 2026-08-01).

     전엔 잠긴 버튼 + "발행된 주만 카드로 내려받을 수 있습니다."를 그렸다. 그 문장이 걷히면
     이 가지에 남는 건 아무 설명 없이 흐려진 버튼 하나뿐이라 화면에 있는 것이 정보가 0 이다.
     이 갈래로 오는 유일한 호출자인 읽기 화면은 `week` 가 있을 때만 이 컴포넌트를 그리므로
     실전에서 안 닿고, 닿더라도 그 화면의 "아직이야…" 빈 상태가 같은 사실을 말한다. */
  it("카드가 없으면 아무것도 안 그린다", () => {
    const { container } = render(<WeekCardDownload card={null} weekStartDate="2026-07-20" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("카드가 있고 막힌 이유가 없으면 미리보기를 그리고 버튼이 활성이다", () => {
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);
    expect(screen.getByTestId("week-card-download-btn")).toBeEnabled();
    expect(screen.getByTestId("week-card")).toBeInTheDocument();
    // blockedReason 을 안 넘기면(읽기 화면의 발행된 주) 안내도 없다.
    expect(screen.queryByTestId("week-card-download-blocked")).not.toBeInTheDocument();
  });

  /* **잠긴 이유는 언제나 화면 어딘가에 있다.** 다만 2026-08-01(결정 35)부터 "어디"가 사유마다
     갈린다 — 그게 이 두 테스트가 갈린 이유다.

     둘 다 잠근다(전엔 미저장을 안 잠갔다). 미저장이어도 받을 수 있고 문구로만 경고하던
     시절엔 화면과 파일이 서로 다를 수 있었다 — 이제 잠그므로 "보이는 것 = 받는 것"이 항상 참이다.
     그리고 둘 다 카드는 그대로 그린다: 못 받는 것과 못 보는 것은 다른 사실이다. */
  it("unsaved 는 화면 문장으로 이유를 말한다 — 여기서만 말할 수 있는 인과다", () => {
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" blockedReason="unsaved" />);

    expect(screen.getByTestId("week-card-download-blocked")).toHaveTextContent(
      "저장하지 않은 변경이 있습니다. 저장하면 이 카드를 받을 수 있습니다.",
    );
    expect(screen.getByTestId("week-card-download-btn")).toBeDisabled();
    expect(screen.getByTestId("week-card")).toBeInTheDocument();
  });

  /* **unpublished 는 화면 문장을 안 낸다** — 같은 화면 저장·발행 바의 칩("비공개")이 이미 그
     사실을 상시로 말하므로 카드 옆에서 한 번 더 말하면 같은 사실이 한 화면에 둘이다.
     대신 **버튼 이름이 사유를 진다**: 아이콘만 남은 편집기 변형에서 잠긴 이유를 전할 유일한
     통로라, 이게 없으면 "왜 안 눌리지"가 된다. `title` 은 hover 전용이라 이름을 대신 못 한다. */
  it.each(["editor", "reader"] as const)(
    "%s: unpublished 는 화면 문장 대신 버튼 이름으로 이유를 진다",
    (variant) => {
      render(
        <WeekCardDownload
          card={CARD}
          weekStartDate="2026-07-20"
          blockedReason="unpublished"
          variant={variant}
        />,
      );

      expect(screen.queryByTestId("week-card-download-blocked")).not.toBeInTheDocument();
      const btn = screen.getByTestId("week-card-download-btn");
      expect(btn).toBeDisabled();
      expect(btn).toHaveAccessibleName("PNG 다운로드 — 발행된 주만 받을 수 있습니다");
      expect(screen.getByTestId("week-card")).toBeInTheDocument();
    },
  );

  /* ── variant: 같은 부품이 두 화면에서 다른 모양이다(결정 35) ─────────────────────
     관리자는 매주 오는 사람이라 아이콘으로 자리를 아끼고, 팬은 한 번 오고 마는 사람이라
     "받을 수 있다"가 글자로 발견돼야 한다. **확대(카드 클릭)는 이 축과 무관하게 공유한다** —
     그걸 함께 재지 않으면 variant 를 넣으며 한쪽 확대를 떨어뜨려도 초록으로 남는다. */
  it("editor 변형은 다운로드가 아이콘이다 — 글자를 안 쓴다", () => {
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" variant="editor" />);

    const btn = screen.getByTestId("week-card-download-btn");
    expect(btn).toHaveTextContent("");
    expect(btn).toHaveAccessibleName("PNG 다운로드");
    expect(btn.querySelector("svg")).toBeInTheDocument();
    // 확대는 두 변형 공통이다.
    expect(screen.getByTestId("week-card-download-zoom")).toBeEnabled();
  });

  it("reader 변형(기본)은 다운로드가 글자 버튼이다", () => {
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);

    const btn = screen.getByTestId("week-card-download-btn");
    expect(btn).toHaveTextContent("PNG 다운로드");
    expect(btn.querySelector("svg")).not.toBeInTheDocument();
    expect(screen.getByTestId("week-card-download-zoom")).toBeEnabled();
  });

  /* 확대 창(2026-07-31). **카드가 둘이 되는 유일한 자리**라 두 가지를 함께 잰다:
     사본이 뜨는가 · 그 사본이 `data-od-id` 를 안 다는가. 후자를 안 재면 같은 이름이 둘이 되어
     Playwright strict 로케이터가 **무관한 e2e 단언에서** 깨진다(그때 원인이 이 컴포넌트라는 걸
     알아내기 어렵다). happy-dom 은 showModal 을 구현하므로 실제로 열린다. */
  it("원본 크기로 보기를 누르면 카드 사본이 뜨고, 그 사본은 od-id 를 안 단다", () => {
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);
    expect(screen.queryByTestId("week-card-zoom")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("week-card-download-zoom"));

    const dialog = screen.getByTestId("week-card-zoom");
    expect(dialog).toBeInTheDocument();
    // 카드는 여전히 하나만 이름을 갖는다 — 미리보기 쪽 하나.
    expect(screen.getAllByTestId("week-card")).toHaveLength(1);
    // 그런데 사본은 실제로 그려져 있다(이름만 없다).
    expect(dialog.querySelectorAll(".week-card")).toHaveLength(1);
  });

  it("확대 창은 미저장이어도 열린다 — 못 받는 것과 못 보는 것은 다른 사실이다", () => {
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" blockedReason="unsaved" />);

    expect(screen.getByTestId("week-card-download-btn")).toBeDisabled();
    // 확대는 읽기 전용이라 저장 상태와 무관하다.
    expect(screen.getByTestId("week-card-download-zoom")).toBeEnabled();
    fireEvent.click(screen.getByTestId("week-card-download-zoom"));
    expect(screen.getByTestId("week-card-zoom")).toBeInTheDocument();
  });

  /* 배경 클릭으로 닫는 계약(2026-07-31). 발행 확인창(`publish-confirm-dialog`)은 **안 닫는다** —
     그건 서버 쓰기를 다뤄 실수로 스치는 클릭에 안 걸려야 하기 때문이다. 확대 창은 읽기 전용이라
     반대로 고른 것이고, 그 차이가 실수로 뒤집히지 않게 여기서 못박는다.

     **카드 위 클릭은 안 닫는다**는 짝도 함께 잰다: `dialog` 자신이 배경까지 포함한 상자라
     `e.target` 을 안 가리면 카드를 눌러도 닫혀서, 확대해 놓고 들여다보는 동작이 성립하지 않는다. */
  it("확대 창은 배경 클릭으로 닫히고, 카드 위 클릭으로는 안 닫힌다", () => {
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);
    fireEvent.click(screen.getByTestId("week-card-download-zoom"));

    const dialog = screen.getByTestId("week-card-zoom");
    // 카드(안쪽)를 눌러도 살아 있어야 한다.
    fireEvent.click(dialog.querySelector(".week-card")!);
    expect(screen.getByTestId("week-card-zoom")).toBeInTheDocument();

    // 배경(dialog 자신)을 누르면 닫힌다.
    fireEvent.click(dialog);
    expect(screen.queryByTestId("week-card-zoom")).not.toBeInTheDocument();
  });

  it("확대 창의 닫기 버튼이 창을 닫는다", () => {
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);
    fireEvent.click(screen.getByTestId("week-card-download-zoom"));
    expect(screen.getByTestId("week-card-zoom")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("week-card-zoom-close"));
    expect(screen.queryByTestId("week-card-zoom")).not.toBeInTheDocument();
  });

  it("버튼을 누르면 캡처해 파일명을 붙여 내려받는다", async () => {
    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,zzz");
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });

    expect(toPng).toHaveBeenCalledTimes(1);
    const [node, options] = vi.mocked(toPng).mock.calls[0]!;
    // 캡처 대상은 week-card 노드 자신이다(미리보기 축소 래퍼가 아니라) — week-card.tsx 주석대로
    // 조상의 transform 이 캡처에 안 섞이려면 여기가 정확해야 한다.
    expect((node as HTMLElement).getAttribute("data-od-id")).toBe("week-card");
    expect(options).toMatchObject({ pixelRatio: 2 });

    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor!.href).toBe("data:image/png;base64,zzz");
    expect(capturedAnchor!.download).toBe("챠이로쿠냐_주간일정_2026-07-20.png");
  });

  it("리마운트 없이 주가 바뀌어도(공개 읽기의 WeekNav 클라이언트 네비) 새 주 파일명으로 받는다", async () => {
    // 적대적 리뷰가 잡은 회귀 — submit 머신의 run 은 마운트 시점에 얼어붙으므로(submit.machine.ts),
    // weekStartDate 를 그 클로저에서 직접 읽으면 이 컴포넌트가 리마운트 없이 새 주 props 만
    // 받았을 때(읽기 화면은 편집기와 달리 key 로 리마운트를 안 시킨다) 옛 주의 파일명이 나간다.
    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,first");
    const { rerender } = render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);

    // 같은 컴포넌트 인스턴스에 새 주 props 만 흘려보낸다(리마운트 아님 — rerender 가 정확히 그것이다).
    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,second");
    rerender(<WeekCardDownload card={NEXT_WEEK_CARD} weekStartDate="2026-07-27" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });

    expect(capturedAnchor!.download).toBe("챠이로쿠냐_주간일정_2026-07-27.png");
    // 캡처 대상 그림도 새 주 카드여야 한다(미리보기가 새 데이터로 다시 그려졌는지). toBeInTheDocument
    // 는 못 쓴다 — startCapture 가 캡처 직후 finally 에서 스냅샷을 문서에서 곧장 떼어내므로(라운드
    // 5, snapshotCard) 이 시점엔 이미 detached 다. getByText 가 못 찾으면 그 자체로 던진다.
    const [node] = vi.mocked(toPng).mock.calls.at(-1)!;
    within(node as HTMLElement).getByText("7.27 – 8.2");
  });

  it("캡처가 실패하면 오류를 알리고 다시 누를 수 있다", async () => {
    vi.mocked(toPng).mockRejectedValue(new Error("capture failed"));
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });

    expect(screen.getByText("카드를 만들지 못했습니다. 다시 시도해 주십시오.")).toBeInTheDocument();
    expect(screen.getByTestId("week-card-download-btn")).toBeEnabled();
    expect(capturedAnchor).toBeNull();
  });

  it("캡처가 시간 안에 안 끝나면 멈추고 다시 누를 수 있다", async () => {
    // 적대적 리뷰가 잡은 자리 — signal 을 무시하면 이 mock 처럼 영원히 안 끝나는 toPng 앞에서
    // 버튼이 "만드는 중…"에 붙박인 채 새로고침 말고는 빠져나갈 길이 없었다.
    vi.mocked(toPng).mockImplementation(() => new Promise(() => {}));
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });
    expect(screen.getByTestId("week-card-download-btn")).toBeDisabled();

    await waitFor(() =>
      expect(
        screen.getByText(
          "카드를 만드는 데 시간이 너무 오래 걸려서 멈췄습니다. 다시 시도해 주십시오.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("week-card-download-btn")).toBeEnabled();
    expect(capturedAnchor).toBeNull();
  });

  /* **아이콘엔 "만드는 중…"을 실을 글자 자리가 없다**(결정 35, 2026-08-01). 글자 버튼은 자기
     라벨로 그 상태를 말했는데(`{capturing ? "만드는 중…" : …}`) 아이콘으로 줄이면 그 통로가
     통째로 사라진다 — 캡처는 초 단위라 신호가 없으면 관리자는 눌리지 않았다고 읽는다.
     이 저장소가 팬 제안에서 이미 밟은 자리다("보드를 안 바꾸는 쓰기는 성공 신호가 하나도 없다").

     칩과 접근명을 **함께** 잰다: 칩만 재면 시각 사용자만 덮이고, 이름만 재면 화면이 조용해도
     초록이다. */
  it("editor 변형은 캡처 중임을 칩과 버튼 이름 둘 다로 말한다", async () => {
    vi.mocked(toPng).mockImplementation(() => new Promise(() => {}));
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" variant="editor" />);
    expect(screen.queryByTestId("week-card-download-busy")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });

    expect(screen.getByTestId("week-card-download-busy")).toHaveTextContent("만드는 중…");
    expect(screen.getByTestId("week-card-download-btn")).toHaveAccessibleName(
      "PNG 카드를 만드는 중",
    );
  });

  it("첫 캡처가 아직 도는 동안 시간 초과로 재시도해도 toPng 을 새로 부르지 않는다", async () => {
    // 적대적 리뷰가 잡은 자리 — 시간 초과는 화면만 풀 뿐 진 쪽(html-to-image 작업)을 취소하지
    // 않는다. 재시도가 그 위에 매번 새 toPng() 를 얹으면 폰트 임베드가 막힌 환경에서 재시도할
    // 때마다 작업이 쌓인다 — startCapture 의 in-flight 재사용이 그걸 막는지 여기서 못박는다.
    vi.mocked(toPng).mockImplementation(() => new Promise(() => {})); // 이 테스트 안에서 안 끝남
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });
    await waitFor(() => expect(screen.getByTestId("week-card-download-btn")).toBeEnabled());
    expect(toPng).toHaveBeenCalledTimes(1);

    // 재시도 — 첫 toPng 호출은 여전히 안 끝난 채다.
    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });
    await waitFor(() => expect(screen.getByTestId("week-card-download-btn")).toBeEnabled());
    expect(toPng).toHaveBeenCalledTimes(1); // 두 번째 클릭이 새 toPng 을 안 불렀다.
  });

  it("주 A 캡처가 아직 도는 동안 주 B 로 넘어가 눌러도 주 B 를 새로 캡처한다", async () => {
    // 적대적 리뷰가 잡은 자리 — in-flight 재사용을 node 만으로 가르면(week-card.tsx 는 리마운트
    // 없이 다시 그려 같은 DOM 노드를 재사용하므로) 주 A 의 옛 캡처를 주 B 요청에 그대로 돌려줘,
    // 화면엔 주 B 인데 실제로 내려받는 그림은 주 A 인 채 파일명만 주 B 로 나갈 뻔했다.
    vi.mocked(toPng).mockImplementation(() => new Promise(() => {})); // 주 A 캡처 — 안 끝남
    const { rerender } = render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });
    await waitFor(() => expect(screen.getByTestId("week-card-download-btn")).toBeEnabled());
    expect(toPng).toHaveBeenCalledTimes(1); // 주 A 캡처는 여전히 배경에서 도는 채다.

    // 리마운트 없이 주 B 로 props 만 바뀐다(WeekNav 클라이언트 네비와 같은 모양).
    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,week-b");
    rerender(<WeekCardDownload card={NEXT_WEEK_CARD} weekStartDate="2026-07-27" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });

    expect(toPng).toHaveBeenCalledTimes(2); // 주 A 의 진행 중인 캡처를 재사용하지 않고 새로 불렀다.
    // toBeInTheDocument 는 못 쓴다 — 캡처 직후 finally 가 스냅샷을 곧장 떼어낸다(위 주석 참고).
    const [node] = vi.mocked(toPng).mock.calls.at(-1)!;
    within(node as HTMLElement).getByText("7.27 – 8.2");
    expect(capturedAnchor!.href).toBe("data:image/png;base64,week-b");
    expect(capturedAnchor!.download).toBe("챠이로쿠냐_주간일정_2026-07-27.png");
  });

  it("같은 주라도(weekStartDate 그대로) 카드 내용이 바뀌면 진행 중이던 캡처를 재사용하지 않는다", async () => {
    // 적대적 리뷰가 잡은 자리(라운드 5) — weekStartDate 문자열로만 in-flight 캐시를 가르면,
    // 편집기에서 같은 주를 저장해 baseline 이 바뀌어도(card 오브젝트가 새로 만들어져도)
    // weekStartDate 는 그대로라 "같은 요청 재시도"로 오판한다. 그러면 저장 전 옛 캡처가 시간
    // 초과로 화면만 풀린 채 배경에서 계속 돌던 중, 저장 후 다시 눌렀을 때 그 옛 프라미스를
    // 그대로 돌려줘 저장 전 그림이 저장 후 파일명으로 나갈 뻔했다.
    vi.mocked(toPng).mockImplementation(() => new Promise(() => {})); // 저장 전 캡처 — 안 끝남
    const { rerender } = render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });
    await waitFor(() => expect(screen.getByTestId("week-card-download-btn")).toBeEnabled());
    expect(toPng).toHaveBeenCalledTimes(1); // 저장 전 캡처는 여전히 배경에서 도는 채다.

    // weekStartDate 는 그대로, 내용만 바뀐 새 card — 편집기가 저장 성공 시 baseline 을 갈아
    // 끼워 useMemo 가 새 참조를 주는 것과 같은 모양(schedule-editor.tsx).
    const REVISED_CARD: WeekCardData = { ...CARD, note: "공지 수정됨" };
    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,revised");
    rerender(<WeekCardDownload card={REVISED_CARD} weekStartDate="2026-07-20" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });

    expect(toPng).toHaveBeenCalledTimes(2); // 내용이 바뀐 카드라 재사용하지 않고 새로 캡처했다.
    expect(capturedAnchor!.href).toBe("data:image/png;base64,revised");
    expect(capturedAnchor!.download).toBe("챠이로쿠냐_주간일정_2026-07-20.png");
  });

  it("같은 주에서 팬아트만 갈아 끼워도 새로 캡처한다(이슈 #122)", async () => {
    /* 팬아트가 `WeekCardData` **안**에 있어야 하는 이유를 못박는다 — 캡처 캐시 키가
       `${weekStartDate}:${JSON.stringify(card)}` 라, 팬아트를 카드 밖 별도 prop 으로 넘기면
       그림을 바꿔 저장한 뒤 다시 받아도 키가 그대로여서 **옛 그림이 담긴 캡처**가 나온다.
       위 "내용이 바뀌면" 스펙과 같은 함정이지만, 그 스펙은 note 만 바꿔 보므로 팬아트가 키에
       실리는지는 안 본다(팬아트를 빼도 초록이다). */
    vi.mocked(toPng).mockImplementation(() => new Promise(() => {})); // 첫 그림 캡처 — 안 끝남
    const FIRST: WeekCardData = {
      ...CARD,
      fanart: { imageKey: "first.png", credit: null, size: null },
    };
    const { rerender } = render(<WeekCardDownload card={FIRST} weekStartDate="2026-07-20" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });
    await waitFor(() => expect(screen.getByTestId("week-card-download-btn")).toBeEnabled());
    // 캡처 전 그림 인라인(fetch→blob→FileReader)이 마이크로태스크 여럿을 지나므로 기다린다.
    await waitFor(() => expect(toPng).toHaveBeenCalledTimes(1));

    const SWAPPED: WeekCardData = {
      ...CARD,
      fanart: { imageKey: "second.png", credit: null, size: null },
    };
    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,swapped");
    rerender(<WeekCardDownload card={SWAPPED} weekStartDate="2026-07-20" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });

    await waitFor(() => expect(toPng).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(capturedAnchor!.href).toBe("data:image/png;base64,swapped"));
  });

  it("화면 밖으로 치우는 스타일은 감싸는 상자가 받는다 — 캡처 대상 노드엔 안 건다", async () => {
    /* 이걸 복제본 자신에 걸면 **받아지는 PNG 가 통째로 빈다**(2026-07-30 실측, 이슈 #122):
       html-to-image 가 computed style 을 SVG foreignObject 안으로 그대로 베끼는데,
       `position: fixed` 는 그 안에서 SVG 뷰포트 기준이라 카드가 -10000px 에 놓인다. 게이트
       전부 초록인 채로 살아 있던 결함이라(빈 PNG 도 유효한 PNG 이고 치수도 맞다) 여기서
       구조를 못박고, "그림이 실제로 담기는가"는 e2e 가 픽셀로 본다. */
    const seen: { pos: string; parentPos: string; parentTop: string; inDoc: boolean }[] = [];
    vi.mocked(toPng).mockImplementation(async (node) => {
      const el = node as HTMLElement;
      const parent = el.parentElement!;
      seen.push({
        pos: el.style.position,
        parentPos: parent.style.position,
        parentTop: parent.style.top,
        inDoc: document.body.contains(el),
      });
      return "data:image/png;base64,ok";
    });
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.pos).toBe(""); // 복제본은 원본 스타일 그대로
    expect(seen[0]!.parentPos).toBe("fixed");
    expect(seen[0]!.parentTop).toBe("-10000px");
    // 문서에 붙어 있어야 레이아웃(폭·오프셋)이 나온다 — 떨어진 조각은 치수가 0 이다.
    expect(seen[0]!.inDoc).toBe(true);
    // 캡처가 끝나면 감싼 상자째로 치운다(빈 상자가 body 에 쌓이지 않는다).
    await waitFor(() => expect(document.querySelectorAll(".week-card")).toHaveLength(1));
  });

  describe("그림 인라인(이슈 #122)", () => {
    /* html-to-image 에 맡기면 **같은 세션의 두 번째 캡처가 그림을 통째로 빠뜨린다**(실측
       2026-07-30: 6번 연속 캡처 중 2번만 빔). SVG 엔 data URL 이 제대로 들어가는데 래스터화가
       그 안쪽 그림의 디코드를 기다리지 않는 것이라, **미리 같은 문자열을 이 문서에서 디코드해
       둔다**(week-card-download.tsx 의 inlineImages). 여기선 그 배선만 본다 — 실제로 그림이
       담기는지는 e2e 가 받은 파일의 픽셀로 본다. */
    /* 인라인은 fetch → blob → FileReader 라 클릭 한 번에 여러 마이크로태스크를 지난다 — `act`
       한 번으로는 toPng 까지 못 간다. 그 상태로 다음 테스트가 시작되면 **늦게 도착한 캡처가 다음
       테스트의 toPng mock 을 부른다**(실제로 두 테스트의 단언이 서로 뒤바뀌어 실패했다). 그래서
       toPng 이 실제로 불린 것을 기다린 뒤 단언한다. */
    async function clickAndAwaitCapture() {
      await act(async () => {
        fireEvent.click(screen.getByTestId("week-card-download-btn"));
      });
      await waitFor(() => expect(toPng).toHaveBeenCalled());
    }

    it("캡처에 넘기는 노드의 그림은 data URL 이다 — 라이브러리 fetch 를 안 태운다", async () => {
      let srcSeen = "";
      vi.mocked(toPng).mockImplementation(async (node) => {
        srcSeen = (node as HTMLElement).querySelector("img")!.getAttribute("src") ?? "";
        return "data:image/png;base64,ok";
      });

      render(<WeekCardDownload card={FANART_CARD} weekStartDate="2026-07-20" />);
      await clickAndAwaitCapture();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/fanart/b7f3.png"),
      );
      expect(srcSeen.startsWith("data:image/png;base64,")).toBe(true);
    });

    it("그림을 못 받아 오면 주소를 그대로 두고 캡처는 계속한다", async () => {
      /* 그림 한 장 때문에 일정 카드 전체를 못 받게 만들지 않는다 — 라이브러리가 예전처럼 자기
         경로로 시도하고, 실패하면 그림만 빠진 카드가 나온다(이 변경 전과 같은 상태). */
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error("network"));
      let srcSeen = "";
      vi.mocked(toPng).mockImplementation(async (node) => {
        srcSeen = (node as HTMLElement).querySelector("img")!.getAttribute("src") ?? "";
        return "data:image/png;base64,ok";
      });

      render(<WeekCardDownload card={FANART_CARD} weekStartDate="2026-07-20" />);
      await clickAndAwaitCapture();

      expect(srcSeen).toBe("/api/fanart/b7f3.png");
      await waitFor(() => expect(capturedAnchor!.href).toBe("data:image/png;base64,ok"));
    });

    it("그림이 404 여도(내려간 뒤 받은 링크) 캡처는 계속한다", async () => {
      /* 응답이 오되 그림이 아닌 경우다 — 던지지 않으므로 위 catch 로 안 잡힌다. 저장된 키가
         가리키던 객체를 지운 주에서 실제로 날 수 있다(ADR-0028 의 dangling key). */
      vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false } as unknown as Response);
      let srcSeen = "";
      vi.mocked(toPng).mockImplementation(async (node) => {
        srcSeen = (node as HTMLElement).querySelector("img")!.getAttribute("src") ?? "";
        return "data:image/png;base64,ok";
      });

      render(<WeekCardDownload card={FANART_CARD} weekStartDate="2026-07-20" />);
      await clickAndAwaitCapture();

      expect(srcSeen).toBe("/api/fanart/b7f3.png");
    });

    it("팬아트 없는 주는 받아 올 그림이 없어 fetch 자체를 안 한다", async () => {
      vi.mocked(toPng).mockResolvedValue("data:image/png;base64,ok");

      render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);
      await clickAndAwaitCapture();

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  it("클릭 직후(폰트 대기 중) 리마운트 없이 주가 바뀌어도 클릭 시점 내용을 그대로 캡처한다", async () => {
    // 평이한 리뷰가 잡은 자리(라운드 5) — 살아있는 nodeRef.current 를 그대로 넘기면,
    // import("html-to-image")·document.fonts.ready 를 기다리는 사이(비동기 틈)에 사용자가
    // WeekNav 로 다음 주로 넘어가도(리마운트 없음) 그 노드가 다음 주 내용으로 다시 그려진
    // 뒤에야 toPng 이 돈다 — 파일명은 클릭 시점 주인데 그림은 그 사이 바뀐 주가 찍힐 뻔했다.
    // document.fonts.ready 를 손으로 쥐고 있다가, rerender 뒤에 풀어 그 창을 재현한다.
    let resolveFontsReady!: () => void;
    Object.defineProperty(document, "fonts", {
      value: {
        ready: new Promise<void>((resolve) => {
          resolveFontsReady = resolve;
        }),
      },
      configurable: true,
    });
    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,week-a-snapshot");

    const { rerender } = render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);

    act(() => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });

    // 클릭 직후, 아직 폰트 대기 중(캡처가 실제로 시작되기 전)에 리마운트 없이 주 B 로 넘어간다.
    rerender(<WeekCardDownload card={NEXT_WEEK_CARD} weekStartDate="2026-07-27" />);

    await act(async () => {
      resolveFontsReady();
    });
    await waitFor(() => expect(toPng).toHaveBeenCalledTimes(1));

    // toBeInTheDocument 는 못 쓴다 — 캡처 직후 finally 가 스냅샷을 곧장 떼어낸다(위 주석 참고).
    const [node] = vi.mocked(toPng).mock.calls[0]!;
    // 캡처는 클릭 시점(주 A) 내용의 스냅샷이어야 한다 — 그 사이 넘어간 주 B 가 아니라.
    within(node as HTMLElement).getByText("7.20 – 7.26");
    expect(capturedAnchor!.download).toBe("챠이로쿠냐_주간일정_2026-07-20.png");
  });

  it("주 A 가 시간 초과 후에도 배경에서 도는 동안 주 B 를 거쳐 다시 주 A 로 돌아와도 새로 캡처하지 않는다", async () => {
    // 적대적 리뷰가 잡은 자리(라운드 6) — in-flight 항목을 하나만(가장 최근 카드) 들고 있으면,
    // 주 A 캡처가 시간 초과로 화면만 풀린 채 배경에서 도는 동안 주 B 로 넘어가 캡처하면 그
    // 하나짜리 항목이 B 로 덮어써진다 — 그 뒤 다시 주 A 로 돌아와 눌러도(내용은 처음과 같은
    // A, 서버가 네비게이션마다 새로 내려주는 새 오브젝트) 배경에서 아직 도는 A 의 캡처를 더는
    // 못 찾아 세 번째 물리적 캡처를 또 시작할 뻔했다. Map 이 여러 키를 동시에 들고 있어야
    // WeekNav 로 앞뒤를 오가는 흔한 조작에서도 진행 중인 캡처를 되찾는다.
    vi.mocked(toPng).mockImplementation(() => new Promise(() => {})); // 주 A 캡처 — 안 끝남
    const { rerender } = render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });
    await waitFor(() => expect(screen.getByTestId("week-card-download-btn")).toBeEnabled());
    expect(toPng).toHaveBeenCalledTimes(1); // 주 A — 배경에서 여전히 도는 채.

    // 주 B 로 넘어가 캡처 — 역시 안 끝남.
    rerender(<WeekCardDownload card={NEXT_WEEK_CARD} weekStartDate="2026-07-27" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });
    await waitFor(() => expect(screen.getByTestId("week-card-download-btn")).toBeEnabled());
    expect(toPng).toHaveBeenCalledTimes(2); // 주 B — 역시 배경에서 도는 채.

    // 다시 주 A 로 돌아온다 — 내용은 처음 주 A 와 완전히 같지만(서버가 네비게이션마다 새로
    // 내려주는 것과 같은 모양) 새 오브젝트다.
    const CARD_AGAIN: WeekCardData = JSON.parse(JSON.stringify(CARD)) as WeekCardData;
    rerender(<WeekCardDownload card={CARD_AGAIN} weekStartDate="2026-07-20" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("week-card-download-btn"));
    });

    expect(toPng).toHaveBeenCalledTimes(2); // 세 번째 캡처를 새로 시작하지 않고 주 A 의 것을 재사용했다.
  });
});
