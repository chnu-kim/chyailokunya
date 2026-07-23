/* v1 데이터 모델(ADR-0014). 네 테이블 모두 surrogate 정수 PK — 이식성·외부 식별자 비노출
   ·균일 조인. enum 값은 core 상수(ROLES)에서 끌어와 타입·DB CHECK 가 한 원천을
   공유한다. 초기 마이그레이션엔 무결성 제약(PK·UNIQUE·CHECK·FK)만 넣는다 — 정렬·필터용
   성능 인덱스는 v1(<100행)에서 측정 불가라 검색 feature 이슈로 미룬다(ADR-0014). */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { ROLES } from "@/core/authorities";

/* 모든 타임스탬프는 epoch ms(정수)로 저장한다 — SQLite 엔 offsetDateTime/timestamptz 가
   없다. KST 는 표시 경계에서 Asia/Seoul 포매터로 보장한다(한국은 DST 없어 고정 +9).
   created_at/last_updated_at 은 앱이 단일 진실원으로 채운다($defaultFn/$onUpdate = Worker
   런타임 값) — "SQLite DEFAULT 는 UTC" 함정을 피한다. played_at/cleared_at 은 관리자
   입력값(과거 가능·nullable)이라 자동 생성이 아니다. */
const createdAt = () =>
  integer("created_at")
    .notNull()
    .$defaultFn(() => Date.now());
const lastUpdatedAt = () =>
  integer("last_updated_at")
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdate(() => Date.now());

/* 내부 신원 앵커. OAuth 결합도 0 — 다른 로그인 수단이 붙어도 이 테이블은 안 바뀐다.
   표시명은 여기가 아니라 oauth_accounts.channel_name 에 있다(제공자가 준 값이라 그쪽이 제자리).
   ADR-0014 는 "표시명은 DB 아님 → 세션에만"이었지만 ADR-0017 이 뒤집었다: refresh 회전 때
   access 를 재서명하려면 표시명이 필요한데 치지직 토큰을 안 들고 있어 재조회가 불가능하다. */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: createdAt(),
  lastUpdatedAt: lastUpdatedAt(),
});

/* 로그인 수단 1개 = 1행. users 1 : N. 치지직 토큰(access/refresh)은 저장하지 않는다(ADR-0006):
   로그인 1회 신원확인 후 자체 JWT 로 넘어간다. provider_user_id 는 치지직 channelId(안정
   식별자)이자 자연키 — UNIQUE(provider, provider_user_id)로 재연결·중복 로그인을 막고
   로그인 조회 핫패스를 인덱스 없이도 커버한다. channel_name 은 표시명 스냅샷(로그인 시 갱신):
   access(15분)가 만료돼 proxy 가 refresh 로 새 access 를 서명할 때 표시명이 필요한데, 치지직
   토큰이 없어 재조회가 불가하므로 여기 캐시한다(rotation 이 신원을 재구성할 수 있게). */
export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["chzzk"] }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    channelName: text("channel_name"),
    createdAt: createdAt(),
    lastUpdatedAt: lastUpdatedAt(),
  },
  (t) => [
    unique().on(t.provider, t.providerUserId),
    // enum 옵션은 타입만 좁힌다 — DB 도 보증하도록 CHECK 를 겹쳐 둔다(확장 대비).
    check("oauth_accounts_provider", sql`${t.provider} IN ('chzzk')`),
  ],
);

/* 역할 "부여(grant)" M:N. 상승 역할(admin·superadmin)만 저장한다 — member 는 암묵 기본값
   (행 없음). PK(user_id, role)가 중복 부여를 막고 인가 핫패스를 커버한다. role → authority
   매핑은 DB 가 아니라 src/core 코드 상수다(ADR-0014). */
export const usersRoles = sqliteTable(
  "users_roles",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.role] }),
    check("users_roles_role", sql`${t.role} IN ('admin', 'superadmin')`),
  ],
);

/* 역할 변경 감사(ADR-0012·0014·0018). 사람 주도 역할 부여·회수를 남긴다 — 누가(actor)
   누구에게(target) 무슨 역할을 grant/revoke 했나. 부트스트랩(SUPERADMIN_CHANNEL_ID)은 env
   로부터 재구성 가능해 기록하지 않는다(ADR-0014). append-only 로그라 수정·삭제가 없어
   last_updated_at 이 없다(created_at 만). surrogate PK·epoch ms·enum CHECK 겹침은 다른
   테이블과 같은 컨벤션. action 은 로컬 리터럴, role 은 core ROLES 를 단일 원천으로 끌어온다. */
export const roleAuditLogs = sqliteTable(
  "role_audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorUserId: integer("actor_user_id")
      .notNull()
      .references(() => users.id),
    targetUserId: integer("target_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action", { enum: ["grant", "revoke"] }).notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("role_audit_logs_action", sql`${t.action} IN ('grant', 'revoke')`),
    check("role_audit_logs_role", sql`${t.role} IN ('admin', 'superadmin')`),
  ],
);

/* 게임 보드(ADR-0015). 치지직 category API 스냅샷을 denormalize 해 공개 읽기가 외부 API·
   인증에 무관하게 한다.

   플레이 날짜의 정본은 더 이상 여기에 없다 — 일정(schedule_entries)이 정본이고 보드의
   "언제 플레이했나"는 그 항목들의 MAX(scheduled_date)로 유도한다(이슈 #56 결정 3·17,
   ADR-0019 보강). 그래서 played_at 컬럼을 드롭했다: 같은 게임을 여러 날 플레이한 편성
   ("월·화 젤다")이 컬럼 하나로는 표현 불가였고, 일정에 항목이 여럿 서면 공짜로 담긴다.

   클리어는 게임 자체의 사실이라 여기 남는다(플레이 날짜와 달리 편성에 묶이지 않는다).
   cleared_at → cleared_date 로 이름을 바꾸고 cleared 플래그를 더했다 — "깼는데 날짜 모름"
   (실데이터에 있다: 할로우 나이트)을 표현하려면 플래그가 날짜와 독립이어야 하기 때문이다.
   CHECK(cleared = 1 OR cleared_date IS NULL) 로 "안 깼는데 클리어 날짜가 있는" 모순만 막고,
   깬 채 날짜가 null 인 건 허용한다. 클리어 = cleared 플래그(cleared_date 유무가 아니다 —
   그 둘을 동일시하면 날짜 모르는 클리어가 표현 불가로 되돌아간다).

   cleared_date 는 정수 epoch 가 아니라 text 'YYYY-MM-DD' 다: 시각이 아니라 달력의 하루라
   타임존이 개입하면 KST 자정 근처에서 하루가 밀린다(core/games.ts·AGENTS.md 명명 규약).
   사전순 = 시간순이라 ORDER BY 도 그대로 선다.

   category_id 는 nullable — 치지직 검색에 없는 게임을 손으로 넣을 수 있어야 한다(그땐
   외부 키가 없다). UNIQUE 는 유지한다: SQLite 는 NULL 중복을 허용하므로 "한 치지직
   카테고리 = 보드 1회"는 그대로 서고 수동 입력만 제약 밖으로 빠진다.

   삭제는 하드 삭제(deleted_at 없음) — 확인 다이얼로그가 파괴 **전**에 멈추므로 서버에 닿은
   삭제는 이미 의도된 삭제고 되돌릴 대상이 없다(ADR-0020 이 "지연 커밋이라 영속할 필요 없다"는
   옛 근거를 대체했다). 소프트 삭제를 안 쓰는 이유는 그대로다: v1 에 복구 휴지통·삭제 감사
   요구가 없는데 모든 조회가 WHERE deleted_at IS NULL 을 영구히 지불한다. */
export const games = sqliteTable(
  "games",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryId: text("category_id").unique(),
    categoryType: text("category_type", { enum: ["GAME"] }).notNull(),
    categoryValue: text("category_value").notNull(),
    posterImageUrl: text("poster_image_url"),
    // boolean 모드 — 0/1 로 저장하되 타입은 boolean 으로 흐른다. 아래 CHECK 는 SQL 값(0/1)을
    // 본다. 클리어 여부의 정본이라 not null·기본 false(새 게임은 아직 안 깬 상태).
    cleared: integer("cleared", { mode: "boolean" }).notNull().default(false),
    clearedDate: text("cleared_date"),
    createdAt: createdAt(),
    lastUpdatedAt: lastUpdatedAt(),
  },
  (t) => [
    check("games_category_type", sql`${t.categoryType} = 'GAME'`),
    // 안 깬 게임에 클리어 날짜가 붙는 모순만 막는다. cleared=1·date=null(날짜 모름)은 허용.
    check("games_cleared_date", sql`${t.cleared} = 1 OR ${t.clearedDate} IS NULL`),
  ],
);

/* 방송 일정 정본(이슈 #56). 캘린더와 주간표는 이 항목들을 월/주로 그린 두 뷰다 — 동기화
   코드가 필요 없다(애초에 하나라서, 결정 1). 게임 플레이 날짜도 여기서 유도한다(결정 3):
   game_id 있는 항목이 곧 "그 게임을 그날 했다".

   scheduled_date 는 "달력의 하루"라 text 'YYYY-MM-DD'(순간이 아니다 — AGENTS.md 명명 규약,
   games.cleared_date 와 같은 근거). 주(week)는 저장하지 않고 이 날짜에서 유도한다(결정 2,
   core/calendar.weekStartOf) — 항목에 week_id FK 를 두면 날짜와 어긋난 주가 저장 가능해진다.
   start_time 은 'HH:MM' KST 라벨이고 nullable(시각 미정 편성 허용, 결정 8). 하루에 항목이
   여럿 설 수 있다(UNIQUE 없음 — "오후 저챗 + 밤 게임"을 그대로).

   game_id → games.id ON DELETE SET NULL: 게임을 보드에서 떼도 그날 방송이 있었다는 사실은
   남는다(항목은 자유 제목 title 로 자립한다). 항목 종류 컬럼은 두지 않는다(결정 9) —
   game_id 유무 + 자유 title 로 충분하고, 종류가 필요해지면 그때 연다(ADR-0010 JIT).
   성능 인덱스는 v1(<100행)에서 미룬다(ADR-0014). */
export const scheduleEntries = sqliteTable("schedule_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scheduledDate: text("scheduled_date").notNull(),
  startTime: text("start_time"),
  title: text("title").notNull(),
  gameId: integer("game_id").references(() => games.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  lastUpdatedAt: lastUpdatedAt(),
});

/* 주 메타(이슈 #56 결정 2·13). 주 자체는 날짜에서 유도하므로(schedule_entries 참조) 이
   테이블엔 항목이 안 들어간다 — 한 주에 딸린 부가 정보(공지 한 줄·발행 시각)만 든다.
   week_start_date 는 그 주의 월요일 'YYYY-MM-DD'(core/calendar.weekStartOf 로 정규화)이고
   UNIQUE — 한 주 = 한 메타 행.

   published_at 은 nullable 순간(epoch ms). null = "짜는 중"이라 미완성 주간표가 og 카드로
   박제되지 않는다(결정 13). 발행 경계가 게임 보드의 날짜 유도에도 걸리는지는 일정 쓰기가
   서는 작업순서 4 에서 결정한다 — 지금은 이 테이블에 행을 넣는 코드가 없어(스키마만) 유예가
   안전하다(발행 필터를 지금 걸면 이관된 과거 항목이 주 메타가 없어 보드에서 사라진다). */
export const scheduleWeeks = sqliteTable("schedule_weeks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weekStartDate: text("week_start_date").notNull().unique(),
  note: text("note"),
  publishedAt: integer("published_at"),
  createdAt: createdAt(),
  lastUpdatedAt: lastUpdatedAt(),
});

/* 자체 세션 refresh 토큰(ADR-0017). access 는 stateless(EdDSA JWT, DB 무관)라 여기 없다 —
   refresh 만 서버가 정본으로 들고 rotation·재사용 감지·revoke 를 한다. 원본은 저장하지 않고
   sha256 해시만(DB 유출 시 재사용 방지). family_id 는 로그인 1회(디바이스) 단위 rotation 체인,
   family_expires_at 은 sliding 위의 절대 상한(첫 로그인 + 90일, rotation 시 승계).
   무효화가 두 종류다: superseded_at = 회전으로 대체됨(후계 있음 — grace 내 재사용은 정상 동시 탭),
   revoked_at = 세션 폐기(로그아웃·도난 — 재사용 절대 불가). 둘을 하나로 합치면 로그아웃 직후
   grace 창에서 폐기된 토큰이 되살아난다. 유효 = 둘 다 NULL.
   후계 원본은 **저장하지 않는다.** grace 내 재사용에 같은 후계를 멱등 반환해야 동시 탭이 수렴하지만
   (새로 찍으면 도둑이 무제한 증식해 도난 탐지가 무력화된다), 그 값을 컬럼에 두면 *현재 활성*
   토큰의 평문이 DB 에 남는다 — 초판이 그렇게 했다가 적대적 리뷰에 배포 차단으로 걸렸다. 지금은
   구 토큰에서 서버 비밀로 재계산한다(tokens.deriveSuccessorToken). append/무효화만이라
   last_updated_at 없음.
   인덱스는 rotation 조회 핫패스(family_id·user_id)에 필요하다. */
export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: text("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    familyExpiresAt: integer("family_expires_at").notNull(),
    supersededAt: integer("superseded_at"),
    revokedAt: integer("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("refresh_tokens_family_id").on(t.familyId),
    index("refresh_tokens_user_id").on(t.userId),
  ],
);

/* 보안 이벤트 감사(ADR-0017). 지금은 refresh 도난 감지(reuse-theft)만 남긴다 — 도난은 유일한
   침해 신호라 console.warn 휘발 로그로 흘리지 않고 지속 저장한다(누가·언제 당했나 사후 질의).
   role_audit_logs 는 action IN('grant','revoke')·actor/target NOT NULL 구조라 재사용 불가해
   별도 테이블을 둔다. append-only. */
export const securityEvents = sqliteTable("security_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  familyId: text("family_id"),
  eventType: text("event_type", { enum: ["refresh_reuse"] }).notNull(),
  createdAt: createdAt(),
});

// 스키마가 타입의 정본이다(ADR-0004): 여기서 흐른 타입이 features·tRPC·Zod 로 이어진다.
export type User = typeof users.$inferSelect;
export type OauthAccount = typeof oauthAccounts.$inferSelect;
export type UserRole = typeof usersRoles.$inferSelect;
export type RoleAuditLog = typeof roleAuditLogs.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type SecurityEvent = typeof securityEvents.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type NewGameRow = typeof games.$inferInsert;
export type ScheduleEntry = typeof scheduleEntries.$inferSelect;
export type NewScheduleEntry = typeof scheduleEntries.$inferInsert;
export type ScheduleWeek = typeof scheduleWeeks.$inferSelect;
export type NewScheduleWeek = typeof scheduleWeeks.$inferInsert;
