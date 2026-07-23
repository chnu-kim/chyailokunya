/* 게임 보드 데이터 유즈케이스. tRPC 무관(순수 db 연산)이라 라우터·서버 컴포넌트·seed 가
   재사용한다 — 공개 읽기(RSC)는 tRPC HTTP 를 왕복하지 않고 listGames 를 직접 부른다. */

import { asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { games, scheduleEntries, scheduleWeeks, type Db, type GameRow } from "@/db";
import type { AddGameInput, UpdateGameInput } from "./schema";

/* 보드가 그리는 한 장. games 행 + 유도된 lastPlayed 다 — 플레이 날짜의 정본이 이제 게임
   컬럼이 아니라 일정(schedule_entries)이라, 보드는 그 게임에 걸린 항목들의 MAX(scheduled_date)
   로 "언제 플레이했나"를 되유도한다(이슈 #56 결정 3·17). lastPlayed 가 null 이면 아직 그 게임의
   (보드에 셀) 일정 항목이 없다(=안 한 게임, 또는 아직 초안이라 안 뜬 편성). */
export type GameCard = GameRow & { lastPlayed: string | null };

/* 항목이 속한 주의 월요일. schedule_weeks 는 week_start_date(월요일)로 키가 잡히므로, 항목의
   scheduled_date 로부터 그 주의 월요일을 유도해야 메타 행에 조인된다(core/calendar.weekStartOf
   의 SQL 짝). strftime('%w') 는 일=0‥토=6 이라 (dow+6)%7 일을 빼면 월요일이 나온다. */
const entryWeekStart = sql`date(${scheduleEntries.scheduledDate}, '-' || ((strftime('%w', ${scheduleEntries.scheduledDate}) + 6) % 7) || ' days')`;

/* 유도된 플레이 날짜 = **발행 경계를 통과한** 항목들의 MAX(scheduled_date)다(ADR-0022). 항목이
   보드 날짜에 기여하려면 그 주가 발행됐거나(published_at NOT NULL) 아예 주 메타가 없어야 한다
   (week_start_date IS NULL = 이관된 과거 아카이브 · 직접 넣은 테스트 데이터). 미발행 초안 주는
   메타 행이 있고 published_at 이 NULL 이라 CASE 가 NULL 을 내 빠진다 — 관리자가 짜는 중인 다음
   주 편성의 게임이 보드에 미래 날짜로 새는 걸 여기서 막는다(이슈 #56 "놓치면 늦게 터지는 자리 1").
   같은 SQL 을 select·orderBy·단건 유도가 공유해 세 자리의 경계가 갈리지 않게 한다. */
const lastPlayedExpr = sql<
  string | null
>`max(case when ${scheduleWeeks.weekStartDate} is null or ${scheduleWeeks.publishedAt} is not null then ${scheduleEntries.scheduledDate} end)`;

/* 공개 읽기. 보드는 "언제 플레이했나" 순이다 — 최근 플레이가 위로 온다. 일정 항목이 없는
   게임(lastPlayed null)은 시간축 위에 자리가 없으므로 뒤로 몰고, 그 안에서만 추가 순
   (created_at 내림차순)으로 정렬한다.

   정렬 키가 셋인 이유: 첫 키 (lastPlayed IS NULL) 은 **날짜 있음/없음 두 덩이를 가르는 것만**
   한다(0/1 ASC 라 날짜 있는 쪽이 먼저). 그래야 셋째 키의 의미가 성립한다 — null 덩이 안에서는
   둘째 키가 전부 NULL 이라 무의미해지고 created_at DESC 만 남는다. 구조는 played_at 컬럼 시절과
   같다(결정 17, 시각 회귀 위험 0) — 정렬 인덱스는 검색 이슈로 미룸(ADR-0014).

   schedule_weeks 를 LEFT JOIN 하는 이유가 발행 경계다(lastPlayedExpr 주석·ADR-0022): 항목의
   주(월요일)에 메타 행을 이어 붙여, 그 주가 발행됐는지로 항목을 보드에 셀지 가른다. LEFT 라
   메타 없는 항목(레거시 아카이브)은 그대로 남아 손실이 없다(결정 16). */
export function listGames(db: Db): Promise<GameCard[]> {
  return db
    .select({ ...getTableColumns(games), lastPlayed: lastPlayedExpr })
    .from(games)
    .leftJoin(scheduleEntries, eq(scheduleEntries.gameId, games.id))
    .leftJoin(scheduleWeeks, eq(scheduleWeeks.weekStartDate, entryWeekStart))
    .groupBy(games.id)
    .orderBy(sql`${lastPlayedExpr} IS NULL`, desc(lastPlayedExpr), desc(games.createdAt));
}

/* 일정 편집기가 항목에 게임을 이어 붙일 때 고를 후보(이슈 #56 결정 11). 보드에 이미 있는
   게임만 준다 — 항목의 game_id 는 games.id FK 라, 없는 게임을 가리키면 저장이 롤백된다.
   유도 조인이 필요 없어 listGames 보다 가볍고(이름·표지만), 이름순이라 편집기 검색이 사전순으로
   좁혀진다. 표지·이름은 편집기·읽기 화면이 game_id 로 다시 그리는 데 쓴다(항목엔 표지가 없다). */
export type GameOption = Pick<GameRow, "id" | "categoryValue" | "posterImageUrl">;

export function listGameOptions(db: Db): Promise<GameOption[]> {
  return db
    .select({
      id: games.id,
      categoryValue: games.categoryValue,
      posterImageUrl: games.posterImageUrl,
    })
    .from(games)
    .orderBy(asc(games.categoryValue));
}

// 한 게임의 유도 카드(쓰기 응답용). 방금 바뀐 행 + 그 게임의 lastPlayed 를 되유도해 돌려준다 —
// 보드가 낙관적 갱신 때 날짜줄을 잃지 않게(클리어만 고쳐도 일정에서 온 날짜는 그대로여야 한다).
// 발행 경계는 listGames 와 같은 조인·CASE 로 건다(단건이라도 규칙이 갈리면 안 된다).
async function gameCard(db: Db, row: GameRow): Promise<GameCard> {
  const [agg] = await db
    .select({ lastPlayed: lastPlayedExpr })
    .from(scheduleEntries)
    .leftJoin(scheduleWeeks, eq(scheduleWeeks.weekStartDate, entryWeekStart))
    .where(eq(scheduleEntries.gameId, row.id));
  return { ...row, lastPlayed: agg?.lastPlayed ?? null };
}

/* 추가 — category 스냅샷을 denormalize 저장. 새 게임은 안 깬 채·일정 없음으로 시작한다
   (cleared 기본 false, lastPlayed null). 플레이 날짜·클리어는 추가 뒤에 붙는다(일정·편집).
   categoryId 가 null 이면 수동 입력 게임이다. category_id UNIQUE 위반은 라우터가 CONFLICT 로
   맵하고, NULL 은 SQLite 에서 중복이 허용되므로 수동 입력끼리는 충돌하지 않는다. */
export async function addGame(db: Db, input: AddGameInput): Promise<GameCard> {
  const [row] = await db
    .insert(games)
    .values({
      categoryId: input.categoryId,
      categoryType: input.categoryType,
      categoryValue: input.categoryValue,
      posterImageUrl: input.posterImageUrl,
    })
    .returning();
  // 방금 넣은 게임엔 일정 항목이 없으므로 lastPlayed 는 확정적으로 null — 조회를 아낀다.
  return { ...row!, lastPlayed: null };
}

/* 클리어 상태 수정. 없는 id 는 null 을 돌려준다 — remove 와 달리 라우터가 NOT_FOUND 로 올린다:
   삭제는 "이미 없으면 목적 달성"이라 멱등하지만, 수정은 대상이 없으면 요청이 무시된 것이
   조용히 성공으로 보여선 안 된다. cleared·clearedDate 는 함께 치환한다(부분 patch 아님). */
export async function updateGame(db: Db, input: UpdateGameInput): Promise<GameCard | null> {
  const [row] = await db
    .update(games)
    .set({ cleared: input.cleared, clearedDate: input.clearedDate })
    .where(eq(games.id, input.id))
    .returning();
  return row ? gameCard(db, row) : null;
}

/* 하드 삭제(ADR-0014 의 결론, 근거는 ADR-0020 — 확인이 파괴 전에 오므로 되돌릴 대상이 없다).
   없는 id 삭제를 오류가 아니라 deleted:false 로 두는 건 멱등성 때문이다: 확인 모달이 열려 있는
   사이 다른 탭·다른 관리자가 같은 카드를 먼저 지웠을 수 있고, 그땐 목표 상태가 이미 달성된
   것이라 사용자가 손쓸 수 없는 오류를 띄우면 안 된다(라우터가 이 값을 그대로 성공 페이로드로
   흘려보내는 이유다). 게임을 지워도 그 게임에 걸렸던 일정 항목은 game_id 가 SET NULL 로 풀려
   "그날 방송이 있었다"는 사실로 남는다(schedule_entries FK). */
export async function removeGame(db: Db, id: number): Promise<{ deleted: boolean }> {
  const rows = await db.delete(games).where(eq(games.id, id)).returning({ id: games.id });
  return { deleted: rows.length > 0 };
}
