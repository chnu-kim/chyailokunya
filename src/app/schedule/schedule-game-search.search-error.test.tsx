import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScheduleGameSearch } from "./schedule-game-search";

/* 리뷰 지적(2026-07-28, PR #114 7라운드 plain review) — searchFailed 는 searched 를 여전히
   false 로 두는데(통신 실패는 "결과 없음"이 아니라서, composer.machine.ts 주석 참고) 로딩
   조건이 searched 만 봤다. 그래서 검색이 실패해도 "찾는 중…"이 에러 문구 옆에서 영원히 안
   풀렸다 — searchError 가 비어 있을 때만 로딩으로 보게 고쳤다. */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    chzzk: { categorySearch: { query: vi.fn() } },
    games: { add: { mutate: vi.fn() } },
  },
}));

import { trpc } from "@/features/trpc/client";

beforeEach(() => {
  vi.mocked(trpc.chzzk.categorySearch.query).mockReset();
  vi.mocked(trpc.games.add.mutate).mockReset();
});

describe("ScheduleGameSearch — 검색 실패 시 로딩 표시가 풀린다", () => {
  it("치지직 검색이 실패하면 찾는 중 문구가 사라지고 에러만 남는다", async () => {
    vi.mocked(trpc.chzzk.categorySearch.query).mockRejectedValue(new Error("네트워크 오류"));

    render(
      <ScheduleGameSearch
        idPrefix="test-"
        localGames={[]}
        currentGameId={null}
        onPick={vi.fn()}
        onUnlink={vi.fn()}
        onGameCreated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "존재하지 않는 게임" } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("검색에 실패했습니다"));
    expect(screen.queryByText("찾는 중…")).not.toBeInTheDocument();
  });
});
