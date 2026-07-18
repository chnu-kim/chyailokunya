/* 게임 보드 데이터 유즈케이스. tRPC 무관(순수 db 연산)이라 라우터·서버 컴포넌트·seed 가
   재사용한다 — 공개 읽기(RSC)는 tRPC HTTP 를 왕복하지 않고 listGames 를 직접 부른다. */

import { desc, eq } from "drizzle-orm";
import { games, type Db, type GameRow } from "@/db";
import type { AddGameInput } from "./schema";

// 공개 읽기. 최신 추가가 위로(구 보드의 prepend 동작). 정렬 인덱스는 검색 이슈로 미룸(ADR-0014).
export function listGames(db: Db): Promise<GameRow[]> {
  return db.select().from(games).orderBy(desc(games.createdAt));
}

// 추가 — category 스냅샷을 denormalize 저장. category_id UNIQUE 위반은 라우터가 CONFLICT 로 맵.
export async function addGame(db: Db, input: AddGameInput): Promise<GameRow> {
  const [row] = await db
    .insert(games)
    .values({
      categoryId: input.categoryId,
      categoryType: input.categoryType,
      categoryValue: input.categoryValue,
      posterImageUrl: input.posterImageUrl,
      status: input.status,
      playedAt: input.playedAt,
      clearedAt: input.clearedAt,
    })
    .returning();
  return row!;
}

/* 하드 삭제(ADR-0014, deleted_at 없음). 없는 id 삭제는 오류가 아니라 deleted:false —
   클라이언트 지연 커밋이 늦게 도착해도 안전하고, 되돌리기는 서버 상태 없이 클라이언트가 쥔다. */
export async function removeGame(db: Db, id: number): Promise<{ deleted: boolean }> {
  const rows = await db.delete(games).where(eq(games.id, id)).returning({ id: games.id });
  return { deleted: rows.length > 0 };
}
