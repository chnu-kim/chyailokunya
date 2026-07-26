import type { GameCard } from "@/features/games/service";
import type { SuggestionListItem } from "@/features/suggestions/service";

// dom 프로젝트 전용 픽스처. 실제 컴포넌트를 마운트해 배선을 재는 특성화 테스트가 공유한다.
export function makeGameCard(overrides: Partial<GameCard> = {}): GameCard {
  return {
    id: 1,
    categoryId: "cat-1",
    categoryType: "GAME",
    categoryValue: "테스트 게임",
    posterImageUrl: null,
    cleared: false,
    clearedDate: null,
    createdAt: 0,
    lastUpdatedAt: 0,
    lastPlayed: null,
    ...overrides,
  };
}

export function makeSuggestion(overrides: Partial<SuggestionListItem> = {}): SuggestionListItem {
  return {
    id: 1,
    kind: "edit",
    gameId: 1,
    proposedTitle: null,
    proposed: { cleared: true, clearedDate: null, playedDate: "2026-02-01" },
    note: null,
    authorName: "팬",
    createdAt: 0,
    ...overrides,
  };
}
