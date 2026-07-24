/* 게임 보드 데이터 유즈케이스. tRPC 무관(순수 db 연산)이라 라우터·서버 컴포넌트·seed 가
   재사용한다 — 공개 읽기(RSC)는 tRPC HTTP 를 왕복하지 않고 listGames 를 직접 부른다. */

import { asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { isPlayDateEditable } from "@/core/games";
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

/* 여러 날 편성된 게임의 플레이 날짜를 게임 폼이 바꾸려 했다. 라우터가 BAD_REQUEST 로 올린다.
   서비스는 tRPC 무관이라 도메인 오류로 던진다(schedule/service 의 두 오류와 같은 결).
   폼도 같은 판정으로 입력을 잠그지만(core.isPlayDateEditable), 잠금은 편의고 진짜 방어선은
   여기다 — 위조 클라이언트가 곧장 뮤테이션을 부르면 나머지 날이 조용히 남는다(불변식 3). */
export class MultiDayScheduleLocked extends Error {
  constructor() {
    super("play date is scheduled across multiple days");
    this.name = "MultiDayScheduleLocked";
  }
}

/* 이 게임에 걸린 일정 항목 — **발행 경계를 걸지 않는다.** lastPlayedExpr 와 일부러 다르다:
   보드는 발행된 항목만 그리지만, "폼이 이 게임의 날짜를 고칠 수 있나"는 초안 주의 항목까지
   세야 한다. 안 세면 초안에 항목이 둘 있는 게임을 폼이 "0개"로 보고 새로 만들어, 그 주를
   발행하는 순간 날짜가 셋이 된다(폼은 하나만 만든 줄 안다).

   그래서 이 값은 **공개 목록에 안 싣는다** — 초안 주의 날짜가 새어나가면 "미완성 주간표가
   먼저 공개되지 않는다"(이슈 #56 결정 13)를 목록이 우회한다. 읽는 자리는 game:write 를 요구하는
   프로시저 하나뿐이다(router.playDates). */
/* async 가 아니다 — 쿼리 빌더를 그대로 돌려줘야 updateGame 이 이걸 **batch 에 넣어** 게임 존재
   확인과 한 왕복으로 묶는다(async 면 Promise 라 batch 가 못 받는다). 빌더는 thenable 이라
   호출부에서 그냥 await 해도 된다. */
export function playEntriesOf(db: Db, gameId: number) {
  return db
    .select({ id: scheduleEntries.id, scheduledDate: scheduleEntries.scheduledDate })
    .from(scheduleEntries)
    .where(eq(scheduleEntries.gameId, gameId))
    .orderBy(asc(scheduleEntries.scheduledDate));
}

/* 추가 — category 스냅샷을 denormalize 저장하고, 날짜를 받았으면 그 날의 일정 항목까지
   **한 batch(원자)** 로 만든다. 둘을 따로 쓰면 항목만 실패했을 때 "게임은 올라갔는데 날짜가
   없는" 절반 상태가 남고, 관리자는 성공/실패 중 뭘 본 건지 모른다.

   game_id 를 last_insert_rowid() 로 받는 게 이 batch 의 핵심이다 — D1 엔 대화형 트랜잭션이
   없어 앞 문의 RETURNING 을 뒤 문이 못 읽는다(AGENTS.md 지뢰). SQLite 함수라 **같은 batch 안
   순차 실행**에 기대는데, 그게 실제로 성립하는지는 추측이 아니라 실측했다(2026-07-24, workerd
   +Miniflare D1: game.id=1 → entry.game_id=1). **이 가정이 깨지면 항목이 엉뚱한 게임에 붙는
   조용한 오염이라** 타입도 게이트도 못 잡는다 — router.test.ts 의 "방금 넣은 게임에 붙는다"가
   그 회귀를 못박는 유일한 자리다.

   항목의 title 은 게임 제목을 그대로 쓴다(schedule_entries.title 은 NOT NULL). start_time 은
   null — 폼이 시각을 안 받는다(시각·제목을 손보려면 /schedule 로 간다).

   주 메타(schedule_weeks)는 **만들지도 바꾸지도 않는다.** 메타가 없는 주는 "부재 = 표시"라
   (ADR-0022 레거시 규칙) 항목이 곧바로 보드에 뜨고, 이미 초안인 주라면 안 뜨는 게 맞다 —
   관리자가 그 주를 초안으로 두기로 한 결정을 게임 폼이 뒤집으면 결정 13 이 깨진다.

   categoryId 가 null 이면 수동 입력 게임이다. category_id UNIQUE 위반은 라우터가 CONFLICT 로
   맵하고, NULL 은 SQLite 에서 중복이 허용되므로 수동 입력끼리는 충돌하지 않는다. */
export async function addGame(db: Db, input: AddGameInput): Promise<GameCard> {
  const insertGame = db
    .insert(games)
    .values({
      categoryId: input.categoryId,
      categoryType: input.categoryType,
      categoryValue: input.categoryValue,
      posterImageUrl: input.posterImageUrl,
    })
    .returning();

  if (input.playedDate === null) {
    const [row] = await insertGame;
    // 날짜를 안 받았으면 항목도 없으므로 lastPlayed 는 확정적으로 null — 되유도 조회를 아낀다.
    return { ...row!, lastPlayed: null };
  }

  const insertEntry = db.insert(scheduleEntries).values({
    scheduledDate: input.playedDate,
    startTime: null,
    title: input.categoryValue,
    gameId: sql<number>`last_insert_rowid()`,
  });
  const [rows] = await db.batch([insertGame, insertEntry]);
  /* 되유도해서 돌려준다 — 방금 만든 항목이 보드 날짜에 기여하는지는 그 주의 발행 상태가
     정하므로(초안 주면 lastPlayed 는 null 이다) 입력 날짜를 그대로 믿으면 안 된다. */
  return gameCard(db, rows[0]!);
}

/* 수정 — 클리어 상태와 플레이 날짜를 **한 batch(원자)** 로 쓴다. 따로 쓰면 "클리어는 저장됐는데
   날짜는 안 된" 절반 상태가 남는다(사용자 요청으로 묶었다).

   일정 항목 조작은 현재 항목 수로 갈린다(core.isPlayDateEditable):
     0개 + 날짜 → INSERT      1개 + 날짜 → 그 항목 UPDATE(시각·제목 보존)
     1개 + null → DELETE      0개 + null → 항목 연산 없음
   1개일 때 지우고 새로 넣지 않고 UPDATE 하는 이유는 그 항목의 start_time·title 을 지키려는
   것이다 — /schedule 에서 "20:00 젤다 2회차"로 짜 둔 걸 게임 폼이 날짜만 옮기려다 지운다.

   **여러 날 편성이면 변경을 거절한다.** 폼이 잠근 상태에서 오는 정상 저장(클리어만 고침)은
   기존 날짜 중 하나를 그대로 되보내므로 통과하고, 실제로 바꾸려는 값이면 막힌다. null 도
   막는다 — 여러 날을 한 입력으로 지우는 건 폼이 표현하지 못한 의도다.

   ── 알고 수용한 한계: 읽기~batch 사이 gap ────────────────────────────────────────
   항목 조회와 batch 는 별개 왕복이라(D1 엔 대화형 트랜잭션이 없다) 그 사이 다른 관리자가
   /schedule 에서 같은 게임의 항목을 더하면, 여기선 "0개"로 본 판단이 낡는다 — 결과는 항목이
   하나 늘어나는 것뿐이고(오염이 아니라 중복) /schedule 에서 지우면 된다. saveWeek 이 revision
   CAS 로 닫은 것과 달리 여기엔 CAS 를 안 건다: 게임 폼의 날짜는 주 전체가 아니라 항목 하나를
   건드리고, 관리자 소수·주간 편성이라 겹칠 창이 실질적으로 없다(AGENTS.md 의 D1 수용 경계). */
export async function updateGame(db: Db, input: UpdateGameInput): Promise<GameCard | null> {
  /* 게임 존재 확인과 항목 조회를 한 왕복으로 묶는다. 존재 확인이 먼저 필요한 이유: 없는 id 면
     NOT_FOUND 여야 하는데, 확인 없이 batch 를 날리면 항목 INSERT 가 FK 로 죽어 전체가 롤백된
     뒤 "왜 실패했는지" 알 수 없는 오류로 올라간다. */
  const [rows, entries] = await db.batch([
    db.select().from(games).where(eq(games.id, input.id)),
    playEntriesOf(db, input.id),
  ]);
  if (!rows[0]) return null;

  const editable = isPlayDateEditable(entries.map((e) => e.scheduledDate));
  if (!editable) {
    const unchanged =
      input.playedDate !== null && entries.some((e) => e.scheduledDate === input.playedDate);
    if (!unchanged) throw new MultiDayScheduleLocked();
  }

  const updateRow = db
    .update(games)
    .set({ cleared: input.cleared, clearedDate: input.clearedDate })
    .where(eq(games.id, input.id))
    .returning();

  /* 여러 날 편성이면 항목을 **아예 안 건드린다**(위 검사를 통과했다 = 날짜를 안 바꾸겠다는
     저장이다). 여기서 entries[0] 를 UPDATE 하면 "클리어만 고치는" 저장이 가장 이른 날의
     항목을 조용히 다른 날로 옮긴다 — 거절 검사를 통과한 요청이 데이터를 바꾸는 자리라
     특히 조용하다. */
  const current = editable ? entries[0] : null;
  const entryOp = !editable
    ? null
    : input.playedDate === null
      ? current
        ? db.delete(scheduleEntries).where(eq(scheduleEntries.id, current.id))
        : null
      : current
        ? db
            .update(scheduleEntries)
            .set({ scheduledDate: input.playedDate })
            .where(eq(scheduleEntries.id, current.id))
        : db.insert(scheduleEntries).values({
            scheduledDate: input.playedDate,
            startTime: null,
            title: rows[0].categoryValue,
            gameId: input.id,
          });

  const [updated] = entryOp ? await db.batch([updateRow, entryOp]) : await db.batch([updateRow]);
  return updated[0] ? gameCard(db, updated[0]) : null;
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
