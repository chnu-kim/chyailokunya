import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authoritiesFor } from "@/core/authorities";
import { makeDb, roleAuditLogs } from "@/db";
import { createCallerFactory, type Context, type SessionActor } from "@/features/trpc/init";
import { appRouter } from "@/features/router";
import { listRolesForChannel, upsertChzzkAccount } from "./service";

/* 역할 관리의 서버 권위를 caller 로 증명한다(HTTP·세션 없이 주입 컨텍스트). 상승 가드는
   authorizedProcedure("role:manage") + authorizeRoleChange 두 겹이라 각 거절 경로를 못박는다. */

const createCaller = createCallerFactory(appRouter);
const superadmin = authoritiesFor(["superadmin"]); // role:manage 포함
const admin = authoritiesFor(["admin"]); // role:manage 없음

function makeCtx(authorities: ReadonlySet<string>, actor: SessionActor | null): Context {
  return {
    db: makeDb(env.DB),
    authorities: authorities as Context["authorities"],
    chzzk: null,
    actor,
  };
}

// superadmin actor 를 만들고 그 컨텍스트를 돌려준다(자기 자신은 못 바꾸니 target 은 따로 둔다).
async function seedSuperadminActor(channelId = "chan-super"): Promise<SessionActor> {
  const { userId } = await upsertChzzkAccount(makeDb(env.DB), channelId);
  return { channelId, userId };
}

describe("role.grant / role.revoke (서버 권위)", () => {
  it("role:manage 없으면(member·admin) FORBIDDEN — 1차 방어선", async () => {
    for (const authorities of [authoritiesFor([]), admin]) {
      const caller = createCaller(makeCtx(authorities, { channelId: "chan-x", userId: 1 }));
      await expect(
        caller.role.grant({ channelId: "chan-target", role: "admin" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("superadmin 이 타인에게 admin 부여 → users_roles 행 + 감사 로그", async () => {
    const actor = await seedSuperadminActor();
    await upsertChzzkAccount(makeDb(env.DB), "chan-target");
    const caller = createCaller(makeCtx(superadmin, actor));

    expect(await caller.role.grant({ channelId: "chan-target", role: "admin" })).toEqual({
      ok: true,
    });
    expect(await listRolesForChannel(makeDb(env.DB), "chan-target")).toEqual(["admin"]);

    const audits = await makeDb(env.DB).select().from(roleAuditLogs);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: actor.userId,
      action: "grant",
      role: "admin",
    });
  });

  it("revoke 로 admin 회수 → 역할 사라지고 감사 2건", async () => {
    const actor = await seedSuperadminActor();
    const { userId: targetId } = await upsertChzzkAccount(makeDb(env.DB), "chan-target");
    const caller = createCaller(makeCtx(superadmin, actor));

    await caller.role.grant({ channelId: "chan-target", role: "admin" });
    await caller.role.revoke({ channelId: "chan-target", role: "admin" });
    expect(await listRolesForChannel(makeDb(env.DB), "chan-target")).toEqual([]);
    void targetId;
    expect(await makeDb(env.DB).select().from(roleAuditLogs)).toHaveLength(2);
  });

  it("자기 자신의 역할 변경은 FORBIDDEN(자기 승격 차단)", async () => {
    const actor = await seedSuperadminActor();
    const caller = createCaller(makeCtx(superadmin, actor));
    await expect(
      caller.role.grant({ channelId: actor.channelId, role: "admin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("superadmin 역할은 API 로 부여 불가(부트스트랩 전용) — FORBIDDEN", async () => {
    const actor = await seedSuperadminActor();
    await upsertChzzkAccount(makeDb(env.DB), "chan-target");
    const caller = createCaller(makeCtx(superadmin, actor));
    await expect(
      caller.role.grant({ channelId: "chan-target", role: "superadmin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("로그인 이력 없는 channelId 는 NOT_FOUND", async () => {
    const actor = await seedSuperadminActor();
    const caller = createCaller(makeCtx(superadmin, actor));
    await expect(
      caller.role.grant({ channelId: "chan-ghost", role: "admin" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("channelId 공백만이면 입력 검증(BAD_REQUEST)에서 막힌다", async () => {
    const actor = await seedSuperadminActor();
    const caller = createCaller(makeCtx(superadmin, actor));
    await expect(caller.role.grant({ channelId: "   ", role: "admin" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
