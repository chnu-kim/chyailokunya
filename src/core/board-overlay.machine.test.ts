import { createActor } from "xstate";
import { describe, expect, it, vi } from "vitest";
import { createBoardOverlayMachine, JUST_ADDED_MS } from "./board-overlay.machine";

/* 이 머신은 GameCard·SuggestionListItem 을 몰라도 되게 제네릭이다(core → features 의존 금지,
   불변식 1) — 테스트는 그 계약을 지키는 최소 모양만 쓴다. */
type Game = { id: number; lastPlayed: string | null; createdAt: number; label: string };
type Suggestion = { id: number; label: string };

function game(id: number, overrides: Partial<Game> = {}): Game {
  return { id, lastPlayed: null, createdAt: id, label: "game" + id, ...overrides };
}

function start(games: Game[] = [], pending = 0) {
  const machine = createBoardOverlayMachine<Game, Suggestion>();
  const actor = createActor(machine, { input: { games, pending } });
  actor.start();
  return actor;
}

describe("boardOverlayMachine — idle 과 기본 오버레이 열고 닫기", () => {
  it("idle 로 시작하고 초기 games·pending 을 그대로 담는다", () => {
    const g = [game(1)];
    const actor = start(g, 3);
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.games).toEqual(g);
    expect(actor.getSnapshot().context.pending).toBe(3);
    expect(actor.getSnapshot().context.announcement).toBe("");
  });

  it("OPEN_COMPOSER → composing, CLOSE_COMPOSER → idle", () => {
    const actor = start();
    actor.send({ type: "OPEN_COMPOSER" });
    expect(actor.getSnapshot().value).toBe("composing");
    actor.send({ type: "CLOSE_COMPOSER" });
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("idle 이 아닌 자리에서 오는 무관한 이벤트는 무시한다(불가능 조합 방어)", () => {
    const actor = start();
    // detail 이 열리기 전엔 EDIT_FROM_DETAIL 을 받는 상태가 없다.
    actor.send({ type: "EDIT_FROM_DETAIL" });
    expect(actor.getSnapshot().value).toBe("idle");
    // composing 이 아닌데 온 GAME_ADDED 도 마찬가지.
    actor.send({ type: "GAME_ADDED", row: game(9), announcement: "x" });
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.games).toEqual([]);
  });

  it("OPEN_INBOX → inbox, CLOSE_INBOX → idle", () => {
    const actor = start();
    actor.send({ type: "OPEN_INBOX" });
    expect(actor.getSnapshot().value).toBe("inbox");
    actor.send({ type: "CLOSE_INBOX" });
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("OPEN_SUGGEST_ADD → suggestAdd, CANCEL_SUGGEST → idle", () => {
    const actor = start();
    actor.send({ type: "OPEN_SUGGEST_ADD" });
    expect(actor.getSnapshot().value).toBe("suggestAdd");
    actor.send({ type: "CANCEL_SUGGEST" });
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("suggestAdd 에서 SUGGESTION_SENT 는 idle 로 돌아가고 announcement 만 남긴다 — detail 이 없어 detailClosing 은 안 켠다", () => {
    const actor = start();
    actor.send({ type: "OPEN_SUGGEST_ADD" });
    actor.send({ type: "SUGGESTION_SENT", announcement: "게임 추가 요청을 보냈습니다" });
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.announcement).toBe("게임 추가 요청을 보냈습니다");
    expect(actor.getSnapshot().context.detailClosing).toBe(false);
  });
});

describe("boardOverlayMachine — 게임 추가와 justAdded 타이머", () => {
  it("GAME_ADDED 는 정렬해 넣고 announcement·justAdded 를 세운 뒤 idle 로 돌아간다", () => {
    const actor = start([game(1, { lastPlayed: "2026-01-01" })]);
    actor.send({ type: "OPEN_COMPOSER" });
    actor.send({
      type: "GAME_ADDED",
      row: game(2, { lastPlayed: "2026-02-01" }),
      announcement: "새 게임 추가됨",
    });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe("idle");
    // sortGameCards 가 최신 lastPlayed 를 앞에 둔다.
    expect(snap.context.games.map((g) => g.id)).toEqual([2, 1]);
    expect(snap.context.announcement).toBe("새 게임 추가됨");
    expect(snap.context.justAdded).toBe(2);
  });

  it("JUST_ADDED_MS 가 지나면 justAdded 가 스스로 풀린다", () => {
    vi.useFakeTimers();
    try {
      const actor = start();
      actor.send({ type: "OPEN_COMPOSER" });
      actor.send({ type: "GAME_ADDED", row: game(1), announcement: "a" });
      expect(actor.getSnapshot().context.justAdded).toBe(1);

      vi.advanceTimersByTime(JUST_ADDED_MS);
      expect(actor.getSnapshot().context.justAdded).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  /* 적대적 리뷰가 원본에서 지키던 계약 — 먼저 추가한 카드의 타이머가 나중에 추가한 카드의
     링을 꺼서는 안 된다. 두 번째 추가가 첫 타이머를 지우고 새로 세운다(cancel+raise). */
  it("연속으로 추가하면 이전 타이머가 취소되고 새 타이머로 재시작한다", () => {
    vi.useFakeTimers();
    try {
      const actor = start();
      actor.send({ type: "OPEN_COMPOSER" });
      actor.send({ type: "GAME_ADDED", row: game(1), announcement: "a" });

      vi.advanceTimersByTime(JUST_ADDED_MS - 200);
      actor.send({ type: "OPEN_COMPOSER" });
      actor.send({ type: "GAME_ADDED", row: game(2), announcement: "b" });
      // 첫 타이머가 만료됐을 시각을 지나도 두 번째 카드의 강조는 남아 있어야 한다.
      vi.advanceTimersByTime(300);
      expect(actor.getSnapshot().context.justAdded).toBe(2);

      // 두 번째 타이머 자신의 만료 시점엔 풀린다.
      vi.advanceTimersByTime(JUST_ADDED_MS - 300 + 1);
      expect(actor.getSnapshot().context.justAdded).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("boardOverlayMachine — 상세와 그 위의 수정·삭제·제안", () => {
  it("OPEN_DETAIL → detail.viewing, DETAIL_CLOSED → idle", () => {
    const g = game(1);
    const actor = start([g]);
    actor.send({ type: "OPEN_DETAIL", game: g });
    expect(actor.getSnapshot().value).toEqual({ detail: "viewing" });
    expect(actor.getSnapshot().context.detailGame).toEqual(g);

    actor.send({ type: "DETAIL_CLOSED" });
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.detailGame).toBeNull();
    // 일반 닫기는 삭제가 아니므로 포커스 신호를 켜지 않는다.
    expect(actor.getSnapshot().context.focusAddSlot).toBe(false);
  });

  it("EDIT_FROM_DETAIL → detail.editing, CANCEL_EDIT → detail.viewing", () => {
    const g = game(1);
    const actor = start([g]);
    actor.send({ type: "OPEN_DETAIL", game: g });
    actor.send({ type: "EDIT_FROM_DETAIL" });
    expect(actor.getSnapshot().value).toEqual({ detail: "editing" });
    expect(actor.getSnapshot().context.editingGame).toEqual(g);

    actor.send({ type: "CANCEL_EDIT" });
    expect(actor.getSnapshot().value).toEqual({ detail: "viewing" });
    expect(actor.getSnapshot().context.editingGame).toBeNull();
  });

  it("detail.editing 에서 GAME_UPDATED 는 games 와 detailGame 을 함께 갈아 끼우고 viewing 으로 돌아간다", () => {
    const g = game(1, { lastPlayed: "2026-01-01" });
    const actor = start([g]);
    actor.send({ type: "OPEN_DETAIL", game: g });
    actor.send({ type: "EDIT_FROM_DETAIL" });

    const updated = { ...g, lastPlayed: "2026-03-01" };
    actor.send({ type: "GAME_UPDATED", row: updated, announcement: "game1 수정됨" });

    const snap = actor.getSnapshot();
    expect(snap.value).toEqual({ detail: "viewing" });
    expect(snap.context.games).toEqual([updated]);
    expect(snap.context.detailGame).toEqual(updated);
    expect(snap.context.announcement).toBe("game1 수정됨");
    expect(snap.context.editingGame).toBeNull();
  });

  it("DELETE_FROM_DETAIL → detail.deleting, CANCEL_DELETE → detail.viewing", () => {
    const g = game(1);
    const actor = start([g]);
    actor.send({ type: "OPEN_DETAIL", game: g });
    actor.send({ type: "DELETE_FROM_DETAIL" });
    expect(actor.getSnapshot().value).toEqual({ detail: "deleting" });

    actor.send({ type: "CANCEL_DELETE" });
    expect(actor.getSnapshot().value).toEqual({ detail: "viewing" });
  });

  /* 특성화 2(#78, game-board.delete-focus.test.tsx)가 못박은 배선 — 삭제 성공은 확인 오버레이만
     아니라 상세 자체도 닫고, 포커스를 추가 슬롯으로 넘기라는 신호를 켠다. 이 신호는 DETAIL_CLOSED
     를 지나서도 살아 있다가 FOCUS_HANDLED 로만 꺼진다(컴포넌트가 실제 focus() 를 부른 뒤). */
  it("detail.deleting 에서 GAME_REMOVED 는 games 를 지우고 상세까지 닫으라는 신호(detailClosing)와 포커스 신호(focusAddSlot)를 함께 켠다", () => {
    const g = game(1);
    const actor = start([g, game(2)]);
    actor.send({ type: "OPEN_DETAIL", game: g });
    actor.send({ type: "DELETE_FROM_DETAIL" });
    actor.send({ type: "GAME_REMOVED", row: g, announcement: "game1 삭제됨" });

    let snap = actor.getSnapshot();
    // 확인 오버레이는 곧바로 닫히지만(viewing) 상세 자체(detail)는 아직 열려 있다.
    expect(snap.value).toEqual({ detail: "viewing" });
    expect(snap.context.games.map((x) => x.id)).toEqual([2]);
    expect(snap.context.announcement).toBe("game1 삭제됨");
    expect(snap.context.detailClosing).toBe(true);
    expect(snap.context.focusAddSlot).toBe(true);

    actor.send({ type: "DETAIL_CLOSED" });
    snap = actor.getSnapshot();
    expect(snap.value).toBe("idle");
    expect(snap.context.detailClosing).toBe(false);
    // focusAddSlot 은 DETAIL_CLOSED 만으로는 안 꺼진다 — 컴포넌트가 focus() 뒤 직접 꺼야 한다.
    expect(snap.context.focusAddSlot).toBe(true);

    actor.send({ type: "FOCUS_HANDLED" });
    expect(actor.getSnapshot().context.focusAddSlot).toBe(false);
  });

  it("SUGGEST_FROM_DETAIL → detail.suggesting, CANCEL_SUGGEST → detail.viewing", () => {
    const g = game(1);
    const actor = start([g]);
    actor.send({ type: "OPEN_DETAIL", game: g });
    actor.send({ type: "SUGGEST_FROM_DETAIL" });
    expect(actor.getSnapshot().value).toEqual({ detail: "suggesting" });

    actor.send({ type: "CANCEL_SUGGEST" });
    expect(actor.getSnapshot().value).toEqual({ detail: "viewing" });
  });

  /* 원본 onSent 의 "if (detail) setDetailClosing(true)" — 상세 위에서 보낸 제안은 상세도 함께
     닫는다. 다만 카드 자체는 안 지워지므로 focusAddSlot 은 안 켠다(브라우저 기본 포커스 복원이
     맞다 — 원본은 이 경로에서 detailRemovedRef 를 안 건드렸다). */
  it("detail.suggesting 에서 SUGGESTION_SENT 는 상세도 함께 닫으라는 신호를 켜지만 포커스 신호는 안 켠다", () => {
    const g = game(1);
    const actor = start([g]);
    actor.send({ type: "OPEN_DETAIL", game: g });
    actor.send({ type: "SUGGEST_FROM_DETAIL" });
    actor.send({ type: "SUGGESTION_SENT", announcement: "game1 수정 제안을 보냈습니다" });

    const snap = actor.getSnapshot();
    expect(snap.value).toEqual({ detail: "viewing" });
    expect(snap.context.announcement).toBe("game1 수정 제안을 보냈습니다");
    expect(snap.context.detailClosing).toBe(true);
    expect(snap.context.focusAddSlot).toBe(false);
  });
});

describe("boardOverlayMachine — 제안함 반영하기", () => {
  it("APPLY_SUGGESTION_ADD 는 inbox 를 닫고 composing 을 반영 값으로 연다", () => {
    const actor = start();
    const suggestion: Suggestion = { id: 9, label: "add" };
    actor.send({ type: "OPEN_INBOX" });
    actor.send({
      type: "APPLY_SUGGESTION_ADD",
      suggestion,
      composerInitial: { query: "새 요청 게임" },
    });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe("composing");
    expect(snap.context.applying).toBe(suggestion);
    expect(snap.context.composerInitial).toEqual({ query: "새 요청 게임" });
  });

  it("반영-추가가 저장에 성공하면 applying 을 지우고 idle 로 돌아간다(호출자가 이 시점 이전 값을 읽어 처리 표시를 마무리한다)", () => {
    const actor = start();
    actor.send({ type: "OPEN_INBOX" });
    actor.send({
      type: "APPLY_SUGGESTION_ADD",
      suggestion: { id: 9, label: "add" },
      composerInitial: { query: "새 요청 게임" },
    });
    actor.send({ type: "GAME_ADDED", row: game(10), announcement: "새 요청 게임 추가됨" });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe("idle");
    expect(snap.context.applying).toBeNull();
    expect(snap.context.composerInitial).toBeUndefined();
  });

  /* 이 스펙이 이슈의 핵심 미결을 증명한다 — 반영-수정은 **detail 을 거치지 않고** 곧장 단독
     편집기로 간다. detailGame 이 null 로 남아야 한다(= 상세 다이얼로그가 안 뜬다는 뜻). */
  it("APPLY_SUGGESTION_EDIT 는 detail 을 열지 않고 applyingEditSuggestion 으로 곧장 간다", () => {
    const g = game(1);
    const actor = start([g]);
    const suggestion: Suggestion = { id: 10, label: "edit" };
    actor.send({ type: "OPEN_INBOX" });
    actor.send({ type: "APPLY_SUGGESTION_EDIT", suggestion, game: g });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe("applyingEditSuggestion");
    expect(snap.context.editingGame).toEqual(g);
    expect(snap.context.applying).toBe(suggestion);
    expect(snap.context.detailGame).toBeNull();
  });

  it("applyingEditSuggestion 에서 CANCEL_EDIT 은 editingGame·applying 을 지우고 idle 로 돌아간다", () => {
    const g = game(1);
    const actor = start([g]);
    actor.send({ type: "OPEN_INBOX" });
    actor.send({ type: "APPLY_SUGGESTION_EDIT", suggestion: { id: 10, label: "edit" }, game: g });
    actor.send({ type: "CANCEL_EDIT" });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe("idle");
    expect(snap.context.editingGame).toBeNull();
    expect(snap.context.applying).toBeNull();
  });

  it("applyingEditSuggestion 에서 GAME_UPDATED 는 games 를 갱신하고 idle 로 돌아간다 — detailGame 은 원래도 null 이라 안 건드린다", () => {
    const g = game(1, { lastPlayed: "2026-01-01" });
    const actor = start([g]);
    actor.send({ type: "OPEN_INBOX" });
    actor.send({ type: "APPLY_SUGGESTION_EDIT", suggestion: { id: 10, label: "edit" }, game: g });

    const updated = { ...g, lastPlayed: "2026-02-05" };
    actor.send({ type: "GAME_UPDATED", row: updated, announcement: "game1 수정됨" });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe("idle");
    expect(snap.context.games).toEqual([updated]);
    expect(snap.context.detailGame).toBeNull();
    expect(snap.context.editingGame).toBeNull();
    expect(snap.context.applying).toBeNull();
  });

  it("APPLY_SUGGESTION_NOT_FOUND 는 아무 오버레이도 안 열고 announcement 만 남긴다", () => {
    const actor = start();
    actor.send({ type: "OPEN_INBOX" });
    actor.send({
      type: "APPLY_SUGGESTION_NOT_FOUND",
      announcement: "그 게임이 보드에 없습니다 — 새로고침해 주십시오",
    });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe("idle");
    expect(snap.context.announcement).toBe("그 게임이 보드에 없습니다 — 새로고침해 주십시오");
    expect(snap.context.applying).toBeNull();
  });
});

describe("boardOverlayMachine — 전역 이벤트", () => {
  it("ANNOUNCE 는 어느 상태에서든 announcement 를 갱신한다", () => {
    const actor = start();
    actor.send({
      type: "ANNOUNCE",
      message: "저장했습니다 — 그 제안은 다른 관리자가 이미 처리했습니다",
    });
    expect(actor.getSnapshot().context.announcement).toBe(
      "저장했습니다 — 그 제안은 다른 관리자가 이미 처리했습니다",
    );
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("SUGGESTION_RESOLVED 는 pending 을 하나 줄이고 0 밑으로는 안 내려간다", () => {
    const actor = start([], 1);
    actor.send({ type: "SUGGESTION_RESOLVED" });
    expect(actor.getSnapshot().context.pending).toBe(0);
    actor.send({ type: "SUGGESTION_RESOLVED" });
    expect(actor.getSnapshot().context.pending).toBe(0);
  });
});
