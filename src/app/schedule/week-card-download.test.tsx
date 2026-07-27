import { beforeEach, describe, expect, it, vi } from "vitest";
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
    { dow: "월", date: "7.20", entries: [], overflow: 0 },
    { dow: "화", date: "7.21", entries: [], overflow: 0 },
    { dow: "수", date: "7.22", entries: [], overflow: 0 },
    { dow: "목", date: "7.23", entries: [], overflow: 0 },
    { dow: "금", date: "7.24", entries: [], overflow: 0 },
    { dow: "토", date: "7.25", entries: [], overflow: 0 },
    { dow: "일", date: "7.26", entries: [], overflow: 0 },
  ],
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
});

describe("WeekCardDownload", () => {
  it("카드가 없으면(미발행) 버튼을 잠그고 이유를 알린다", () => {
    render(<WeekCardDownload card={null} weekStartDate="2026-07-20" />);
    expect(screen.getByTestId("week-card-download-btn")).toBeDisabled();
    expect(screen.getByText("발행된 주만 카드로 내려받을 수 있습니다.")).toBeInTheDocument();
    // 미발행이면 캡처할 카드 자체가 없다 — 미리보기도 안 그린다.
    expect(screen.queryByTestId("week-card")).not.toBeInTheDocument();
  });

  it("카드가 있으면 미리보기를 그리고 버튼이 활성이다", () => {
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" />);
    expect(screen.getByTestId("week-card-download-btn")).toBeEnabled();
    expect(screen.getByTestId("week-card")).toBeInTheDocument();
    // stale 을 안 넘기면(읽기 화면 — baseline 개념이 없다) 힌트도 없다.
    expect(screen.queryByTestId("week-card-download-stale")).not.toBeInTheDocument();
  });

  it("stale 이면(편집기의 미저장 변경) 저장을 권하는 힌트를 얹는다", () => {
    render(<WeekCardDownload card={CARD} weekStartDate="2026-07-20" stale />);
    expect(
      screen.getByText(
        "저장하지 않은 변경이 있습니다. 지금 받으면 마지막으로 저장한 내용이 나갑니다.",
      ),
    ).toBeInTheDocument();
    // 미저장 변경은 캡처를 막을 이유가 아니다 — 그저 지금 뭐가 나가는지 알려줄 뿐이다.
    expect(screen.getByTestId("week-card-download-btn")).toBeEnabled();
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
    // 캡처 대상 그림도 새 주 카드여야 한다(미리보기가 새 데이터로 다시 그려졌는지).
    const [node] = vi.mocked(toPng).mock.calls.at(-1)!;
    expect(within(node as HTMLElement).getByText("7.27 – 8.2")).toBeInTheDocument();
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
});
