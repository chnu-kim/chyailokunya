/* v1 데이터 모델(ADR-0014). 네 테이블 모두 surrogate 정수 PK — 이식성·외부 식별자 비노출
   ·균일 조인. enum 값은 core 상수(STATUS_KEYS·ROLES)에서 끌어와 타입·DB CHECK 가 한 원천을
   공유한다. 초기 마이그레이션엔 무결성 제약(PK·UNIQUE·CHECK·FK)만 넣는다 — 정렬·필터용
   성능 인덱스는 v1(<100행)에서 측정 불가라 검색 feature 이슈로 미룬다(ADR-0014). */

import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { ROLES } from "@/core/authorities";
import { STATUS_KEYS } from "@/core/games";

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
   표시명(치지직 channelName)은 DB 가 아니라 JWT 세션에만 둔다: 다른 유저를 화면에
   노출하지 않는 v1 에선 이름을 DB 에서 조회할 일이 없다. */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: createdAt(),
  lastUpdatedAt: lastUpdatedAt(),
});

/* 로그인 수단 1개 = 1행. users 1 : N. 토큰(access/refresh)은 저장하지 않는다(ADR-0006):
   로그인 1회 신원확인 후 자체 JWT 로 넘어간다. provider_user_id 는 치지직 channelId(안정
   식별자)이자 자연키 — UNIQUE(provider, provider_user_id)로 재연결·중복 로그인을 막고
   로그인 조회 핫패스를 인덱스 없이도 커버한다. */
export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider", { enum: ["chzzk"] }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
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

/* 치지직 카테고리 스냅샷 보드(ADR-0015). category API 4필드를 denormalize 해 공개 읽기가
   외부 API·인증에 무관하게 한다. status·played_at·cleared_at 은 치지직이 주지 않는 우리
   도메인(플레이 상태·이력): 둘 다 null=예정 / played_at만=플레이중·플레이함 / cleared_at
   까지=클리어. 삭제는 하드 삭제(deleted_at 없음) — 되돌리기는 클라이언트 지연 커밋이라
   서버에 삭제 상태를 영속시킬 필요가 없다. */
export const games = sqliteTable(
  "games",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryId: text("category_id").notNull().unique(),
    categoryType: text("category_type", { enum: ["GAME"] }).notNull(),
    categoryValue: text("category_value").notNull(),
    posterImageUrl: text("poster_image_url"),
    status: text("status", { enum: STATUS_KEYS }).notNull().default("played"),
    playedAt: integer("played_at"),
    clearedAt: integer("cleared_at"),
    createdAt: createdAt(),
    lastUpdatedAt: lastUpdatedAt(),
  },
  (t) => [
    check("games_category_type", sql`${t.categoryType} = 'GAME'`),
    check("games_status", sql`${t.status} IN ('playing', 'cleared', 'planned', 'played')`),
  ],
);

// 스키마가 타입의 정본이다(ADR-0004): 여기서 흐른 타입이 features·tRPC·Zod 로 이어진다.
export type User = typeof users.$inferSelect;
export type OauthAccount = typeof oauthAccounts.$inferSelect;
export type UserRole = typeof usersRoles.$inferSelect;
export type RoleAuditLog = typeof roleAuditLogs.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type NewGameRow = typeof games.$inferInsert;
