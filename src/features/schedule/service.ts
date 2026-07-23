/* 일정 데이터 유즈케이스(이슈 #56 결정 12·14). tRPC 무관(순수 db 연산)이라 라우터·서버
   컴포넌트가 재사용한다. 쓰기는 주 단위 일괄 저장 하나 — 한 주를 통째로 교체한다. */

import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { toIsoDate, weekDates } from "@/core/calendar";
import { scheduleEntries, scheduleWeeks, type Db, type ScheduleEntry } from "@/db";
import type { SaveWeekInput } from "./schema";

/* 한 주의 뷰 — 메타(공지·발행) + 그 주 7일의 항목들. 편집 화면이 불러오고, 저장이 되돌려준다.
   주 자체는 저장하지 않고 날짜에서 유도하므로(결정 2) 항목은 week_id FK 가 아니라 scheduled_date
   범위로 모은다 — 날짜와 어긋난 주가 저장될 자리 자체가 없다. */
export type WeekView = {
  weekStartDate: string;
  note: string | null;
  publishedAt: number | null;
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
    entries,
  };
}

/* 주 단위 일괄 저장 = 그 주 전체 교체(결정 14). 메타를 upsert 하고, 그 주 날짜 범위의 항목을
   전부 지운 뒤 보낸 항목을 다시 넣는다 — 클라이언트가 항목별 add/update/delete 를 추적하지 않아도
   되고, 마지막 저장이 그 주의 정본이 된다. **D1 batch() 로 원자 실행**한다: 지우고 넣는 사이에
   깨지면 그 주가 반쯤 빈 채로 남기 때문이다. 다른 주의 항목·이관된 과거 아카이브는 날짜 범위
   밖이라 안 건드린다.

   발행 시각은 처음 발행할 때만 찍고 이후 저장엔 유지한다(existing ?? now) — 재저장마다 바뀌면
   "언제 발행했나"가 무의미해진다. 발행을 내리면 null 로 되돌린다(다시 초안). */
export async function saveWeek(db: Db, input: SaveWeekInput): Promise<WeekView> {
  const { monday, sunday } = weekBounds(input.weekStartDate);
  const now = Date.now();

  const [existing] = await db
    .select({ publishedAt: scheduleWeeks.publishedAt })
    .from(scheduleWeeks)
    .where(eq(scheduleWeeks.weekStartDate, input.weekStartDate));
  const publishedAt = input.published ? (existing?.publishedAt ?? now) : null;

  const upsertWeek = db
    .insert(scheduleWeeks)
    .values({ weekStartDate: input.weekStartDate, note: input.note, publishedAt })
    // onConflictDoUpdate 는 .update() 가 아니라 $onUpdate 가 안 돈다 — last_updated_at 을 손으로 찍는다.
    .onConflictDoUpdate({
      target: scheduleWeeks.weekStartDate,
      set: { note: input.note, publishedAt, lastUpdatedAt: now },
    });
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
    await db.batch([upsertWeek, clearEntries, insertEntries]);
  } else {
    await db.batch([upsertWeek, clearEntries]);
  }

  return getWeekForEdit(db, input.weekStartDate);
}
