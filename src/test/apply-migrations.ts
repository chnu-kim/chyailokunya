import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";
import {
  games,
  makeDb,
  oauthAccounts,
  refreshTokens,
  roleAuditLogs,
  securityEvents,
  users,
  usersRoles,
} from "@/db";

/* 각 테스트 파일의 저장소에 스키마를 세운다 — 구조만, 데이터는 없다(ADR-0014: 시드는
   마이그레이션이 아니라 별도 스크립트라 테스트 DB 에 안 섞인다). TEST_MIGRATIONS 는
   vitest.config 이 readD1Migrations 로 읽어 miniflare 바인딩으로 주입한다. */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

/* 이 풀(0.18)은 테스트 간 쓰기를 자동으로 되돌리지 않는다(pool 옵션에 isolatedStorage 가
   없다). 결정성을 위해 매 테스트 전에 데이터만 비운다 — 스키마는 위 마이그레이션이 세운
   채로 둔다. FK 상 자식(oauth_accounts·users_roles·role_audit_logs·refresh_tokens)을 users 보다 먼저 지운다. */
beforeEach(async () => {
  const db = makeDb(env.DB);
  await db.delete(oauthAccounts);
  await db.delete(usersRoles);
  await db.delete(roleAuditLogs);
  await db.delete(refreshTokens);
  await db.delete(securityEvents);
  await db.delete(games);
  await db.delete(users);
});
