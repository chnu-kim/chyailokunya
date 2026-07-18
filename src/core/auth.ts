/* 인증 세션의 순수 로직(ADR-0006·0014). HTTP·next-auth·DB 무관 — 부트스트랩 판정과 세션
   클레임 직렬화만 담아 단위테스트로 못박는다. next-auth 콜백(src/auth.ts)이 이 함수들을
   호출해 JWT 에 무엇을 싣고 무엇을 신뢰할지 결정한다. */

import { type Authority, isAuthority } from "./authorities";

/* SUPERADMIN_CHANNEL_ID 부트스트랩 판정. env 가 비었으면(미설정) 아무도 승격하지 않는다 —
   부트스트랩은 "정확히 이 channelId 의 최초 로그인"에만 일어나야 superadmin 증식·오승격이
   없다. env 값에 딸려오는 앞뒤 공백은 조여 비교한다(설정 실수로 조용히 어긋나지 않게). */
export function shouldBootstrapSuperadmin(
  channelId: string,
  superadminChannelId: string | undefined,
): boolean {
  const target = (superadminChannelId ?? "").trim();
  if (!target) return false;
  return channelId.trim() === target;
}

/* 세션 클레임 직렬화: Set → 정렬 배열. JWT 는 JSON 이라 Set 을 못 싣는다. 정렬로 클레임을
   결정적으로 만들어(권한 순서와 무관하게 같은 토큰) 스냅샷·비교를 안정화한다. */
export function authoritiesToClaim(a: ReadonlySet<Authority>): Authority[] {
  return [...a].sort();
}

/* JWT/세션에서 온 값을 Authority 집합으로 좁힌다. 서명돼 있어도 방어적으로 좁힌다(불변식 2):
   배열이 아니거나 null 이면 빈 집합, 원소는 AUTHORITIES 화이트리스트에 있는 것만 남긴다.
   미지·변조 문자열이 인가(authorizedProcedure)를 통과하지 못하게 하는 마지막 관문이다. */
export function parseAuthorities(v: unknown): Set<Authority> {
  const out = new Set<Authority>();
  if (!Array.isArray(v)) return out;
  for (const item of v) {
    if (isAuthority(item)) out.add(item);
  }
  return out;
}
