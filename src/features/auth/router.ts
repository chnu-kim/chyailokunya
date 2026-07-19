/* 역할 관리 tRPC 라우터(ADR-0012·0018). 관리 UI 는 v1 에 없다 — 서버 뮤테이션만 두고 상승
   가드·감사를 서버가 정본으로 강제한다(불변식 3). authorizedProcedure("role:manage")가 1차
   방어선(superadmin 만 통과), 그 뒤 순수 규칙 authorizeRoleChange 가 self·superadmin 부여를
   막는다. 통과하면 역할을 쓰고 감사 로그를 남긴다 — 같은 요청에서. */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ROLES } from "@/core/authorities";
import { authorizeRoleChange } from "@/core/roles";
import { authorizedProcedure, router, type Context } from "../trpc/init";
import { grantRoleWithAudit, resolveUserIdByChannel, revokeRoleWithAudit } from "./service";

// 입력은 신뢰하지 않는다: channelId trim·비어있음 거절, role 은 저장되는 역할(admin·superadmin)만.
// superadmin 입력은 Zod 를 통과하지만 authorizeRoleChange 가 부트스트랩 전용이라 막는다.
// .max(64) — 치지직 channelId(UUID 계열) 실측보다 여유 있는 상한. 감사 로그·DB 컬럼에
// 그대로 쌓이므로 상한 없이는 초대형 문자열이 감사 테이블을 부풀릴 수 있다.
const roleChangeInput = z.object({
  channelId: z.string().trim().min(1).max(64),
  role: z.enum(ROLES),
});

async function applyRoleChange(
  ctx: Context,
  input: z.infer<typeof roleChangeInput>,
  action: "grant" | "revoke",
) {
  // authorizedProcedure("role:manage")가 이미 통과해 actor 존재가 보장되지만, 타입·방어로 확인.
  if (!ctx.actor) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "로그인이 필요해요" });
  }
  const decision = authorizeRoleChange({
    actorAuthorities: await ctx.authoritiesOf(),
    actorChannelId: ctx.actor.channelId,
    targetChannelId: input.channelId,
    role: input.role,
    action,
  });
  if (!decision.ok) {
    throw new TRPCError({ code: "FORBIDDEN", message: decision.reason });
  }

  const targetUserId = await resolveUserIdByChannel(ctx.db, input.channelId);
  if (targetUserId === null) {
    // 로그인 이력이 있어야 users 행이 있다 — 없는 사람에겐 역할을 부여할 대상이 없다.
    throw new TRPCError({ code: "NOT_FOUND", message: "로그인 이력이 없는 사용자예요" });
  }

  // 역할 변경과 감사를 원자적으로(batch) — 감사 없이 역할만 바뀌는 상태를 막는다(ADR-0018).
  const entry = { actorUserId: ctx.actor.userId, targetUserId, action, role: input.role };
  if (action === "grant") await grantRoleWithAudit(ctx.db, entry);
  else await revokeRoleWithAudit(ctx.db, entry);
  return { ok: true as const };
}

export const roleRouter = router({
  grant: authorizedProcedure("role:manage")
    .input(roleChangeInput)
    .mutation(({ ctx, input }) => applyRoleChange(ctx, input, "grant")),

  revoke: authorizedProcedure("role:manage")
    .input(roleChangeInput)
    .mutation(({ ctx, input }) => applyRoleChange(ctx, input, "revoke")),
});
