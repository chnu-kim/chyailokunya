/* 서버 컴포넌트(nav·games)가 세션·권한을 읽는 헬퍼(ADR-0017). proxy 가 요청 진입점에서 access
   를 이미 갱신해 두므로, 여기선 access 쿠키를 EdDSA public key 로 검증해 신원을 얻는다(DB 0).
   권한은 UI 분기에 쓸 때만 조회한다(쓰기 버튼 노출은 편의 — 서버 tRPC 인가가 진짜 방어선).
   app 전용(cookies·getCloudflareContext)이라 features 가 아니라 app 에 둔다. */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { makeDb } from "@/db";
import { COOKIE_NAME } from "@/features/auth/config";
import { parseJwk } from "@/features/auth/keys";
import { listRolesForChannel } from "@/features/auth/service";
import { verifyAccessToken, type AccessClaims } from "@/features/auth/tokens";

export async function getServerActor(): Promise<AccessClaims | null> {
  // cookies() 를 **가장 먼저** 부른다. 이게 Next 에 "이 라우트는 동적"이라고 알리는 신호다 —
  // try 안에서 getCloudflareContext() 뒤에 두면 빌드 때 그쪽이 먼저 던지고 catch 가 삼켜,
  // / 와 /landing 이 비로그인 상태로 정적 프리렌더된다. 그러면 로그인해도 그 두 페이지의 nav 가
  // 영원히 "치지직 로그인"으로 굳는다(정적 HTML 이라 하이드레이션도 못 고친다).
  const access = (await cookies()).get(COOKIE_NAME.access)?.value;
  if (!access) return null;
  try {
    const { env } = getCloudflareContext();
    if (!env.JWT_PUBLIC_JWK) return null;
    return await verifyAccessToken([parseJwk(env.JWT_PUBLIC_JWK, "JWT_PUBLIC_JWK")], access);
  } catch {
    // 런타임 컨텍스트가 없는 경로(빌드 중 예외 등)에선 비로그인으로 렌더한다.
    return null;
  }
}

export async function getServerAuthorities(
  actor: AccessClaims | null,
): Promise<ReadonlySet<Authority>> {
  if (!actor) return new Set<Authority>();
  const { env } = getCloudflareContext();
  return authoritiesFor(await listRolesForChannel(makeDb(env.DB), actor.channelId));
}
