import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { GameBoard } from "./game-board";
import { makeGameCard } from "./test-fixtures";

/* 특성화 1(#78) — justAdded 강조 링과 타이머, 추가 후 포커스 이동. 지금 아무 데서도 안
   덮이는 배선이라 XState 이관(#80) 전에 여기 못박는다(에픽 #77).

   컴포저의 검색 단계를 실제로 태운다(직접 추가 경로) — onAdded 콜백을 직접 부르면 이
   컴포저→보드 인계 자체를 증명하지 못한다. */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    chzzk: { categorySearch: { query: vi.fn() } },
    games: { add: { mutate: vi.fn() } },
    suggestions: { list: { query: vi.fn() }, resolve: { mutate: vi.fn() } },
  },
}));

import { trpc } from "@/features/trpc/client";

beforeEach(() => {
  vi.mocked(trpc.chzzk.categorySearch.query).mockReset();
  vi.mocked(trpc.games.add.mutate).mockReset();
});

describe("게임 추가 후 justAdded 강조·포커스", () => {
  it("추가된 카드가 강조되고 포커스를 받은 뒤 JUST_ADDED_MS 후 강조가 풀린다", async () => {
    vi.mocked(trpc.chzzk.categorySearch.query).mockResolvedValue([]);
    const added = makeGameCard({ id: 42, categoryValue: "새 게임" });
    vi.mocked(trpc.games.add.mutate).mockResolvedValue(added);

    vi.useFakeTimers();
    try {
      render(
        <GameBoard
          initialGames={[]}
          canWrite={true}
          canDelete={false}
          signedIn={false}
          initialPending={0}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "게임 추가" }));

      const input = screen.getByRole("combobox", { name: "게임 이름" });
      fireEvent.change(input, { target: { value: "새 게임" } });

      // SEARCH_DEBOUNCE_MS(350ms) 경과 + 검색 응답 처리.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      fireEvent.click(screen.getByTestId("composer-direct"));

      const submit = screen.getByRole("button", { name: "추가" });
      await act(async () => {
        fireEvent.click(submit);
        await vi.advanceTimersByTimeAsync(0);
      });

      // 컴포저가 닫히고 카드가 강조된 채 포커스를 받는다.
      const card = screen.getByRole("button", { name: "새 게임 자세히" });
      expect(card).toHaveFocus();
      expect(card.closest(".polaroid")).toHaveClass("game--just-added");
      expect(screen.getByRole("status")).toHaveTextContent("새 게임 추가됨");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(card.closest(".polaroid")).not.toHaveClass("game--just-added");
    } finally {
      vi.useRealTimers();
    }
  });
});
