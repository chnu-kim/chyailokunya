import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { SuggestionInbox } from "./suggestion-inbox";
import { makeGameCard, makeSuggestion } from "./test-fixtures";

/* 특성화 8(#78) — 제안함 거절 진행 중 표시(rejectingId). 버튼 하나만 잠가야 한다 — 전체를
   잠그면 다른 줄도 못 읽는다(suggestion-inbox.tsx 주석). */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    suggestions: { list: { query: vi.fn() }, resolve: { mutate: vi.fn() } },
  },
}));

import { trpc } from "@/features/trpc/client";

beforeEach(() => {
  vi.mocked(trpc.suggestions.list.query).mockReset();
  vi.mocked(trpc.suggestions.resolve.mutate).mockReset();
});

describe("제안 거절 진행 중 표시", () => {
  it("거절이 서버 왕복 중인 줄만 잠그고 다른 줄은 그대로 조작 가능하다", async () => {
    const items = [makeSuggestion({ id: 1, gameId: 1 }), makeSuggestion({ id: 2, gameId: 1 })];
    vi.mocked(trpc.suggestions.list.query).mockResolvedValue(items);

    let resolveMutate!: (v: { resolved: boolean }) => void;
    vi.mocked(trpc.suggestions.resolve.mutate).mockReturnValue(
      new Promise((resolve) => {
        resolveMutate = resolve;
      }),
    );

    render(
      <SuggestionInbox
        games={[makeGameCard({ id: 1 })]}
        pending={2}
        onApply={() => {}}
        onResolved={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(await screen.findByTestId("suggestion-reject-1"));

    const rejectingButton = screen.getByTestId("suggestion-reject-1");
    expect(rejectingButton).toHaveTextContent("거절 중…");
    expect(rejectingButton).toBeDisabled();
    // 다른 줄의 반영·거절은 잠기지 않는다.
    expect(screen.getByTestId("suggestion-reject-2")).not.toBeDisabled();
    expect(screen.getByTestId("suggestion-apply-2")).not.toBeDisabled();

    await act(async () => {
      resolveMutate({ resolved: true });
    });

    expect(screen.queryByTestId("suggestion-1")).not.toBeInTheDocument();
  });

  /* #80(submit 머신 배선) 리뷰가 잡은 회귀 — 항목마다 독립 액터가 아니라 인박스 전체가 공유하는
     액터 하나였을 때, 한 줄이 제출 중이면 다른(잠기지 않은) 줄의 거절 클릭이 조용히 무시됐다
     (XState 가 submitting 상태의 submit 이벤트를 버린다). 버튼이 안 잠긴 채 눌러도 아무 일이
     안 나는 결함이라 disabled 단언만으로는 못 잡는다 — 실제로 두 번째 뮤테이션이 나가는지까지
     본다. */
  it("한 줄이 거절되는 동안 다른 줄을 거절해도 두 요청 모두 나간다", async () => {
    const items = [makeSuggestion({ id: 1, gameId: 1 }), makeSuggestion({ id: 2, gameId: 1 })];
    vi.mocked(trpc.suggestions.list.query).mockResolvedValue(items);

    let resolve1!: (v: { resolved: boolean }) => void;
    let resolve2!: (v: { resolved: boolean }) => void;
    vi.mocked(trpc.suggestions.resolve.mutate)
      .mockImplementationOnce(() => new Promise((r) => (resolve1 = r)))
      .mockImplementationOnce(() => new Promise((r) => (resolve2 = r)));

    render(
      <SuggestionInbox
        games={[makeGameCard({ id: 1 })]}
        pending={2}
        onApply={() => {}}
        onResolved={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(await screen.findByTestId("suggestion-reject-1"));
    fireEvent.click(screen.getByTestId("suggestion-reject-2"));

    expect(trpc.suggestions.resolve.mutate).toHaveBeenCalledTimes(2);
    expect(trpc.suggestions.resolve.mutate).toHaveBeenNthCalledWith(
      2,
      { id: 2, resolution: "rejected" },
      expect.anything(),
    );

    // 나중에 누른 줄이 먼저 끝나도(응답 순서는 클릭 순서와 무관하다) 독립적으로 처리된다.
    await act(async () => {
      resolve2({ resolved: true });
    });
    expect(screen.queryByTestId("suggestion-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("suggestion-reject-1")).toBeDisabled();

    await act(async () => {
      resolve1({ resolved: true });
    });
    expect(screen.queryByTestId("suggestion-1")).not.toBeInTheDocument();
  });
});
