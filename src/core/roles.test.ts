import { describe, expect, it } from "vitest";
import { authoritiesFor } from "./authorities";
import { authorizeRoleChange } from "./roles";

// 상승 가드는 코드베이스의 보안 불변식이라 각 거절 분기를 개별 테스트로 못박는다.
const superadmin = authoritiesFor(["superadmin"]);
const admin = authoritiesFor(["admin"]);
const member = authoritiesFor([]);

describe("authorizeRoleChange", () => {
  it("superadmin 이 타인에게 admin 을 부여·회수하는 정상 경로는 허용", () => {
    for (const action of ["grant", "revoke"] as const) {
      const d = authorizeRoleChange({
        actorAuthorities: superadmin,
        actorChannelId: "chan-super",
        targetChannelId: "chan-target",
        role: "admin",
        action,
      });
      expect(d.ok).toBe(true);
    }
  });

  it("role:manage 가 없으면(member·admin) 거절 — 서버가 정본", () => {
    for (const actorAuthorities of [member, admin]) {
      const d = authorizeRoleChange({
        actorAuthorities,
        actorChannelId: "chan-actor",
        targetChannelId: "chan-target",
        role: "admin",
        action: "grant",
      });
      expect(d.ok).toBe(false);
    }
  });

  it("자기 자신의 역할 변경은 거절(자기 승격·자기 강등 락아웃 차단)", () => {
    const d = authorizeRoleChange({
      actorAuthorities: superadmin,
      actorChannelId: "chan-super",
      targetChannelId: " chan-super ", // 공백만 다른 같은 채널도 self 로 인정
      role: "admin",
      action: "grant",
    });
    expect(d.ok).toBe(false);
  });

  it("superadmin 역할은 API 로 부여·회수 불가(부트스트랩 전용)", () => {
    for (const action of ["grant", "revoke"] as const) {
      const d = authorizeRoleChange({
        actorAuthorities: superadmin,
        actorChannelId: "chan-super",
        targetChannelId: "chan-target",
        role: "superadmin",
        action,
      });
      expect(d.ok).toBe(false);
    }
  });
});
