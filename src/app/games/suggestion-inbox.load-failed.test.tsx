import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
      <SuggestionInbox
        games={[makeGameCard()]}
        pending={1}
        onApply={() => {}}
        onResolved={() => {}}
        onClose={() => {}}
      />,
    );

    expect(
      await screen.findByText("검색에 실패했습니다. 잠시 후 다시 시도해 주십시오."),
    ).toBeInTheDocument();
  });
});
