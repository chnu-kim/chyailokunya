import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { makeDb, roleAuditLogs } from "@/db";
import {
  ensureSuperadmin,
  getIdentity,
  grantRoleWithAudit,
  listRolesForChannel,
  resolveUserIdByChannel,
  superadminExists,
  revokeRoleWithAudit,
  upsertChzzkAccount,
} from "./service";

/* D1(env.DB) 위에서 신원 upsert·역할·감사를 검증한다 — apply-migrations 가 매 테스트 전에
   빈 스키마로 되돌린다(setupFiles). tRPC 무관 순수 db 함수라 caller 없이 직접 부른다. */

const db = () => makeDb(env.DB);

describe("upsertChzzkAccount", () => {
  it("같은 channelId 로 두 번 로그인해도 같은 userId, users 1행(멱등)", async () => {
    const first = await upsertChzzkAccount(db(), "chan-a");
    const second = await upsertChzzkAccount(db(), "chan-a");
    expect(second.userId).toBe(first.userId);
    expect(await resolveUserIdByChannel(db(), "chan-a")).toBe(first.userId);
  });

  it("다른 channelId 는 다른 userId", async () => {
    const a = await upsertChzzkAccount(db(), "chan-a");
    const b = await upsertChzzkAccount(db(), "chan-b");
    expect(b.userId).not.toBe(a.userId);
  });

  it("로그인 이력 없는 channelId 는 resolve 가 null", async () => {
    expect(await resolveUserIdByChannel(db(), "nope")).toBeNull();
  });

  it("channelName 을 저장하고 재로그인 시 갱신한다(access 재구성용 스냅샷)", async () => {
    const { userId } = await upsertChzzkAccount(db(), "chan-a", "쿠냐");
    expect(await getIdentity(db(), userId)).toEqual({ channelId: "chan-a", channelName: "쿠냐" });
    await upsertChzzkAccount(db(), "chan-a", "쿠냐냥"); // 재로그인, 표시명 변경
    expect(await getIdentity(db(), userId)).toEqual({ channelId: "chan-a", channelName: "쿠냐냥" });
  });

  it("getIdentity 는 로그인 이력 없는 userId 에 null", async () => {
    expect(await getIdentity(db(), 9999)).toBeNull();
  });
});

describe("grantRoleWithAudit / revokeRoleWithAudit (원자적 batch)", () => {
  it("grant 는 역할과 감사를 함께 쓴다", async () => {
    const actor = await upsertChzzkAccount(db(), "chan-super");
    const target = await upsertChzzkAccount(db(), "chan-t");
    await grantRoleWithAudit(db(), {
      actorUserId: actor.userId,
      targetUserId: target.userId,
      action: "grant",
      role: "admin",
    });
    expect(await listRolesForChannel(db(), "chan-t")).toEqual(["admin"]);
    expect(await db().select().from(roleAuditLogs)).toHaveLength(1);
  });

  it("revoke 는 역할 제거와 감사를 함께 쓴다", async () => {
    const actor = await upsertChzzkAccount(db(), "chan-super");
    const target = await upsertChzzkAccount(db(), "chan-t");
    await grantRoleWithAudit(db(), {
      actorUserId: actor.userId,
      targetUserId: target.userId,
      action: "grant",
      role: "admin",
    });
    await revokeRoleWithAudit(db(), {
      actorUserId: actor.userId,
      targetUserId: target.userId,
      action: "revoke",
      role: "admin",
    });
    expect(await listRolesForChannel(db(), "chan-t")).toEqual([]);
    expect(await db().select().from(roleAuditLogs)).toHaveLength(2);
  });
});

describe("역할 부여·회수·조회", () => {
  it("초기 역할은 없음(member = 빈 배열)", async () => {
    await upsertChzzkAccount(db(), "chan-a");
    expect(await listRolesForChannel(db(), "chan-a")).toEqual([]);
  });

  it("ensureSuperadmin 은 멱등 — 두 번 불러도 superadmin 1행", async () => {
    const { userId } = await upsertChzzkAccount(db(), "chan-super");
    await ensureSuperadmin(db(), userId);
    await ensureSuperadmin(db(), userId);
    expect(await listRolesForChannel(db(), "chan-super")).toEqual(["superadmin"]);
  });

  /* 부트스트랩 가드. 콜백은 shouldBootstrapSuperadmin && !superadminExists 일 때만 승격한다 —
     이 가드가 없으면 회수된 superadmin 이 다음 로그인에 감사 없이 부활해, "회수는 즉시·지속"
     (ADR-0017)이 최고 권한에서만 거짓이 된다. */
  it("superadminExists 가 부트스트랩을 한 번으로 묶는다 — 회수 후엔 재승격되지 않는다", async () => {
    const { userId } = await upsertChzzkAccount(db(), "chan-super");
    expect(await superadminExists(db())).toBe(false); // 최초 실행: 부트스트랩이 돈다
    await ensureSuperadmin(db(), userId);
    expect(await superadminExists(db())).toBe(true); // 이후 로그인은 가드에 막힌다

    await revokeRoleWithAudit(db(), {
      actorUserId: userId,
      targetUserId: userId,
      action: "revoke",
      role: "superadmin",
    });
    // 회수됐으면 가드가 다시 열린다 — 마지막 superadmin 이 사라진 경우의 자력 복구.
    expect(await superadminExists(db())).toBe(false);
  });

  it("부여 후 조회되고(멱등), 회수하면 사라진다", async () => {
    const { userId } = await upsertChzzkAccount(db(), "chan-a");
    const entry = { actorUserId: userId, targetUserId: userId, role: "admin" } as const;
    await grantRoleWithAudit(db(), { ...entry, action: "grant" });
    expect(await listRolesForChannel(db(), "chan-a")).toEqual(["admin"]);
    await grantRoleWithAudit(db(), { ...entry, action: "grant" }); // 멱등
    expect(await listRolesForChannel(db(), "chan-a")).toEqual(["admin"]);
    await revokeRoleWithAudit(db(), { ...entry, action: "revoke" });
    expect(await listRolesForChannel(db(), "chan-a")).toEqual([]);
  });

  it("한 채널의 역할만 조회한다(조인이 채널을 가른다)", async () => {
    const a = await upsertChzzkAccount(db(), "chan-a");
    const b = await upsertChzzkAccount(db(), "chan-b");
    await grantRoleWithAudit(db(), {
      actorUserId: a.userId,
      targetUserId: a.userId,
      action: "grant",
      role: "admin",
    });
    await ensureSuperadmin(db(), b.userId);
    expect(await listRolesForChannel(db(), "chan-a")).toEqual(["admin"]);
    expect(await listRolesForChannel(db(), "chan-b")).toEqual(["superadmin"]);
  });
});

describe("역할 감사", () => {
  it("역할 변경이 감사 행을 append 한다", async () => {
    const actor = await upsertChzzkAccount(db(), "chan-super");
    const target = await upsertChzzkAccount(db(), "chan-target");
    await grantRoleWithAudit(db(), {
      actorUserId: actor.userId,
      targetUserId: target.userId,
      action: "grant",
      role: "admin",
    });
    const rows = await db().select().from(roleAuditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: actor.userId,
      targetUserId: target.userId,
      action: "grant",
      role: "admin",
    });
    expect(typeof rows[0]!.createdAt).toBe("number");
  });
});
