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
});
