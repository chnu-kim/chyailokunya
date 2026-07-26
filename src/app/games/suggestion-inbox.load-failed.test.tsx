import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardOverlay } from "./board-overlay-context";
import { SuggestionInbox } from "./suggestion-inbox";
import { makeGameCard } from "./test-fixtures";

/* 특성화 5(#78) — 제안함 로드 실패. 열릴 때 한 번 불러오는 fetchPending 이 실패하면 오류를
   보여야 한다(readErrorMessage 를 그대로 쓴다 — suggestion-inbox.tsx). */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    suggestions: { list: { query: vi.fn() }, resolve: { mutate: vi.fn() } },
  },
}));

import { trpc } from "@/features/trpc/client";

beforeEach(() => {
  vi.mocked(trpc.suggestions.list.query).mockReset();
});

describe("제안함 목록 로드 실패", () => {
  it("목록 조회가 실패하면 오류를 알린다", async () => {
    vi.mocked(trpc.suggestions.list.query).mockRejectedValue(new Error("network"));

    render(
      <BoardOverlay.Provider options={{ input: { games: [makeGameCard()], pending: 1 } }}>
        <SuggestionInbox />
      </BoardOverlay.Provider>,
    );

    expect(
      await screen.findByText("검색에 실패했습니다. 잠시 후 다시 시도해 주십시오."),
    ).toBeInTheDocument();

    /* #84 배선 회귀 — inbox-load 머신의 context.items 는 failed 에서도 기본값 []이다. items
       파생값을 loadState.matches("loaded") 로 안 감싸면(즉 [] 을 "로드된 빈 목록"으로 오독하면)
       실패 배너 옆에 "목록이 비었다"·"더 있다" 문구가 함께 뜬다 — pending=1 인데 그중 0개도
       못 불러온 상태라 실제로는 둘 다 거짓이다. */
    expect(screen.queryByTestId("inbox-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inbox-more")).not.toBeInTheDocument();
  });
});
