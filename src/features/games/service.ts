/* 게임 보드 데이터 유즈케이스. tRPC 무관(순수 db 연산)이라 라우터·서버 컴포넌트·seed 가
   재사용한다 — 공개 읽기(RSC)는 tRPC HTTP 를 왕복하지 않고 listGames 를 직접 부른다. */

import { desc, eq, sql } from "drizzle-orm";
import { games, type Db, type GameRow } from "@/db";
import type { AddGameInput, UpdateGameInput } from "./schema";

/* 공개 읽기. 보드는 "언제 플레이했나" 순이다 — 최근 플레이가 위로 온다.
   played_at 이 null 인 행(아직 안 한 게임)은 시간축 위에 자리가 없으므로 뒤로 몰고, 그
   안에서만 추가 순(createdAt 내림차순)으로 정렬한다. SQLite 의 기본 NULLS FIRST 를 그대로
   두면 날짜 없는 카드가 최신 플레이 위에 얹히므로 (played_at IS NULL) 키를 먼저 세운다
   — 정수 0/1 이라 false(=날짜 있음)가 먼저다. 정렬 인덱스는 검색 이슈로 미룸(ADR-0014). */
export function listGames(db: Db): Promise<GameRow[]> {
  return db
    .select()
    .from(games)
    .orderBy(sql`${games.playedAt} IS NULL`, desc(games.playedAt), desc(games.createdAt));
}

/* 추가 — category 스냅샷을 denormalize 저장. categoryId 가 null 이면 수동 입력 게임이다
   (치지직 검색에 없는 게임). category_id UNIQUE 위반은 라우터가 CONFLICT 로 맵하고, NULL
   은 SQLite 에서 중복이 허용되므로 수동 입력끼리는 충돌하지 않는다. */
export async function addGame(db: Db, input: AddGameInput): Promise<GameRow> {
  const [row] = await db
    .insert(games)
    .values({
      categoryId: input.categoryId,
      categoryType: input.categoryType,
      categoryValue: input.categoryValue,
      posterImageUrl: input.posterImageUrl,
      playedAt: input.playedAt,
      clearedAt: input.clearedAt,
    })
    .returning();
  return row!;
}

/* 날짜 수정. 없는 id 는 null 을 돌려준다 — remove 와 달리 라우터가 NOT_FOUND 로 올린다:
   삭제는 "이미 없으면 목적 달성"이라 멱등하지만, 수정은 대상이 없으면 요청이 무시된 것이
   조용히 성공으로 보여선 안 된다. */
export async function updateGame(db: Db, input: UpdateGameInput): Promise<GameRow | null> {
  const [row] = await db
    .update(games)
    .set({ playedAt: input.playedAt, clearedAt: input.clearedAt })
    .where(eq(games.id, input.id))
    .returning();
  return row ?? null;
}

/* 하드 삭제(ADR-0014, deleted_at 없음). 없는 id 삭제는 오류가 아니라 deleted:false —
   클라이언트 지연 커밋이 늦게 도착해도 안전하고, 되돌리기는 서버 상태 없이 클라이언트가 쥔다. */
export async function removeGame(db: Db, id: number): Promise<{ deleted: boolean }> {
  const rows = await db.delete(games).where(eq(games.id, id)).returning({ id: games.id });
  return { deleted: rows.length > 0 };
}
