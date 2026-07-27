import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScheduleGameSearch } from "./schedule-game-search";

/* 리뷰 지적(2026-07-28, PR #114 5라운드) — 정확히 같은 이름이 있는지를 화면에 보여줄 8개로
   자른 뒤에 판정하면, 부분 일치가 8개를 넘고 그 정확한 이름이 9번째 이후(사전순 정렬이라
   흔하다)에 있을 때 "이미 있다"를 놓친다 — 치지직 검색이 열리고, 직접 추가는 categoryId 가
   null 이라 DB UNIQUE 도 안 걸려 같은 게임이 두 번 생긴다. 잘라내기 전 전체 목록에서 정확한
   일치를 먼저 찾고, 화면에 보여줄 목록도 그 항목을 맨 앞으로 당긴 뒤 자르게 고쳤다 —
   이 테스트가 그 결과(항목이 실제로 보이고, 치지직 검색이 안 열림)를 함께 못박는다. */

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

// "테스트 게임"을 포함하는 이름을 9개 만든다 — "테스트 게임"(정확히 같은 이름)은 사전순으로
// 맨 뒤(9번째)에 오게 접두사를 붙여, 8개로 자르면 원래는 잘려 나가던 자리에 놓는다.
function makeLocalGames() {
  const games = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    categoryValue: `테스트 게임 ${String.fromCharCode(65 + i)}`, // A~H, 사전순으로 정확한 이름보다 앞
    posterImageUrl: null,
  }));
  games.push({ id: 9, categoryValue: "테스트 게임", posterImageUrl: null });
  return games;
}

describe("ScheduleGameSearch — 부분 일치가 8개를 넘어도 정확한 일치를 놓치지 않는다", () => {
  it("정확히 같은 이름이 9번째여도 로컬 결과에 보이고, 치지직 검색은 안 연다", async () => {
    render(
      <ScheduleGameSearch
        idPrefix="test-"
        localGames={makeLocalGames()}
        currentGameId={null}
        onPick={vi.fn()}
        onUnlink={vi.fn()}
        onGameCreated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "테스트 게임" } });

    // 정확한 이름이 화면에 실제로 보여야 사용자가 그걸 골라 이을 수 있다.
    expect(await screen.findByText("테스트 게임")).toBeInTheDocument();

    // 디바운스(350ms)를 기다려도 치지직 검색은 안 나가야 한다 — 이미 정확히 있다고 봤으므로.
    await new Promise((r) => setTimeout(r, 500));
    expect(trpc.chzzk.categorySearch.query).not.toHaveBeenCalled();
  });
});
