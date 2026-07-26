import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { GameBoard } from "./game-board";
import { makeGameCard } from "./test-fixtures";

/* play-dates-load 머신 배선(#84) 회귀 — playedDate 프라이밍은 loading→loaded 전이 때 딱
   한 번만 일어나야 한다. state.context.dates 참조가 아니라 state 객체 자체나 매 렌더 도는
   effect 로 잘못 배선하면, 조회가 끝난 뒤 사용자가 고친 값이 부모 리렌더 때마다 로드값으로
   되돌아간다(game-editor.tsx 의 "가드 없이 매 렌더 돌면 사용자가 고친 값을 되돌린다" 주석). */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    games: { playDates: { query: vi.fn() } },
  },
}));

import { trpc } from "@/features/trpc/client";

beforeEach(() => {
  vi.mocked(trpc.games.playDates.query).mockReset();
});

describe("게임 수정 모달의 날짜 프라이밍", () => {
  it("조회가 끝난 뒤 사용자가 고친 날짜는 부모 리렌더에도 살아남는다", async () => {
    vi.mocked(trpc.games.playDates.query).mockResolvedValue(["2026-01-01"]);
    const game = makeGameCard({ id: 6, categoryValue: "프라이밍 게임", lastPlayed: "2026-01-01" });

    const { rerender } = render(
      <GameBoard
        initialGames={[game]}
        canWrite={true}
        canDelete={false}
        signedIn={false}
        initialPending={0}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "프라이밍 게임 자세히" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("game-edit-6"));
    });

    const input = await screen.findByTestId<HTMLInputElement>("editor-played");
    expect(input.value).toBe("2026-01-01");

    fireEvent.change(input, { target: { value: "2026-03-03" } });
    expect(input.value).toBe("2026-03-03");

    // 부모(GameBoard) 를 같은 props 로 다시 그린다 — announcement 갱신 등 이 폼과 무관한
    // 이유로도 실제로 일어나는 재렌더를 흉내낸다.
    rerender(
      <GameBoard
        initialGames={[game]}
        canWrite={true}
        canDelete={false}
        signedIn={false}
        initialPending={0}
      />,
    );

    expect(screen.getByTestId<HTMLInputElement>("editor-played").value).toBe("2026-03-03");
    // 조회 자체는 마운트 때 한 번만 — 리렌더가 재조회를 유발하지 않는다.
    expect(trpc.games.playDates.query).toHaveBeenCalledTimes(1);
  });
});
