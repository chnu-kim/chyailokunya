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

/* 다음 revision. revision 은 그 주 메타의 last_updated_at 이지만 **단조 증가가 정본이다** —
   벽시계 ms 를 그대로 쓰면 같은 ms 에 두 번 저장될 때 새 값이 옛 값과 같아져(now === oldRevision),
   그 옛 revision 을 든 stale 요청이 CAS(WHERE last_updated_at = revision)를 통과해 남의 저장을
   덮는다(적대적 리뷰 지적). now 가 크면 now, 아니면 oldRevision+1 로 **무조건 크게** 만들어 저장
   때마다 값이 반드시 바뀌게 한다(시계가 뒤로 가도 성립). 순수 함수라 단위 테스트가 못박는다. */
export function nextRevision(oldRevision: number, now: number): number {
  return now > oldRevision ? now : oldRevision + 1;
}

/* 주 단위 일괄 저장 = 그 주 전체 교체(결정 14). 그 주 날짜 범위의 항목을 전부 지운 뒤 보낸 항목을
   다시 넣는다 — 클라이언트가 항목별 add/update/delete 를 추적하지 않는다. 다른 주의 항목·이관된
   과거 아카이브는 날짜 범위 밖이라 안 건드린다.

   ── 낙관적 동시성(revision) ────────────────────────────────────────────────────────
   전체 교체라 **경합의 피해 반경이 크다**: stale 한 초안이 필드 하나를 덮어쓰는 게 아니라 그 주를
   통째로 지우고 자기 것으로 채운다 — 먼저 저장한 사람의 항목이 통째로 사라진다. 그래서 불러온
   시점의 revision 을 함께 받아, 그 사이 주가 바뀌었으면 CONFLICT 로 거절한다(덮어쓰지 않는다).
   검사는 읽고→비교가 아니라 **쓰기의 조건**이다(WHERE last_updated_at = revision) — 읽고 비교하면
   두 요청이 같은 revision 을 읽고 둘 다 통과하는 창이 생긴다.

   ── 세 단계로 나눈 이유: 실패가 발행 상태를 넘지 못하게 ─────────────────────────────
   D1 은 대화형 트랜잭션이 없어(batch 만 원자적) 메타 청구와 항목 교체가 별개 왕복이다. 그래서
   순서와 "무엇을 어디서 쓰나"로 안전을 만든다:
     0. prevalidate — 참조 게임을 미리 확인(없으면 아무것도 쓰기 전에 거절).
     1. claim — revision 만 원자적으로 잡는다. **user-visible 메타(note·publishedAt)는 여기서 안 쓴다.**
     2. batch — note·publishedAt·항목 삭제·삽입을 **한 batch** 로(원자).
   핵심은 **발행 경계를 넘는 값(publishedAt·note)이 2단계 batch 에서만 쓰인다**는 것이다. 2단계가
   중단·실패하면 셋이 함께 롤백돼 발행 상태가 안 바뀐다. 1단계에서 바뀐 건 revision 뿐이고 그건
   외부에 안 보인다 — stale 해진 에디터가 다음 저장 때 CONFLICT 를 받아 새로고침하게 될 뿐이다
   (적대적 리뷰가 "실패가 발행 상태를 바꾼다"로 세 라운드 파고든 자리를 여기서 구조로 닫는다).

   ── 알고 수용한 한계: 청구~batch 사이 sub-ms gap ──────────────────────────────────
   1단계가 revision 을 올린 뒤 2단계 batch 가 항목을 바꾸는 그 사이(한 D1 왕복, ~수 ms)에 다른
   편집자가 getWeekForEdit 을 하면 "새 revision + 옛 항목"을 본다. 그 상태로 저장하면 revision 이
   맞아 CAS 를 통과해 앞 저장을 덮을 수 있다(적대적 리뷰 R7). **현실적 동시성은 이게 아니다** —
   실제로 나는 건 "분 단위로 벌어진 stale 저장"이고 그건 CAS 가 막는다(revision 이 달라 CONFLICT).
   R7 은 두 관리자가 **같은 주를 같은 수-ms 창에** 겹쳐야 걸리는 경합이라, 관리자 소수·주간 일정
   에선 사실상 도달 불가이고 걸려도 결과는 한 저장 유실(재저장으로 복구)이다. 완전히 닫으려면
   대화형 트랜잭션이 필요한데 D1 엔 없고, 우회(nonce 컬럼 + 조건부 가드 raw-SQL batch)는 D1
   동작이 불확실해 과대 투자다 — 그 비용이 이 gap 의 무게보다 커서 **수용하고 머지하기로 했다
   (2026-07-24 사용자 결정).** 필요해지면 위 우회로 닫는다.

   발행 시각은 처음 발행할 때만 찍고 이후 저장엔 유지한다(existing ?? now) — 재저장마다 바뀌면
   "언제 발행했나"가 무의미해진다. 발행을 내리면 null 로 되돌린다(다시 초안). */
export async function saveWeek(db: Db, input: SaveWeekInput): Promise<WeekView> {
  const { monday, sunday } = weekBounds(input.weekStartDate);
  const now = Date.now();

  /* ── 0단계: 참조 게임을 **메타를 건드리기 전에** 검증한다 ─────────────────────────
     gameId 가 없는 게임을 가리키면 2단계 INSERT 가 FK 로 실패한다. 그 실패를 메타 이전으로 옮겨,
     에디터 로드 후 다른 관리자가 게임을 지운 현실적 시나리오에서 schedule_weeks 가 안 바뀌게 한다.
     남는 창은 이 SELECT 와 2단계 사이 마이크로초뿐이고, 그 창에 걸려도 위 3단계 구조가 발행
     상태를 지킨다(2단계 실패 = 메타 롤백). FK 제약은 최종 방어선으로 남긴다. */
  const gameIds = [
    ...new Set(input.entries.map((e) => e.gameId).filter((id): id is number => id !== null)),
  ];
  if (gameIds.length) {
    const found = await db.select({ id: games.id }).from(games).where(inArray(games.id, gameIds));
    if (found.length !== gameIds.length) throw new ReferencedGameMissing();
  }

  /* 발행 시각 연속성용 현재 값을 읽는다. 청구가 성공하면 그 사이 아무도 이 주를 못 바꿨으므로
     (모든 저장이 revision 을 바꾸고, 바꿨으면 아래 청구가 0행이 된다) 이 값은 2단계까지 유효하다. */
  const [existing] = await db
    .select({ publishedAt: scheduleWeeks.publishedAt })
    .from(scheduleWeeks)
    .where(eq(scheduleWeeks.weekStartDate, input.weekStartDate));
  const publishedAt = input.published ? (existing?.publishedAt ?? now) : null;

  /* ── 1단계: 청구(claim) ───────────────────────────────────────────────────────────
     revision 이 있으면 UPDATE … WHERE last_updated_at = revision(그 주가 안 바뀌었을 때만 매치),
     null 이면 INSERT … onConflictDoNothing(그 사이 아무도 안 만들었을 때만). 어느 쪽이든 0행이면
     그 사이 누가 손댄 것이라 CONFLICT.

     **두 경로가 published_at 을 다루는 방식이 반대인 게 핵심이다.**
     - 기존 주(revision 있음): published_at 을 **안 건드린다**(revision 만 단조 증가). 이미 값이
       있는데 실패한 저장이 그걸 바꾸면 발행 경계를 넘는다 — 그래서 진짜 값은 2단계 batch 에서만
       원자적으로 쓴다(round-4 에서 이렇게 닫았다).
     - 새/레거시 주(revision null): 행이 **없어서** 문제가 반대다. 이관된 레거시 주는 "메타 행
       부재 = 표시"가 정본인데(ADR-0022), 청구가 published_at NULL 인 빈 placeholder 를 만들면
       그 주가 draft(숨김)로 뒤집힌다 — 청구 뒤 batch 가 실패하면 과거 플레이 날짜가 사라진다
       (적대적 리뷰가 잡은 자리). 그래서 null 청구는 **의도한 메타(note·published_at)를 담아**
       만든다: 레거시 편집의 기본값은 발행(hasMeta 없음 → published=true, 편집기)이라 청구가
       published 행을 만들어, 실패해도 그 주 항목이 계속 보드에 뜬다(손실 0 유지). 관리자가
       발행을 명시적으로 내린 경우엔 숨김이 곧 의도라 그대로 둔다. 여기서 published_at 을 담아도
       round-4 문제가 안 도지는 건, 바꿀 기존 값이 없기 때문이다(생성이지 변경이 아니다). */
  const claimed =
    input.revision === null
      ? await db
          .insert(scheduleWeeks)
          .values({ weekStartDate: input.weekStartDate, note: input.note, publishedAt })
          .onConflictDoNothing({ target: scheduleWeeks.weekStartDate })
          .returning({ id: scheduleWeeks.id })
      : await db
          .update(scheduleWeeks)
          // revision 만 단조 증가(nextRevision) — .update() 는 $onUpdate 가 안 돌아 손으로 찍는다.
          .set({ lastUpdatedAt: nextRevision(input.revision, now) })
          .where(
            and(
              eq(scheduleWeeks.weekStartDate, input.weekStartDate),
              eq(scheduleWeeks.lastUpdatedAt, input.revision),
            ),
          )
          .returning({ id: scheduleWeeks.id });
  if (claimed.length === 0) throw new WeekRevisionConflict();

  /* ── 2단계: user-visible 메타 + 항목 전체 교체를 한 batch(원자) ──────────────────────
     note·publishedAt 이 여기서만 쓰인다 — 이 batch 가 실패/중단되면 셋(메타 SET·삭제·삽입)이
     함께 롤백돼 발행 경계가 안 넘어간다. 0단계가 gameId 를 걸렀으므로 현실적으로 실패하지 않는다.
     setMeta 는 last_updated_at 을 안 건드린다(1단계가 이미 새 revision 을 박았다). */
  const setMeta = db
    .update(scheduleWeeks)
    .set({ note: input.note, publishedAt })
    .where(eq(scheduleWeeks.weekStartDate, input.weekStartDate));
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
    await db.batch([setMeta, clearEntries, insertEntries]);
  } else {
    await db.batch([setMeta, clearEntries]);
  }

  return getWeekForEdit(db, input.weekStartDate);
}
