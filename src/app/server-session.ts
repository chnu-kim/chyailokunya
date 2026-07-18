/* app 레이어의 세션 읽기 정본(ADR-0017). proxy 가 요청 진입점에서 access 를 이미 갱신해 두므로,
   여기선 access 쿠키를 EdDSA public key 로 검증해 신원을 얻는다(DB 0). 권한은 인가·UI 분기에 쓸
   때만 조회한다(쓰기 버튼 노출은 편의 — 서버 tRPC 인가가 진짜 방어선).

   서버 컴포넌트와 tRPC 컨텍스트가 **같은 함수를 쓴다.** 전에는 tRPC 라우트가 이 절차를 따로
   구현했고, 그 사본엔 아래 cookies()-우선 방어가 없어 이미 갈라져 있었다. 세션 읽기 규칙(쿠키명·
   키 라벨·키 부재 처리·클레임 모양)이 한 곳에만 살아야 다음 변경이 한쪽만 고치는 사고를 막는다.

   app 전용(cookies·getCloudflareContext)이라 features 가 아니라 app 에 둔다. */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { cache } from "react";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { makeDb, type Db } from "@/db";
import { COOKIE_NAME } from "@/features/auth/config";
import { parseJwk } from "@/features/auth/keys";
import { listRolesForChannel } from "@/features/auth/service";
import { verifyAccessToken, type AccessClaims } from "@/features/auth/tokens";

/* 요청 스코프 메모이즈(react cache) — 한 렌더에서 layout 과 page 가 각각 부른다. 없으면 쿠키
   읽기 + JWK 파싱 + Ed25519 검증이 통째로 두 벌 돈다. */
export const getServerActor = cache(async (): Promise<AccessClaims | null> => {
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
});

/* 역할 → 권한 파생. UI 분기(버튼 노출)와 서버 인가가 **같은 함수에서** 파생돼야 불변식 3
   ("UI 는 편의, 서버가 정본")이 성립한다 — 규칙이 갈라지면 "보이는데 누르면 FORBIDDEN"이 난다. */
export async function authoritiesForActor(
  db: Db,
  actor: { channelId: string } | null,
): Promise<ReadonlySet<Authority>> {
  if (!actor) return new Set<Authority>();
  return authoritiesFor(await listRolesForChannel(db, actor.channelId));
}

export async function getServerAuthorities(
  actor: AccessClaims | null,
): Promise<ReadonlySet<Authority>> {
  const { env } = getCloudflareContext();
  return authoritiesForActor(makeDb(env.DB), actor);
}
