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
  try {
    const { env } = getCloudflareContext();
    const access = (await cookies()).get(COOKIE_NAME.access)?.value;
    if (!access || !env.JWT_PUBLIC_JWK) return null;
    return await verifyAccessToken([parseJwk(env.JWT_PUBLIC_JWK, "JWT_PUBLIC_JWK")], access);
  } catch {
    // build 의 static prerender(예: /_not-found)엔 런타임 컨텍스트(getCloudflareContext)가 없다 —
    // 비로그인으로 렌더한다. 실제 요청에선 컨텍스트가 있어 세션을 정상적으로 읽는다.
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
