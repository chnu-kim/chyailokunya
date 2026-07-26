import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { GameBoard } from "./game-board";
import { makeGameCard } from "./test-fixtures";

/* 특성화 2(#78) — 삭제 후 포커스가 추가 슬롯으로 넘어가는 것(game-board.tsx 의
   onDetailClosed). 트리거였던 카드가 삭제로 함께 사라지므로 포커스가 body 로 떨어지지
   않고 추가 슬롯이 그 자리를 받는 배선을 XState 이관(#81) 전에 못박는다. */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    games: { remove: { mutate: vi.fn() } },
    suggestions: { list: { query: vi.fn() }, resolve: { mutate: vi.fn() } },
  },
}));

import { trpc } from "@/features/trpc/client";

beforeEach(() => {
  vi.mocked(trpc.games.remove.mutate).mockReset();
});

describe("삭제 후 포커스 인계", () => {
  it("카드 삭제 확정 후 포커스가 추가 슬롯으로 넘어간다", async () => {
    vi.mocked(trpc.games.remove.mutate).mockResolvedValue({ deleted: true });
    const game = makeGameCard({ id: 7, categoryValue: "지울 게임" });

    render(
      <GameBoard
        initialGames={[game]}
        canWrite={true}
        canDelete={true}
        signedIn={false}
        initialPending={0}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "지울 게임 자세히" }));
    fireEvent.click(screen.getByTestId("game-del-7"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("game-delete-submit"));
    });

    const addSlot = screen.getByTestId("composer-open");
    expect(addSlot).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("지울 게임 삭제됨");
  });
});
