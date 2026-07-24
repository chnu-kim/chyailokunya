/* 게임 보드 데이터 유즈케이스. tRPC 무관(순수 db 연산)이라 라우터·서버 컴포넌트·seed 가
   재사용한다 — 공개 읽기(RSC)는 tRPC HTTP 를 왕복하지 않고 listGames 를 직접 부른다. */

import { asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { toIsoDate, weekStartOf } from "@/core/calendar";
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

/* 폼이 열린 뒤 그 게임의 일정 날짜가 딴 데서 바뀌었다. 라우터가 CONFLICT 로 올린다.
   덮어쓰지 않고 거절하는 게 핵심이다 — 그냥 쓰면 남의 일정 작업이 조용히 되돌아간다
   (적대적 리뷰 6라운드). saveWeek 의 revision CONFLICT 와 같은 처방: 새로고침해서 지금 값
   위에서 다시 편집하게 한다. */
export class PlayDateChangedElsewhere extends Error {
  constructor() {
    super("play date changed after the form was opened");
    this.name = "PlayDateChangedElsewhere";
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

/* 게임 폼이 일정 항목을 건드린 주를 **청구(claim)한다.** 하는 일이 둘이다:

   1. 메타가 있으면 revision(last_updated_at)만 단조 증가시킨다. published_at 은 안 건드린다 —
      초안으로 두기로 한 결정을 게임 폼이 뒤집으면 안 된다(결정 13).
   2. 메타가 없으면 **발행된 채로 만든다.**

   왜 청구하나: saveWeek 은 그 주를 통째로 교체하면서 revision CAS 로 "그 사이 바뀌었으면 거절"을
   보장한다. 게임 폼이 그 계약 밖에서 항목을 쓰면 열어 둔 편집기가 stale 인 채 CAS 를 통과해
   방금 만든 항목을 **조용히 지운다**(적대적 리뷰 3·8라운드). 메타가 없으면 올릴 revision 자체가
   없으므로, 행을 만들어 두는 게 그 구멍을 닫는 유일한 길이다 — 편집기의 null 청구가
   onConflictDoNothing 으로 0행이 돼 CONFLICT 로 걸린다.

   ── published_at 을 채우는 이유, 그리고 그 대가 ──────────────────────────────────
   뿌리는 비대칭이다: 메타 부재를 게임 보드(lastPlayedExpr)는 "표시"로, 공개 /schedule
   (getPublishedWeek)은 "비공개"로 읽는다. 행을 만드는 순간 둘 중 하나가 깨진다. NULL 로 만들면
   그 주가 초안으로 뒤집혀 **방금 넣은 날짜가 보드에서 사라지고**, 채우면 그 주가 /schedule 에
   뜬다.

   채우는 쪽을 골랐다(2026-07-24 사용자 결정, 8라운드에 재확인). 근거 둘:
   - **saveWeek 도 같은 일을 한다.** 관리자가 /schedule 에서 레거시 주(메타 없음)를 저장하면
     published 메타가 생겨 그 주가 공개된다(편집기 기본값 = 발행). 게임 폼만 다른 규칙을 쓸
     이유가 약하다.
   - 공개되는 항목은 **이미 게임 보드에 떠 있던 것**이다(메타 부재 = 표시). 새 정보가 새는 게
     아니라 같은 사실이 한 화면 더 보이는 것이고, 반대쪽 대가는 **관리자가 넣은 날짜가 신호 없이
     사라지는 것**이다. 무게가 다르다.

   대가는 안다: 미래 날짜를 넣으면 아직 안 짠 주가 "빈 주간표 + 게임 하나"로 뜬다. 초안 주
   (메타 있고 published_at NULL)는 여기서 안 건드리므로 결정 13 의 핵심 — 관리자가 짜는 중인
   편성이 먼저 새지 않는다 — 은 그대로다. 둘을 완전히 가르려면 보드 표시와 공개 발행을 나누는
   표식 컬럼이 필요한데, 마이그레이션이라 두 번째 요구가 설 때 JIT 로 연다(ADR-0010).

   revision 은 nextRevision 과 같은 규칙으로 단조 증가시킨다 — 같은 ms 안에 두 번 쓰면
   now 가 기존 값과 같아 revision 이 안 바뀌고, 그럼 CAS 가 통과해 보호가 도로 뚫린다. */
function claimWeek(db: Db, date: string, now: number) {
  const weekStart = weekStartOf(toIsoDate(date));
  return db
    .insert(scheduleWeeks)
    .values({ weekStartDate: weekStart, publishedAt: now, lastUpdatedAt: now })
    .onConflictDoUpdate({
      target: scheduleWeeks.weekStartDate,
      set: { lastUpdatedAt: sql`max(${scheduleWeeks.lastUpdatedAt} + 1, ${now})` },
    });
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

   그 주의 메타는 claimWeek 이 청구한다(같은 batch 안) — 편집기의 revision CAS 가 이 쓰기를
   보게 하려면 필요하다. 초안 주의 발행 상태는 그대로 둔다(claimWeek 주석).

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
  /* **순서가 계약이다: claimWeek 은 반드시 insertEntry 뒤에 온다.** 지금은 UPDATE 라
     last_insert_rowid() 를 안 건드리지만, 언젠가 이 함수가 다시 INSERT 를 하게 되면 앞에 둔
     순간 last_insert_rowid() 가 schedule_weeks 의 id 를 가리켜 항목이 엉뚱한 게임에 붙는다 —
     바로 위 주석이 말한 그 조용한 오염이다. 순서로 미리 막아 둔다. */
  const [rows] = await db.batch([
    insertGame,
    insertEntry,
    claimWeek(db, input.playedDate, Date.now()),
  ]);
  /* 되유도해서 돌려준다 — 방금 만든 항목이 보드 날짜에 기여하는지는 그 주의 발행 상태가
     정하므로(초안 주면 lastPlayed 는 null 이다) 입력 날짜를 그대로 믿으면 안 된다. */
  return gameCard(db, rows[0]!);
}

/* 수정 — 클리어 상태와 플레이 날짜를 **한 batch(원자)** 로 쓴다. 따로 쓰면 "클리어는 저장됐는데
   날짜는 안 된" 절반 상태가 남는다(사용자 요청으로 묶었다).

   **playedDate 필드가 아예 없으면 일정을 안 건드린다** — 클리어만 고치는 저장이다. 여러 날
   편성이라 폼이 날짜를 잠근 경우가 이 길로 온다(schema 의 playDateInput 주석에 있는 회귀:
   초판은 "안 바꾸려면 기존 날짜를 되보내라"였는데 잠긴 폼엔 되보낼 값이 하나로 안 정해져
   빈 값이 나갔고, 그게 삭제 시도로 거절돼 **클리어 수정 자체가 막혔다**).

   필드가 있으면 현재 항목 수로 갈린다(core.isPlayDateEditable):
     0개 + 날짜 → INSERT      1개 + 날짜 → 그 항목 UPDATE(시각·제목 보존)
     1개 + null → **연결 해제**(gameId=null, 행은 남는다)   0개 + null → 항목 연산 없음
   두 경우 모두 행을 안 지우는 이유는 같다: 그 행은 "그날 방송이 있었다"는 정본 사실이고
   /schedule 이 쥔 start_time·자유 title 을 담을 수 있다 — 게임 폼이 만든 행인지 일정에서 짠
   행인지 구분할 표식이 없어 지우면 어느 쪽이든 날아간다(적대적 리뷰가 잡은 자리).

   대가는 안다: 비웠다가 다시 넣으면 옛 행이 연결 없이 남고 새 행이 선다(찌꺼기 한 줄).
   그래도 소실보다 낫고 **조용하지 않다** — 그 행은 /schedule 에 그대로 보여 지울 수 있다.
   표식 컬럼(provenance)을 더해 "폼이 만든 행만 지운다"로 갈 수도 있지만, 두 번째 요구가
   실제로 설 때 JIT 로 연다(ADR-0010).

   **여러 날 편성인데 필드가 실려 오면 거절한다.** 날짜든 null 이든 마찬가지다 — 여러 날을
   입력 하나로 옮기거나 지우는 건 폼이 표현하지 못한 의도라, 위조 클라이언트가 곧장 부르면
   나머지 날이 조용히 남거나 통째로 사라진다(불변식 3).

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

  /* 필드 부재 = 일정을 안 건드린다. 여러 날 검사보다 **먼저** 본다 — 잠긴 폼의 정상 저장이
     여기서 빠져나가야 클리어 수정이 막히지 않는다. */
  const touchesSchedule = input.playedDate !== undefined;
  if (touchesSchedule && !isPlayDateEditable(entries.map((e) => e.scheduledDate))) {
    throw new MultiDayScheduleLocked();
  }

  /* 낙관적 동시성: 폼이 열릴 때 읽은 날짜(playedDateWas)가 지금 값과 같아야 쓴다. 다르면 그
     사이 다른 관리자가 /schedule 에서 옮긴 것이라, 그대로 쓰면 **남의 일정 작업이 조용히
     되돌아간다**(적대적 리뷰 6라운드). 폼도 "안 바뀌었으면 안 싣는다"로 대부분 막지만 그건
     클라이언트 신뢰다 — 진짜 방어선은 여기다(불변식 3).

     검사가 읽고→비교라 여기와 batch 사이에 창이 남는다(D1 엔 대화형 트랜잭션이 없다). saveWeek
     이 CAS 를 쓰기 조건으로 옮겨 닫은 것과 달리 여기선 그대로 둔다 — 항목 하나를 건드리는
     쓰기라 피해 반경이 주 전체 교체와 다르고, 현실적으로 나는 건 "분 단위로 벌어진 stale
     저장"이며 그건 이 검사가 잡는다(AGENTS.md 의 D1 수용 경계와 같은 판단). */
  if (touchesSchedule && (input.playedDateWas ?? null) !== (entries[0]?.scheduledDate ?? null)) {
    throw new PlayDateChangedElsewhere();
  }

  const updateRow = db
    .update(games)
    .set({ cleared: input.cleared, clearedDate: input.clearedDate })
    .where(eq(games.id, input.id))
    .returning();

  /* 필드가 없으면 항목 연산 자체가 없다 — 위 검사를 안 거쳤으므로 entries 는 여러 날일 수도
     있는데, 그때 entries[0] 를 건드리면 "클리어만 고치는" 저장이 가장 이른 날을 조용히
     옮기거나 지운다. undefined 를 여기서 한 번 더 가르는 게 그 자리를 닫는다. */
  const current = touchesSchedule ? entries[0] : undefined;

  /* 날짜가 **그대로면** 일정을 안 건드린다. 항목이 하나인 게임은 폼이 그 날짜를 입력에 채워
     두므로, 클리어만 고친 저장도 같은 값을 그대로 실어 온다 — 걸러내지 않으면 일정을 바꾸지
     않은 저장이 UPDATE 를 날리고 claimWeek 이 revision 을 올려, 열어 둔 편집기가 **원인 없는
     CONFLICT** 를 받는다. 관리자는 무엇과 충돌했는지 알 길이 없고, revision 은 파괴적 전체
     교체를 막는 마지막 방어선이라 거짓 경보가 섞이면 진짜 경합의 신호가 흐려진다
     (적대적 리뷰 5라운드). */
  const unchangedDate = current !== undefined && input.playedDate === current.scheduledDate;

  const entryOp =
    !touchesSchedule || unchangedDate
      ? null
      : input.playedDate === null
        ? current
          ? /* 날짜를 비우면 항목을 **지우지 않고 연결만 푼다.** 그 행은 "그날 방송이 있었다"는
             정본 사실이고 /schedule 이 쥔 start_time·자유 title 을 담을 수 있다 — 게임 폼이
             만든 행인지 일정에서 짠 행인지 구분할 표식이 없어서, 지우면 어느 쪽이든 날아간다.
             게임을 **삭제**해도 항목은 ON DELETE SET NULL 로 남는데(schema 주석) 날짜만 비운
             게 더 파괴적이면 앞뒤가 안 맞고, 폼 문구도 "모르면 비워 둬요"라 파괴 신호가 없다.
             "이 게임을 그날 한 게 아니다"는 연결 해제이지 "그날 방송이 없었다"가 아니다. */
            db
              .update(scheduleEntries)
              .set({ gameId: null })
              .where(eq(scheduleEntries.id, current.id))
          : null
        : current
          ? db
              .update(scheduleEntries)
              .set({ scheduledDate: input.playedDate })
              .where(eq(scheduleEntries.id, current.id))
          : db.insert(scheduleEntries).values({
              scheduledDate: input.playedDate!,
              startTime: null,
              title: rows[0].categoryValue,
              gameId: input.id,
            });

  /* 건드린 주를 전부 청구한다(claimWeek 주석 — 없으면 열어 둔 편집기가 stale 인 채 CAS 를
     통과해 이 쓰기를 지운다). **날짜를 옮기면 주가 둘이다**: 옛 항목이 있던 주와 새 주. 한쪽만
     올리면 다른 쪽 편집기가 그대로 통과한다. 같은 주면 중복 청구가 되므로 집합으로 접는다. */
  const now = Date.now();
  const touchedWeeks =
    touchesSchedule && !unchangedDate
      ? [
          ...new Set(
            [current?.scheduledDate, input.playedDate].filter((d): d is string => Boolean(d)),
          ),
        ]
      : [];
  /* batch 문 수가 가변이라(항목 연산 유무 · 주 1~2개) drizzle 의 튜플 추론이 안 선다. 첫 문이
     updateRow 인 것만 보장하면 되므로 그 자리만 단언한다 — 순서를 바꾸면 이 단언이 거짓말이
     되니 updateRow 는 항상 맨 앞이다. */
  type Op = typeof updateRow | NonNullable<typeof entryOp> | ReturnType<typeof claimWeek>;
  const ops: [Op, ...Op[]] = [updateRow];
  if (entryOp) ops.push(entryOp);
  for (const d of touchedWeeks) ops.push(claimWeek(db, d, now));

  const results = await db.batch(ops);
  const updated = results[0] as Awaited<typeof updateRow>;
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
