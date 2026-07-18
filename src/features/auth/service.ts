/* 인증·인가 데이터 유즈케이스(tRPC 무관 순수 db 연산 — games/service.ts 와 같은 결). next-auth
   콜백(src/auth.ts)과 역할 라우터(router.ts)가 재사용한다. 신원 upsert·역할 조회는 로그인
   콜백이, grant/revoke·감사는 role 뮤테이션이 부른다. 상승 가드 판정은 여기가 아니라 순수
   core(roles.ts)가 한다 — 이 파일은 그 판정을 통과한 뒤의 DB 쓰기만 맡는다. */

import { and, eq } from "drizzle-orm";
import { isRole, type Role } from "@/core/authorities";
import { oauthAccounts, roleAuditLogs, users, usersRoles, type Db } from "@/db";

// oauth_accounts.provider 는 현재 치지직뿐(CHECK 'chzzk'). 모든 조회의 provider 축.
const PROVIDER = "chzzk" as const;

async function findUserIdByChannel(db: Db, channelId: string): Promise<number | null> {
  const rows = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, PROVIDER), eq(oauthAccounts.providerUserId, channelId)))
    .limit(1);
  return rows.length ? rows[0]!.userId : null;
}

/* 로그인 시 신원 upsert. oauth_accounts(provider, provider_user_id=channelId)로 기존 사용자를
   찾고 없으면 users→oauth_accounts 를 만든다(users↔oauth 분리, ADR-0014 — users 는 빈 앵커).
   UNIQUE(provider, provider_user_id)가 동시 최초 로그인 경합에서 중복 oauth 를 막는다: 삽입이
   충돌하면 우리가 진 것이라 재조회로 먼저 넣은 쪽 userId 에 수렴한다(우리가 만든 고아 users
   행은 v1 에서 무해). 트랜잭션 대신 UNIQUE + 재조회로 원자성 없이 정합을 얻는다. */
export async function upsertChzzkAccount(db: Db, channelId: string): Promise<{ userId: number }> {
  const existing = await findUserIdByChannel(db, channelId);
  if (existing !== null) return { userId: existing };

  const [u] = await db.insert(users).values({}).returning({ id: users.id });
  const userId = u!.id;
  try {
    await db
      .insert(oauthAccounts)
      .values({ userId, provider: PROVIDER, providerUserId: channelId });
  } catch (e) {
    const raced = await findUserIdByChannel(db, channelId);
    if (raced !== null) return { userId: raced };
    throw e;
  }
  return { userId };
}

// 역할 뮤테이션 타깃 해석. 로그인 이력 없는 channelId 는 null → 라우터가 NOT_FOUND 로 맵.
export function resolveUserIdByChannel(db: Db, channelId: string): Promise<number | null> {
  return findUserIdByChannel(db, channelId);
}

/* channelId 의 부여 역할. oauth_accounts→users_roles 조인. DB 문자열은 스키마 CHECK 로 이미
   보증되지만 타입 경계를 코드로도 지켜 isRole 로 좁힌다(신뢰하지 않는 입력 원칙). jwt 콜백이
   이 역할들을 authoritiesFor 에 넣어 세션의 effective authorities 를 만든다. */
export async function listRolesForChannel(db: Db, channelId: string): Promise<Role[]> {
  const rows = await db
    .select({ role: usersRoles.role })
    .from(usersRoles)
    .innerJoin(oauthAccounts, eq(usersRoles.userId, oauthAccounts.userId))
    .where(and(eq(oauthAccounts.provider, PROVIDER), eq(oauthAccounts.providerUserId, channelId)));
  return rows.map((r) => r.role).filter(isRole);
}

/* 부트스트랩 승격(멱등). shouldBootstrapSuperadmin(core)이 참일 때만 호출된다. PK(user_id,role)
   가 중복 부여를 막으므로 이미 superadmin 이면 조용히 무시한다. 재로그인마다 불려도 안전. */
export async function ensureSuperadmin(db: Db, userId: number): Promise<void> {
  await db.insert(usersRoles).values({ userId, role: "superadmin" }).onConflictDoNothing();
}

// 역할 부여(멱등). 상승 가드는 core.authorizeRoleChange 가 라우터에서 먼저 판정한다.
export async function grantRole(db: Db, userId: number, role: Role): Promise<void> {
  await db.insert(usersRoles).values({ userId, role }).onConflictDoNothing();
}

// 역할 회수(멱등). 없는 부여를 지워도 무해.
export async function revokeRole(db: Db, userId: number, role: Role): Promise<void> {
  await db.delete(usersRoles).where(and(eq(usersRoles.userId, userId), eq(usersRoles.role, role)));
}

export type RoleAuditEntry = {
  actorUserId: number;
  targetUserId: number;
  action: "grant" | "revoke";
  role: Role;
};

// 감사 기록(append-only, ADR-0018). 모든 사람 주도 역할 변경을 남긴다 — 뮤테이션이 DB 쓰기와
// 함께 부른다(같은 요청). created_at 은 스키마가 자동으로 채운다(epoch ms).
export async function writeRoleAudit(db: Db, entry: RoleAuditEntry): Promise<void> {
  await db.insert(roleAuditLogs).values(entry);
}
