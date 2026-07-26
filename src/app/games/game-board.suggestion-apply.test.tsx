import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GameBoard } from "./game-board";
import { makeGameCard, makeSuggestion } from "./test-fixtures";

/* 특성화 6·7(#78) — 제안 반영 후 markApplied 의 두 갈래.
   6: resolved=false — 다른 관리자가 먼저 처리했으면 배지를 또 줄이지 않고 그 사실만 알린다.
   7: dateApplied=false — 여러 날 편성이라 날짜를 못 실었으면 처리 표시(resolve.mutate)를
      아예 건너뛴다 — 팬의 날짜 제안이 조용히 사라지면 안 된다(game-board.tsx markApplied). */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    games: { update: { mutate: vi.fn() }, playDates: { query: vi.fn() } },
    suggestions: {
      list: { query: vi.fn() },
      resolve: { mutate: vi.fn() },
    },
  },
}));

import { trpc } from "@/features/trpc/client";

beforeEach(() => {
  vi.mocked(trpc.games.update.mutate).mockReset();
  vi.mocked(trpc.games.playDates.query).mockReset();
  vi.mocked(trpc.suggestions.list.query).mockReset();
  vi.mocked(trpc.suggestions.resolve.mutate).mockReset();
});

async function applyViaEditor() {
  fireEvent.click(screen.getByTestId("inbox-open"));
  fireEvent.click(await screen.findByTestId("suggestion-apply-9"));
  await waitFor(() => expect(screen.getByTestId("game-editor-submit")).toBeEnabled());
  await act(async () => {
    fireEvent.click(screen.getByTestId("game-editor-submit"));
  });
}

describe("제안 반영 후 markApplied", () => {
  it("resolved=false — 다른 관리자가 이미 처리했으면 그 사실만 알린다", async () => {
    const game = makeGameCard({ id: 1, categoryValue: "고칠 게임", lastPlayed: null });
    vi.mocked(trpc.suggestions.list.query).mockResolvedValue([
      makeSuggestion({
        id: 9,
        gameId: 1,
        kind: "edit",
        proposed: { cleared: true, clearedDate: null, playedDate: "2026-02-01" },
      }),
    ]);
    vi.mocked(trpc.games.playDates.query).mockResolvedValue([]);
    vi.mocked(trpc.games.update.mutate).mockResolvedValue({
      ...game,
      cleared: true,
      lastPlayed: "2026-02-01",
    });
    vi.mocked(trpc.suggestions.resolve.mutate).mockResolvedValue({ resolved: false });

    render(
      <GameBoard
        initialGames={[game]}
        canWrite={true}
        canDelete={false}
        signedIn={false}
        initialPending={1}
      />,
    );

    await applyViaEditor();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "저장했습니다 — 그 제안은 다른 관리자가 이미 처리했습니다",
      ),
    );
  });

  it("dateApplied=false — 여러 날 편성이면 처리 표시를 건너뛰고 그대로 안내한다", async () => {
    const game = makeGameCard({ id: 2, categoryValue: "여러 날 게임", lastPlayed: "2026-01-01" });
    vi.mocked(trpc.suggestions.list.query).mockResolvedValue([
      makeSuggestion({
        id: 10,
        gameId: 2,
        kind: "edit",
        proposed: { cleared: true, clearedDate: null, playedDate: "2026-02-05" },
      }),
    ]);
    // 여러 날 편성 — 입력이 잠긴다(core.isPlayDateEditable, dates.length > 1).
    vi.mocked(trpc.games.playDates.query).mockResolvedValue(["2026-01-01", "2026-01-08"]);
    vi.mocked(trpc.games.update.mutate).mockResolvedValue({ ...game, cleared: true });

    render(
      <GameBoard
        initialGames={[game]}
        canWrite={true}
        canDelete={false}
        signedIn={false}
        initialPending={1}
      />,
    );

    fireEvent.click(screen.getByTestId("inbox-open"));
    fireEvent.click(await screen.findByTestId("suggestion-apply-10"));
    await waitFor(() => expect(screen.getByTestId("game-editor-submit")).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByTestId("game-editor-submit"));
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "클리어만 반영했습니다 — 여러 날 편성이라 날짜는 일정에서 고쳐 주십시오. 제안은 그대로 뒀습니다",
    );
    // 날짜를 못 실었으므로 처리 표시(resolve.mutate) 자체를 안 부른다 — 제안이 미처리로 남아야
    // 관리자가 /schedule 에서 고친 뒤 다시 반영할 수 있다.
    expect(trpc.suggestions.resolve.mutate).not.toHaveBeenCalled();
  });
});
