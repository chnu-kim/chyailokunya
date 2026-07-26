import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { GameBoard } from "./game-board";
import { makeGameCard } from "./test-fixtures";

/* 특성화 4(#78) — 게임 수정 모달의 일정 날짜 조회 실패(loadFailed). 조회가 실패하면 저장을
   막아야 한다 — 날짜를 모르는 채로 저장하면 빈 입력이 그대로 나가 멀쩡한 일정 항목이
   지워진다(game-board.tsx GameEditor 주석). */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    games: { playDates: { query: vi.fn() } },
  },
}));

import { trpc } from "@/features/trpc/client";

beforeEach(() => {
  vi.mocked(trpc.games.playDates.query).mockReset();
});

describe("게임 수정 모달의 일정 조회 실패", () => {
  it("조회가 실패하면 오류를 알리고 저장 버튼을 잠근다", async () => {
    vi.mocked(trpc.games.playDates.query).mockRejectedValue(new Error("network"));
    const game = makeGameCard({ id: 5, categoryValue: "조회 실패 게임" });

    render(
      <GameBoard
        initialGames={[game]}
        canWrite={true}
        canDelete={false}
        signedIn={false}
        initialPending={0}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "조회 실패 게임 자세히" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("game-edit-5"));
    });

    expect(
      screen.getByText("일정을 못 불러와서 저장할 수 없습니다. 닫았다 다시 열어 주십시오."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("game-editor-submit")).toBeDisabled();
  });
});
