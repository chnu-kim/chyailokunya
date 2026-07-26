import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GameBoard } from "./game-board";
import { makeGameCard } from "./test-fixtures";

/* 특성화 3(#78) — 라이브 영역(role="status") 문구 전부. game-board.tsx 의 announcement 는
   사건마다 다른 문장을 내는데 지금 하나도 안 덮여 있다(justAdded·delete-focus 스펙이 추가/
   삭제 문구는 이미 덮는다 — 여긴 나머지: 수정됨·제안 전송 완료).

   onApplySuggestion 의 "그 게임이 보드에 없습니다" 분기(!game)는 여기서 안 덮는다 —
   SuggestionInbox 의 「반영하기」가 정확히 같은 조건(item.kind==="edit" && !game)으로 버튼을
   disabled 시켜, 같은 렌더의 games 배열을 공유하는 한 그 버튼을 눌러 이 분기에 닿을 길이
   없다(실측: disabled=true). 클릭이 안 먹는 버튼을 강제로 발화시키는 건 실제로 관측 가능한
   동작이 아니라 죽은 코드를 재는 것이라 이 특성화의 취지(지금 화면이 실제로 하는 일을
   못박는다)에 안 맞는다. */

vi.mock("@/features/trpc/client", () => ({
  trpc: {
    games: { update: { mutate: vi.fn() }, playDates: { query: vi.fn() } },
    suggestions: { create: { mutate: vi.fn() } },
  },
}));

import { trpc } from "@/features/trpc/client";

beforeEach(() => {
  vi.mocked(trpc.games.update.mutate).mockReset();
  vi.mocked(trpc.games.playDates.query).mockReset();
  vi.mocked(trpc.suggestions.create.mutate).mockReset();
});

describe("보드 라이브 영역 문구", () => {
  it("수정 저장에 성공하면 '{이름} 수정됨'을 알린다", async () => {
    vi.mocked(trpc.games.playDates.query).mockResolvedValue([]);
    const game = makeGameCard({ id: 3, categoryValue: "고칠 게임" });
    const updated = { ...game, cleared: true, clearedDate: "2026-02-10" };
    vi.mocked(trpc.games.update.mutate).mockResolvedValue(updated);

    render(
      <GameBoard
        initialGames={[game]}
        canWrite={true}
        canDelete={false}
        signedIn={false}
        initialPending={0}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "고칠 게임 자세히" }));
    fireEvent.click(screen.getByTestId("game-edit-3"));
    // playDates 조회가 끝나야 저장 버튼이 풀린다.
    await waitFor(() => expect(screen.getByTestId("game-editor-submit")).toBeEnabled());

    await act(async () => {
      fireEvent.click(screen.getByTestId("game-editor-submit"));
    });

    expect(screen.getByRole("status")).toHaveTextContent("고칠 게임 수정됨");
  });

  it("추가 요청을 보내면 성공 화면을 거쳐 '게임 추가 요청을 보냈습니다'를 알린다", async () => {
    // 반환값은 컴포넌트가 안 읽는다(suggest-dialog.tsx onSubmit) — 실제 행 타입을 안 지어낸다.
    vi.mocked(trpc.suggestions.create.mutate).mockResolvedValue(undefined as never);

    render(
      <GameBoard
        initialGames={[]}
        canWrite={false}
        canDelete={false}
        signedIn={true}
        initialPending={0}
      />,
    );

    fireEvent.click(screen.getByTestId("suggest-add-open"));
    fireEvent.change(screen.getByTestId("suggest-title"), { target: { value: "새 요청 게임" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("suggest-submit"));
    });

    fireEvent.click(await screen.findByTestId("suggest-done"));

    expect(screen.getByRole("status")).toHaveTextContent("게임 추가 요청을 보냈습니다");
  });
});
