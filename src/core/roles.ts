/* 역할 변경 인가 규칙(순수, ADR-0012·0014). HTTP·DB·세션 무관 — 정책만 담아 테스트로
   못박는다. 역할 시스템의 흔한 세 구멍을 절차가 아니라 규칙으로 구조화해 닫는다:
   (1) 권한 없는 자의 변경, (2) 자기 자신 조작(자기 승격·마지막 superadmin 자기 강등),
   (3) superadmin 을 API 로 부여·회수. 서버 뮤테이션(features/auth/router)이 쓰기 전에
   이 판정을 먼저 통과시킨다. */

import { type Authority, hasAuthority, type Role } from "./authorities";

export type RoleChange = {
  actorAuthorities: ReadonlySet<Authority>;
  actorChannelId: string;
  targetChannelId: string;
  role: Role;
  action: "grant" | "revoke";
};

// deny 는 이유(한국어)를 실어 호출측이 그대로 FORBIDDEN 메시지로 쓴다.
export type RoleChangeDecision = { ok: true } | { ok: false; reason: string };

export function authorizeRoleChange(input: RoleChange): RoleChangeDecision {
  // role:manage 는 superadmin 만 가진다(authorities.ts). admin 은 여기서 이미 막힌다 —
  // admin 이 다른 admin 을 임명·강등하지 못하는 상승 가드가 매핑에서 흘러온다.
  if (!hasAuthority(input.actorAuthorities, "role:manage")) {
    return { ok: false, reason: "역할을 관리할 권한이 없어요" };
  }
  // 자기 자신의 역할은 못 바꾼다 — 자기 승격과 마지막 superadmin 의 자기 강등(락아웃)을
  // 한 규칙으로 닫는다. actor·target 은 같은 좌표계(치지직 channelId)라 직접 비교한다.
  if (input.actorChannelId.trim() === input.targetChannelId.trim()) {
    return { ok: false, reason: "자기 자신의 역할은 바꿀 수 없어요" };
  }
  // superadmin 은 API 로 부여·회수하지 않는다 — 오직 SUPERADMIN_CHANNEL_ID 부트스트랩으로만
  // 존재한다. API 로 열면 superadmin 증식·마지막 superadmin 제거가 가능해진다.
  if (input.role === "superadmin") {
    return { ok: false, reason: "superadmin 은 부트스트랩(SUPERADMIN_CHANNEL_ID)으로만 부여돼요" };
  }
  return { ok: true };
}
