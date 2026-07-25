/* 팬 제안 데이터 유즈케이스(ADR-0025). tRPC 무관 순수 db 연산 — games/service.ts 와 같은 결이라
   라우터·서버 컴포넌트가 함께 쓴다(제안 개수 배지는 RSC 가 직접 읽는다).

   **이 모듈은 게임을 안 바꾼다.** 제안은 쌓이기만 하고, 반영은 관리자가 기존 수정 폼으로 한다
   (features/games 의 updateGame). 그래서 여기엔 games 쓰기가 한 줄도 없다 — 승인 전용 쓰기 경로를
   만들면 CAS·여러 날 잠금·주 청구를 쥔 그 계약이 둘로 갈린다(ADR-0025 결정 2). */

import { and, desc, eq, sql } from "drizzle-orm";
import {
  isEmptyEditSuggestion,
  type SuggestedValues,
  type SuggestionKind,
  type SuggestionResolution,
  type SuggestionStatus,
} from "@/core/suggestions";
import { gameSuggestions, oauthAccounts, type Db, type GameSuggestionRow } from "@/db";
import { findGameCard } from "../games/service";
import type { CreateSuggestionInput } from "./schema";

/* 한 사람이 동시에 열어 둘 수 있는 제안 수. 게임당 1건은 부분 UNIQUE 인덱스가 이미 막으므로
   이 상한이 잡는 건 **여러 게임에 걸친 도배**다. 20 은 실제 팬이 한 번에 낼 제보보다 넉넉하고
   (보드가 아직 수십 장이다) 제안함 한 화면을 혼자 채우기엔 모자란 값이다. */
export const OPEN_SUGGESTION_LIMIT = 20;

/* 대상 게임이 없다. 라우터가 NOT_FOUND 로 올린다 — 폼이 보드의 카드에서 열리므로 정상 경로에선
   안 오고, 오는 길은 폼이 열린 사이 관리자가 그 게임을 지운 경우다. */
export class SuggestionGameNotFound extends Error {
  constructor() {
    super("suggestion target game does not exist");
    this.name = "SuggestionGameNotFound";
  }
}

/* 값도 지금과 같고 한마디도 없다. 라우터가 BAD_REQUEST 로 올린다 — 그 줄은 관리자가 읽을 것도
   반영할 것도 없는 순수한 소음이고, 게임당 사람당 하나뿐인 자리를 잡아먹는다. */
export class EmptySuggestion extends Error {
  constructor() {
    super("suggestion changes nothing and says nothing");
    this.name = "EmptySuggestion";
  }
}

/* 열어 둔 제안이 상한을 넘었다. 라우터가 TOO_MANY_REQUESTS 로 올린다. */
export class TooManyOpenSuggestions extends Error {
  constructor() {
    super("too many pending suggestions for this author");
    this.name = "TooManyOpenSuggestions";
  }
}

/* 제안 한 줄이 화면에 나갈 때의 모양. **대상 게임의 현재 값은 안 싣는다** — 제안함은 보드
   위에서 열리고 보드는 이미 카드 목록을 들고 있으므로, gameId 로 그쪽에서 찾으면 조인 없이
   같은 값을 얻는다(그리고 그 값이 화면에 보이는 것과 확실히 같아진다).

   authorName 은 oauth_accounts 의 표시명 스냅샷이다 — users 엔 표시명이 없다(제공자가 준 값이라
   그쪽이 제자리, db/schema 주석). nullable 인 이유는 그 컬럼 자체가 nullable 이라서다. */
export type SuggestionListItem = {
  id: number;
  kind: SuggestionKind;
  gameId: number | null;
  proposedTitle: string | null;
  proposed: SuggestedValues;
  note: string | null;
  authorName: string | null;
  createdAt: number;
};

// 내가 낸 제안엔 처리 상태가 붙는다 — 없으면 같은 제보를 반복하게 된다.
export type MySuggestionItem = SuggestionListItem & { status: SuggestionStatus };

/* 목록 셀렉트의 공통 모양. 두 조회(제안함·내 제안)가 같은 열을 보게 묶는다 — 갈리면 한쪽에만
   필드가 늘어난 걸 타입이 아니라 화면이 먼저 알려 준다. */
const listColumns = {
  id: gameSuggestions.id,
  kind: gameSuggestions.kind,
  gameId: gameSuggestions.gameId,
  proposedTitle: gameSuggestions.proposedTitle,
  proposed: {
    cleared: gameSuggestions.proposedCleared,
    clearedDate: gameSuggestions.proposedClearedDate,
    playedDate: gameSuggestions.proposedPlayedDate,
  },
  note: gameSuggestions.note,
  authorName: oauthAccounts.channelName,
  createdAt: gameSuggestions.createdAt,
};

/* 작성자 표시명 조인. provider 를 조건에 박는 이유: users → oauth_accounts 가 1:N 이라 로그인
   수단이 하나 더 붙는 날 한 제안이 여러 줄로 불어난다(그때 제안함이 같은 제보를 두 번 그린다). */
const authorJoin = and(
  eq(oauthAccounts.userId, gameSuggestions.authorUserId),
  eq(oauthAccounts.provider, "chzzk"),
);

/* 관리자 제안함 — 미처리만, 최신순. 처리된 제안은 안 싣는다: 목록의 용도가 "지금 볼 것"이고,
   이력 조회 화면은 v1 에 요구가 없다(필요해지면 status 필터를 여는 게 그때의 최소 변경이다). */
export function listPendingSuggestions(db: Db): Promise<SuggestionListItem[]> {
  return db
    .select(listColumns)
    .from(gameSuggestions)
    .leftJoin(oauthAccounts, authorJoin)
    .where(eq(gameSuggestions.status, "pending"))
    .orderBy(desc(gameSuggestions.createdAt));
}

// 제안함 버튼의 배지. 목록을 통째로 읽지 않고 세기만 한다 — 서버 컴포넌트가 첫 페인트에 쓴다.
export async function countPendingSuggestions(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(gameSuggestions)
    .where(eq(gameSuggestions.status, "pending"));
  return row?.count ?? 0;
}

/* 내가 낸 제안. 처리된 것도 함께 준다 — "반영됐는지"를 볼 수 없으면 같은 제보를 다시 낸다.
   남의 제안은 못 본다(작성자 필터가 곧 그 경계다): 제안은 공개물이 아니라 관리자에게 보내는
   말이고, 공개하면 부적절한 글이 그대로 방문자에게 닿는다. */
export function listMySuggestions(db: Db, authorUserId: number): Promise<MySuggestionItem[]> {
  return db
    .select({ ...listColumns, status: gameSuggestions.status })
    .from(gameSuggestions)
    .leftJoin(oauthAccounts, authorJoin)
    .where(eq(gameSuggestions.authorUserId, authorUserId))
    .orderBy(desc(gameSuggestions.createdAt));
}

/* 제안 접수. 검사 셋을 통과해야 저장된다: 도배 상한 · 대상 존재 · 빈 제안.

   ── 알고 수용한 한계: 상한 검사와 insert 사이 gap ────────────────────────────────
   세기와 쓰기가 별개 왕복이라(D1 엔 대화형 트랜잭션이 없다 — AGENTS.md) 같은 사람이 두 탭에서
   동시에 보내면 상한을 한두 건 넘길 수 있다. 막으려면 조건부 INSERT 가 필요한데 D1 의 batch 는
   앞 문의 rowcount 로 뒤 문을 건너뛰지 못한다(saveWeek 이 만난 그 벽). 넘쳐도 결과는 제안함에
   줄이 몇 개 더 서는 것뿐이고 관리자가 거절하면 끝이라, 여기선 그 gap 을 받는다. */
export async function createSuggestion(
  db: Db,
  authorUserId: number,
  input: CreateSuggestionInput,
): Promise<GameSuggestionRow> {
  const [open] = await db
    .select({ count: sql<number>`count(*)` })
    .from(gameSuggestions)
    .where(
      and(eq(gameSuggestions.authorUserId, authorUserId), eq(gameSuggestions.status, "pending")),
    );
  if ((open?.count ?? 0) >= OPEN_SUGGESTION_LIMIT) throw new TooManyOpenSuggestions();

  const proposed: SuggestedValues = {
    cleared: input.cleared,
    clearedDate: input.clearedDate,
    playedDate: input.playedDate,
  };

  if (input.kind === "edit") {
    /* 지금 보드에 있는 값을 games 쪽 유도로 읽는다(findGameCard) — 발행 경계를 그쪽과 공유해야
       "제안함은 안 바뀐다는데 보드는 다른 날짜를 그리는" 상태가 안 생긴다. */
    const card = await findGameCard(db, input.gameId);
    if (!card) throw new SuggestionGameNotFound();
    const current = {
      cleared: card.cleared,
      clearedDate: card.clearedDate,
      lastPlayed: card.lastPlayed,
    };
    if (isEmptyEditSuggestion(current, proposed, input.note)) throw new EmptySuggestion();
  }

  const [row] = await db
    .insert(gameSuggestions)
    .values({
      kind: input.kind,
      // 종류마다 채워지는 자리가 갈린다(shape CHECK) — 반대쪽은 반드시 null 이어야 한다.
      gameId: input.kind === "edit" ? input.gameId : null,
      proposedTitle: input.kind === "add" ? input.title : null,
      authorUserId,
      proposedCleared: proposed.cleared,
      proposedClearedDate: proposed.clearedDate,
      proposedPlayedDate: proposed.playedDate,
      note: input.note,
    })
    .returning();
  return row!;
}

/* 처리(반영함·거절함) 표시. **미처리인 것만 고친다** — 조건이 곧 CAS 다: 제안함을 열어 둔 사이
   다른 관리자가 같은 줄을 먼저 처리했으면 0행이 돌아온다.

   그때 오류를 던지지 않고 resolved:false 로 두는 건 removeGame 과 같은 멱등성 판단이다. 목표
   상태(그 제안은 이제 목록에 없다)가 이미 달성됐고, 사용자가 손쓸 수 없는 오류를 띄울 자리가
   아니다. 처리 시각·처리자를 status 와 **한 문**에 쓰는 이유는 resolution CHECK 다 — 나눠 쓰면
   중간 상태가 CHECK 를 깬다. */
export async function resolveSuggestion(
  db: Db,
  input: { id: number; resolution: SuggestionResolution; resolvedByUserId: number },
): Promise<{ resolved: boolean }> {
  const rows = await db
    .update(gameSuggestions)
    .set({
      status: input.resolution,
      resolvedAt: Date.now(),
      resolvedByUserId: input.resolvedByUserId,
    })
    .where(and(eq(gameSuggestions.id, input.id), eq(gameSuggestions.status, "pending")))
    .returning({ id: gameSuggestions.id });
  return { resolved: rows.length > 0 };
}
