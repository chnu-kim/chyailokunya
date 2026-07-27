/* 일정 데이터 유즈케이스(이슈 #56 결정 12·14). tRPC 무관(순수 db 연산)이라 라우터·서버
   컴포넌트가 재사용한다. 쓰기는 주 단위 일괄 저장 하나 — 한 주를 통째로 교체한다. */

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { toIsoDate, weekDates, weekStartOf } from "@/core/calendar";
import { games, scheduleEntries, scheduleWeeks, type Db, type ScheduleEntry } from "@/db";
import type { PublishWeekInput, SaveWeekInput } from "./schema";

/* 한 주의 뷰 — 메타(공지·발행) + 그 주 7일의 항목들. 편집 화면이 불러오고, 저장이 되돌려준다.
   주 자체는 저장하지 않고 날짜에서 유도하므로(결정 2) 항목은 week_id FK 가 아니라 scheduled_date
   범위로 모은다 — 날짜와 어긋난 주가 저장될 자리 자체가 없다. */
export type WeekView = {
  weekStartDate: string;
  note: string | null;
  publishedAt: number | null;
  /* 이 주가 **아직 짜는 중인가**. publishedAt 과 독립된 축이다(schema.ts 주석·ADR-0022):
     게임 보드는 이 축만 보고, /schedule 공개는 publishedAt 만 본다. 그래서 세 상태가 선다 —
     초안(보드 X·공개 X) · 확정 비공개(보드 O·공개 X) · 발행(보드 O·공개 O).

     메타 행이 없는 주는 그 주에 항목이 있는지로 가른다: 항목이 있으면 이관된 과거 아카이브라
     확정(false), 비어 있으면 아직 아무도 안 짠 새 주라 초안(true)이다. 저장할 때도 서버가 같은
     규칙을 다시 적용하므로(saveWeek) 클라이언트가 이 값을 되돌려 보낼 필요가 없다. */
  draft: boolean;
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
    draft: meta?.draft ?? entries.length === 0,
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

/* 빈 주는 발행할 수 없다(이슈 #56 결정 22). 편집기의 disabled 버튼·머신 가드(canPublish)는
   편의일 뿐 유일한 방어선이 아니다 — schedule:write 권한자가 tRPC 를 직접 불러 이 검사를
   우회할 수 있어서 서버가 정본으로 다시 확인한다(불변식 2·3, 적대적 리뷰 지적: 실제로 이
   경로가 열려 있었다). */
export class EmptyWeekCannotPublish extends Error {
  constructor() {
    super("empty week cannot be published");
    this.name = "EmptyWeekCannotPublish";
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

/* 게임 폼이 일정 항목을 건드린 주를 **청구(claim)한다** — revision(last_updated_at)을 확보하는
   것이 전부다. 메타가 있으면 단조 증가시키고, 없으면 기본 상태(draft=0·미발행)로 행을 만든다.
   소유는 이 파일이 지지만 호출은 `features/games`(addGame·updateGame)가 자기 batch 에 조립해서
   한다 — D1 은 대화형 트랜잭션이 없어 게임 쓰기와 이 청구가 **한 batch**로 원자화돼야 하기
   때문이다(features/games/service.ts 의 addGame·updateGame 주석).

   왜 청구하나: saveWeek 은 그 주를 통째로 교체하면서 revision CAS 로 "그 사이 바뀌었으면 거절"을
   보장한다. 게임 폼이 그 계약 밖에서 항목을 쓰면 열어 둔 편집기가 stale 인 채 CAS 를 통과해
   방금 만든 항목을 **조용히 지운다**(적대적 리뷰 3·8라운드). 메타가 없으면 올릴 revision 자체가
   없으므로, 행을 만들어 두는 게 그 구멍을 닫는 유일한 길이다 — 편집기의 null 청구가
   onConflictDoNothing 으로 0행이 돼 CONFLICT 로 걸린다.

   ── 청구가 도메인 상태를 안 건드린다(이슈 #64 가 연 자리) ─────────────────────────
   한때 이 함수는 메타 없는 주를 **발행된 채로** 만들었다. "행 없음"이 보드엔 표시로, 공개
   /schedule 엔 비공개로 읽히던 시절이라 행을 만드는 순간 둘 중 하나가 깨졌고, 날짜가 사라지는
   쪽보다 한 화면 더 보이는 쪽이 가볍다고 봤다. 그 저울질이 **해제 경로에서 뒤집혔다**: 연결이
   풀리는 순간 그 항목은 어느 게임에도 안 붙어 보드에서 사라지는데, 바로 그 항목이 시각·자유
   제목까지 달고 /schedule 에 공개됐다. 관리자가 한 행동은 "이 게임을 그날 한 게 아니다"뿐인데.

   draft 컬럼이 그 저울질 자체를 없앤다(schema.ts 주석). 기본값 0 이 "행 없음"과 같은 뜻이라
   청구가 만드는 행은 보드에도 공개에도 **아무 변화를 안 준다** — 넣기든 옮기기든 해제든 결과가
   같아서 연산별로 계약을 쪼갤 필요도 없다. 초안 주(draft=1)는 UPDATE 경로라 그대로 초안이고,
   발행된 주도 published_at 을 안 건드려 그대로 발행이다(결정 13 은 여기서도 유지된다).

   revision 은 nextRevision 과 같은 규칙으로 단조 증가시킨다 — 같은 ms 안에 두 번 쓰면
   now 가 기존 값과 같아 revision 이 안 바뀌고, 그럼 CAS 가 통과해 보호가 도로 뚫린다.

   async 가 아니다 — 쿼리 빌더를 그대로 돌려줘야 호출자가 이걸 **자기 batch 에 넣어** 원자성을
   만든다(async 면 Promise 라 batch 가 못 받는다). 빌더는 thenable 이라 그냥 await 해도 된다. */
export function claimWeek(db: Db, date: string, now: number) {
  const weekStart = weekStartOf(toIsoDate(date));
  return db
    .insert(scheduleWeeks)
    .values({ weekStartDate: weekStart, draft: false, publishedAt: null, lastUpdatedAt: now })
    .onConflictDoUpdate({
      target: scheduleWeeks.weekStartDate,
      set: { lastUpdatedAt: sql`max(${scheduleWeeks.lastUpdatedAt} + 1, ${now})` },
    });
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

  /* 빈 주는 발행할 수 없다(publishWeek 과 같은 규칙, 결정 22) — saveWeek 은 전체 교체라
     `input.entries` 가 곧 저장 후의 항목 전체다(DB 조회 없이 입력만으로 판정된다). publishWeek
     에만 이 검사를 걸면 이 뮤테이션(schedule:write 권한자가 여전히 직접 부를 수 있는 노출된
     경로)으로 그대로 우회된다 — 적대적 리뷰가 실제로 이 자리를 잡았다. DB 를 하나도 안 건드린
     시점에 거절해 실패가 아무 흔적도 안 남긴다. */
  if (input.published && input.entries.length === 0) throw new EmptyWeekCannotPublish();

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

  /* 발행 시각 연속성과 draft 축 유도에 쓸 현재 값을 읽는다. 청구가 성공하면 그 사이 아무도 이
     주를 못 바꿨으므로(모든 저장이 revision 을 바꾸고, 바꿨으면 아래 청구가 0행이 된다) 이 값은
     2단계까지 유효하다. 메타와 "이미 있던 항목"을 한 batch(왕복 1회)로 묶는다 — 둘째는 메타가
     없는 주의 draft 기본값을 가르는 데만 쓰인다(아래). */
  const [metaRows, priorEntries] = await db.batch([
    db
      .select({ publishedAt: scheduleWeeks.publishedAt, draft: scheduleWeeks.draft })
      .from(scheduleWeeks)
      .where(eq(scheduleWeeks.weekStartDate, input.weekStartDate)),
    db
      .select({ id: scheduleEntries.id })
      .from(scheduleEntries)
      .where(
        and(gte(scheduleEntries.scheduledDate, monday), lte(scheduleEntries.scheduledDate, sunday)),
      )
      .limit(1),
  ]);
  const existing = metaRows[0];
  const publishedAt = input.published ? (existing?.publishedAt ?? now) : null;

  /* draft 는 **서버가 정한다** — 클라이언트는 "공개할까"만 보낸다(published). 두 축을 UI 가
     따로 쥐면 도메인 규칙이 브라우저로 새고, 위조 클라이언트가 초안을 보드에 띄울 수 있다.

     규칙 셋:
     - 발행하면 확정이다. 공개한 편성이 "짜는 중"일 수는 없다(스키마 CHECK 와 같은 사실).
     - 메타가 있으면 그 값을 **유지한다.** 그래서 발행을 내려도 draft 로 안 돌아간다 — 공개
       철회는 "공개를 거둔다"이지 "안 짠 것으로 되돌린다"가 아니고, 되돌리면 그 주에 플레이한
       게임의 보드 날짜가 함께 사라진다(ADR-0022 가 (−)로 안고 있던 함정).
     - 메타가 없으면 그 주에 항목이 이미 있었는지로 가른다. 있으면 이관된 과거 아카이브라
       확정(false) — 레거시 주를 열어 발행 없이 저장해도 보드 날짜가 안 사라진다(손실 0,
       결정 16). 비어 있으면 아직 아무도 안 짠 새 주라 초안(true). getWeekForEdit 이 편집기에
       주는 draft 와 같은 규칙이라, 화면이 보여 준 상태 그대로 저장된다. */
  const draft = input.published ? false : (existing?.draft ?? priorEntries.length === 0);

  /* ── 1단계: 청구(claim) ───────────────────────────────────────────────────────────
     revision 이 있으면 UPDATE … WHERE last_updated_at = revision(그 주가 안 바뀌었을 때만 매치),
     null 이면 INSERT … onConflictDoNothing(그 사이 아무도 안 만들었을 때만). 어느 쪽이든 0행이면
     그 사이 누가 손댄 것이라 CONFLICT.

     **두 경로 모두 published_at·note 를 청구 단계에서 안 건드린다** — 진짜 값은 항상 2단계
     batch 에서만 원자적으로 쓴다.
     - 기존 주(revision 있음): revision 만 단조 증가시킨다(round-4 에서 이렇게 닫았다).
     - 새/레거시 주(revision null): 한때 여기서 **의도한 메타(note·draft·published_at)를 그대로
       담아** 행을 만들었다("생성이지 변경이 아니니 안전하다"는 논리) — 그런데 그 논리가 놓친
       자리가 있다: 이 INSERT 뒤 0단계가 못 잡는 새 참조 무결성 위반(예: 프리검증 SELECT 와
       2단계 INSERT 사이에 다른 관리자가 참조 게임을 지움)으로 2단계가 실패하면, **이미 커밋된
       이 메타 행이 "발행됨·항목 0개"인 채로 남는다**(적대적 리뷰 3라운드가 실측 없이 추론으로
       잡은 자리 — 코드 경로만으로 성립하는 지적이라 타당하다).

       그래서 청구 행은 **"메타 행이 아예 없던 상태"와 정확히 같은 뜻**으로 채운다 — `note`·
       `publishedAt` 은 null(행이 없었으면 공지도 발행도 없었다), `draft` 는 `priorEntries.length
       === 0`(getWeekForEdit·보드의 `coalesce(draft,0)=0`과 같은 유도식 — 이관된 레거시 주(항목
       있음)는 false, 아직 아무도 안 짠 새 주는 true). **`draft` 를 무조건 `true`로 두면 안 되는
       이유**(4라운드 지적) — 레거시 주는 메타 행이 없어도 이미 보드에 날짜가 뜨고 있었는데
       (coalesce 가 행 없음을 draft=0 으로 접는다), 여기서 무조건 true 로 청구하면 2단계가
       실패했을 때 **그 순간만 보드에서 날짜가 사라진다** — 저장이 실패했을 뿐인데 이미 공개돼
       있던 데이터가 사라지는, 손실 0(결정 16)을 정확히 어기는 회귀다. 이 유도식을 쓰면 청구
       직후·2단계 실패 후 어느 시점에 봐도 "메타 행이 없다"고 봤을 때와 100% 같은 값이 보인다.
       의도한 실제 값(공지·발행 여부 포함)은 기존 주와 똑같이 2단계에서만 쓴다 — 2단계가
       실패해도 이 행은 이 placeholder 그대로 남아 아무것도 안 샌다. */
  const claimed =
    input.revision === null
      ? await db
          .insert(scheduleWeeks)
          .values({
            weekStartDate: input.weekStartDate,
            note: null,
            draft: priorEntries.length === 0,
            publishedAt: null,
          })
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
    .set({ note: input.note, draft, publishedAt })
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

/* 발행·비공개 전환만(이슈 #56 결정 14 개정, ADR-0024 2026-07-28 추가) — entries·note 를 안
   건드리므로 saveWeek 의 prevalidate→claim→batch 3단계가 필요 없다. 단일 원자 UPDATE 하나로
   revision CAS 와 published_at·draft 를 함께 바꾼다(D1 batch 조차 안 쓴다 — 문장이 하나라
   그 자체로 원자다).

   publishedAt 은 coalesce 로 **최초 발행 시각을 유지**한다 — SQL 이 이 컬럼의 old 값을 그대로
   보므로 별도 SELECT 없이 "재발행마다 안 바뀐다"(saveWeek 의 existing?.publishedAt ?? now 와
   같은 규칙)가 선다. draft 규칙도 saveWeek 과 동일하다 — 발행하면 확정(false), 비공개로
   돌리면 **손대지 않는다**(발행 철회가 "안 짠 것으로 되돌린다"가 아니다, ADR-0024).

   revision 이 그 사이 바뀌었으면(다른 곳에서 먼저 저장·발행) WHERE 가 0행이라 CONFLICT —
   saveWeek 의 1단계 claim 과 같은 CAS. */
export async function publishWeek(db: Db, input: PublishWeekInput): Promise<WeekView> {
  const now = Date.now();

  /* 발행(공개 전환)만 항목이 있어야 한다 — 비공개 전환은 반대 방향이라 이 검사가 없다
     (canUnpublish 와 같은 비대칭, schedule-save.machine.ts 주석). CAS 를 걸기 **전에** 본다 —
     빈 주 거절이 revision 을 안 건드려야 다음 정상 요청이 안 막힌다(saveWeek 의 prevalidate와
     같은 자리). */
  if (input.published) {
    const { monday, sunday } = weekBounds(input.weekStartDate);
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(scheduleEntries)
      .where(
        and(gte(scheduleEntries.scheduledDate, monday), lte(scheduleEntries.scheduledDate, sunday)),
      );
    if (!row || row.count === 0) throw new EmptyWeekCannotPublish();
  }

  const claimed = await db
    .update(scheduleWeeks)
    .set(
      input.published
        ? {
            publishedAt: sql`coalesce(${scheduleWeeks.publishedAt}, ${now})`,
            draft: false,
            lastUpdatedAt: nextRevision(input.revision, now),
          }
        : { publishedAt: null, lastUpdatedAt: nextRevision(input.revision, now) },
    )
    .where(
      and(
        eq(scheduleWeeks.weekStartDate, input.weekStartDate),
        eq(scheduleWeeks.lastUpdatedAt, input.revision),
      ),
    )
    .returning({ id: scheduleWeeks.id });
  if (claimed.length === 0) throw new WeekRevisionConflict();
  return getWeekForEdit(db, input.weekStartDate);
}
