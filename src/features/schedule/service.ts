/* 일정 데이터 유즈케이스(이슈 #56 결정 12·14). tRPC 무관(순수 db 연산)이라 라우터·서버
   컴포넌트가 재사용한다. 쓰기는 주 단위 일괄 저장 하나 — 한 주를 통째로 교체한다. */

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { toIsoDate, weekDates } from "@/core/calendar";
import { games, scheduleEntries, scheduleWeeks, type Db, type ScheduleEntry } from "@/db";
import type { SaveWeekInput } from "./schema";

/* 한 주의 뷰 — 메타(공지·발행) + 그 주 7일의 항목들. 편집 화면이 불러오고, 저장이 되돌려준다.
   주 자체는 저장하지 않고 날짜에서 유도하므로(결정 2) 항목은 week_id FK 가 아니라 scheduled_date
   범위로 모은다 — 날짜와 어긋난 주가 저장될 자리 자체가 없다. */
export type WeekView = {
  weekStartDate: string;
  note: string | null;
  publishedAt: number | null;
  /* 이 주에 **메타 행이 있는가**. publishedAt 만으로는 "초안(메타 있고 미발행)"과 "이관된 과거
     아카이브(메타 자체가 없음)"를 못 가른다 — 둘 다 null 이다. 그런데 보드 날짜 유도에선 그
     둘이 정반대다(ADR-0022): 초안은 안 세고 메타 없는 레거시는 센다.

     편집기가 이걸 봐야 하는 이유가 결정적이다. 레거시 주를 열어 아무거나 고치고 저장하면
     saveWeek 이 메타 행을 만드는데, 그때 published 가 false 면 published_at 이 NULL 로 박혀
     **그 순간부터 그 주 항목이 보드 날짜에서 빠진다** — 이관이 지킨 "손실 0"(결정 16)이 첫
     편집에서 깨진다. 그래서 편집기는 메타 없는 주를 "이미 공개 중"으로 열어야 하고(발행 체크됨),
     그 판단 근거가 이 필드다. */
  hasMeta: boolean;
  /* 낙관적 동시성의 토큰 — 이 주 메타의 last_updated_at(메타가 없으면 null). 편집기는 불러온
     이 값을 저장에 되돌려 보내고, 서버는 그 사이 주가 바뀌었는지 이걸로 판정한다(saveWeek).
     별도 revision 컬럼을 안 두는 이유: last_updated_at 이 이미 "이 주가 마지막으로 바뀐 순간"
     이라 같은 사실을 두 곳에 적을 필요가 없다. */
  revision: number | null;
  entries: ScheduleEntry[];
};

/* 그 주 7일의 날짜 경계 [월, 일]. text 'YYYY-MM-DD' 는 사전순 = 시간순이라 범위 비교가 그대로
   선다(BETWEEN 대신 gte/lte). */
function weekBounds(weekStartDate: string): { monday: string; sunday: string } {
  const dates = weekDates(toIsoDate(weekStartDate));
  return { monday: dates[0]!, sunday: dates[6]! };
}

/* 편집용 읽기 — 발행 여부와 무관하게 그 주를 통째로 준다(초안도 편집자는 봐야 한다). 공개
   읽기(발행된 주만)는 읽기 페이지가 서는 작업순서 5 에서 별도 경로로 붙는다(그때 published_at
   필터). 정렬: 날짜 오름차순, 하루 안에서는 시각 있는 항목 먼저(IS NULL 이 뒤로), 같은 시각은
   id 순 — start_time 이 null 인 항목은 그날의 끝에 몰아 시간표가 위에서 아래로 읽히게 한다. */
export async function getWeekForEdit(db: Db, weekStartDate: string): Promise<WeekView> {
  const { monday, sunday } = weekBounds(weekStartDate);
  const [meta] = await db
    .select()
    .from(scheduleWeeks)
    .where(eq(scheduleWeeks.weekStartDate, weekStartDate));
  const entries = await db
    .select()
    .from(scheduleEntries)
    .where(
      and(gte(scheduleEntries.scheduledDate, monday), lte(scheduleEntries.scheduledDate, sunday)),
    )
    .orderBy(
      asc(scheduleEntries.scheduledDate),
      sql`${scheduleEntries.startTime} IS NULL`,
      asc(scheduleEntries.startTime),
      asc(scheduleEntries.id),
    );
  return {
    weekStartDate,
    note: meta?.note ?? null,
    publishedAt: meta?.publishedAt ?? null,
    hasMeta: meta !== undefined,
    revision: meta?.lastUpdatedAt ?? null,
    entries,
  };
}

/* 공개 읽기 — **발행된 주만** 준다(결정 13·ADR-0022). 미발행(초안)이거나 주 메타가 없으면
   null 을 돌려 공개 화면이 "아직 준비 중"으로 떨어지게 한다: 초안 항목이 HTML 로 새지 않아야
   미완성 편성이 공유 카드로 박제되지 않는다. 편집자용(getWeekForEdit)과 갈라 두는 이유가 이
   경계다 — 같은 주라도 신원에 따라 서버가 다른 뷰를 준다(page.tsx 가 canWrite 로 고른다). */
export async function getPublishedWeek(db: Db, weekStartDate: string): Promise<WeekView | null> {
  const week = await getWeekForEdit(db, weekStartDate);
  return week.publishedAt !== null ? week : null;
}

/* 다른 편집자(또는 다른 탭)가 먼저 저장해 revision 이 어긋났다. 라우터가 CONFLICT 로 올린다.
   서비스는 tRPC 무관이라 TRPCError 를 안 쓰고 도메인 오류로 던진다(games 의 "없으면 null" 과
   같은 결 — 매핑은 라우터가 한다). */
export class WeekRevisionConflict extends Error {
  constructor() {
    super("week revision conflict");
    this.name = "WeekRevisionConflict";
  }
}

/* 항목이 보드에 없는 게임을 가리켰다. 라우터가 BAD_REQUEST 로 올린다(FK 위반과 같은 문구).
   FK 로도 걸리지만(제약이 최종 방어선), 저장은 이걸 **메타를 건드리기 전에** 먼저 검사해
   실패가 발행 상태를 남기지 않게 한다(saveWeek 의 prevalidate 주석). */
export class ReferencedGameMissing extends Error {
  constructor() {
    super("referenced game missing");
    this.name = "ReferencedGameMissing";
  }
}

/* 주 단위 일괄 저장 = 그 주 전체 교체(결정 14). 메타를 upsert 하고, 그 주 날짜 범위의 항목을
   전부 지운 뒤 보낸 항목을 다시 넣는다 — 클라이언트가 항목별 add/update/delete 를 추적하지 않아도
   된다. **D1 batch() 로 원자 실행**한다: 지우고 넣는 사이에 깨지면 그 주가 반쯤 빈 채로 남기
   때문이다. 다른 주의 항목·이관된 과거 아카이브는 날짜 범위 밖이라 안 건드린다.

   ── 낙관적 동시성(revision) ────────────────────────────────────────────────────────
   전체 교체라 **경합의 피해 반경이 크다**: stale 한 초안이 필드 하나를 덮어쓰는 게 아니라 그 주를
   통째로 지우고 자기 것으로 채운다 — 먼저 저장한 사람의 항목이 통째로 사라진다. 빈도가 낮아도
   (관리자 소수) 한 번 나면 복구가 없으므로, 불러온 시점의 revision 을 함께 받아 검사한다.
   revision = 그 주 메타의 last_updated_at, 메타가 없으면 null(= "내가 불러올 땐 이 주가 아직
   없었다"). 어긋나면 CONFLICT 로 거절한다 — 덮어쓰지 않는다.

   **검사는 읽어서 비교하는 게 아니라 쓰기의 조건이다.** 읽고→비교하고→쓰면 두 요청이 같은
   revision 을 읽고 둘 다 통과할 수 있어(검사와 쓰기 사이 창) 방어가 이름만 남는다. 아래 1단계의
   조건부 UPDATE/INSERT 가 그 창을 없앤다 — 자세한 건 거기 주석.

   발행 시각은 처음 발행할 때만 찍고 이후 저장엔 유지한다(existing ?? now) — 재저장마다 바뀌면
   "언제 발행했나"가 무의미해진다. 발행을 내리면 null 로 되돌린다(다시 초안). */
export async function saveWeek(db: Db, input: SaveWeekInput): Promise<WeekView> {
  const { monday, sunday } = weekBounds(input.weekStartDate);
  const now = Date.now();

  /* ── 0단계: 참조 게임을 **메타를 건드리기 전에** 검증한다 ─────────────────────────
     항목의 gameId 가 없는 게임을 가리키면 2단계 INSERT 가 FK 로 실패한다. 그 실패가 메타 청구
     (1단계) **뒤에** 나면, 메타(note·publishedAt·revision)는 이미 커밋됐는데 라우터는 실패를
     돌려주는 상태가 된다 — publishedAt 은 공개 가시성·보드 날짜를 지배하므로(ADR-0022) "저장
     실패했다는데 그 주가 발행/미발행으로 바뀐" 사용자 가시 결과다(적대적 리뷰가 잡은 자리).
     참조 게임을 지금 확인해 그 실패 모드를 메타 이전으로 옮긴다: 에디터 로드 후 다른 관리자가
     게임을 지운 현실적 시나리오는 여기서 걸려 schedule_weeks 가 한 글자도 안 바뀐다.
     (남는 창은 이 SELECT 와 2단계 INSERT 사이 마이크로초뿐 — 사람이 그 틈에 게임을 지울 수
     없다. FK 제약은 최종 방어선으로 그대로 두고, 걸리면 라우터가 같은 BAD_REQUEST 로 맵한다.) */
  const gameIds = [
    ...new Set(input.entries.map((e) => e.gameId).filter((id): id is number => id !== null)),
  ];
  if (gameIds.length) {
    const found = await db.select({ id: games.id }).from(games).where(inArray(games.id, gameIds));
    if (found.length !== gameIds.length) throw new ReferencedGameMissing();
  }

  /* 발행 시각 연속성 때문에 현재 값을 먼저 읽는다. **이 읽기는 검사가 아니다** — 검사는 아래
     청구문의 WHERE 가 한다. 읽고 나서 남이 저장했더라도 청구가 0행이 되어 걸리므로, 여기서
     읽은 publishedAt 이 낡은 채로 쓰일 일이 없다. */
  const [existing] = await db
    .select({ publishedAt: scheduleWeeks.publishedAt })
    .from(scheduleWeeks)
    .where(eq(scheduleWeeks.weekStartDate, input.weekStartDate));
  const publishedAt = input.published ? (existing?.publishedAt ?? now) : null;

  /* ── 1단계: 조건부 청구(compare-and-swap) ──────────────────────────────────────
     revision 검사를 **쓰기 자체의 조건**으로 넣는다. 읽고→비교하고→쓰면 두 요청이 같은
     revision 을 읽고 **둘 다 통과**할 수 있고, 그다음 전체 교체가 먼저 저장한 사람의 한 주를
     통째로 지운다(적대적 리뷰가 잡은 자리). WHERE last_updated_at = revision 은 원자적이라
     동시 요청 중 정확히 하나만 매치한다 — 진 쪽은 0행이라 항목을 건드리기 전에 멈춘다.
     메타가 없어야 하는 경우(revision null)는 UNIQUE 를 청구로 쓴다: 그 사이 누가 만들었으면
     onConflictDoNothing 이 0행을 돌려준다. */
  const claimed =
    input.revision === null
      ? await db
          .insert(scheduleWeeks)
          .values({ weekStartDate: input.weekStartDate, note: input.note, publishedAt })
          .onConflictDoNothing({ target: scheduleWeeks.weekStartDate })
          .returning({ id: scheduleWeeks.id })
      : await db
          .update(scheduleWeeks)
          // .update() 는 $onUpdate 가 안 도므로 last_updated_at 을 손으로 찍는다(= 새 revision).
          .set({ note: input.note, publishedAt, lastUpdatedAt: now })
          .where(
            and(
              eq(scheduleWeeks.weekStartDate, input.weekStartDate),
              eq(scheduleWeeks.lastUpdatedAt, input.revision),
            ),
          )
          .returning({ id: scheduleWeeks.id });
  if (claimed.length === 0) throw new WeekRevisionConflict();

  /* ── 2단계: 항목 전체 교체 ────────────────────────────────────────────────────
     청구에 성공한 요청만 여기 온다. 지우기와 넣기는 **한 batch** 로 묶어 원자 실행한다 —
     그 사이 깨지면 그 주가 반쯤 빈 채로 남기 때문이다. 0단계가 gameId 를 미리 걸렀으므로
     이 batch 는 현실적으로 실패할 일이 없다 — 그래서 1단계에서 커밋한 메타가 "실패했는데
     발행 상태만 바뀐" 채로 남는 경로가 닫힌다. */
  const clearEntries = db
    .delete(scheduleEntries)
    .where(
      and(gte(scheduleEntries.scheduledDate, monday), lte(scheduleEntries.scheduledDate, sunday)),
    );

  if (input.entries.length) {
    const insertEntries = db.insert(scheduleEntries).values(
      input.entries.map((e) => ({
        scheduledDate: e.scheduledDate,
        startTime: e.startTime,
        title: e.title,
        gameId: e.gameId,
      })),
    );
    await db.batch([clearEntries, insertEntries]);
  } else {
    await db.batch([clearEntries]);
  }

  return getWeekForEdit(db, input.weekStartDate);
}
