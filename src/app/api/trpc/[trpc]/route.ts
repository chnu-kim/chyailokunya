/* tRPC HTTP 경계(fetch 어댑터, ADR-0017). app 은 조립 지점이라 여기서 요청 스코프의 D1 바인딩·
   시크릿과 세션을 꺼내 컨텍스트를 만든다. access 쿠키를 EdDSA public key 로 검증해 actor 를
   세우고, authorities 는 인가 순간에만 DB 조회한다(authoritiesOf, 메모이즈) — 강등 즉시 반영·
   공개 읽기 DB 0. 로그인 안 했거나 권한 없으면 공개 읽기(list)만 통과하고 나머지는 FORBIDDEN
   (서버 권위는 caller 단위테스트로 증명). */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { makeDb } from "@/db";
import { COOKIE_NAME } from "@/features/auth/config";
import { isAllowedOrigin } from "@/features/auth/csrf";
import { parseJwk } from "@/features/auth/keys";
import { listRolesForChannel } from "@/features/auth/service";
import { verifyAccessToken } from "@/features/auth/tokens";
import { appRouter } from "@/features/router";
import type { Context } from "@/features/trpc/init";

async function createContext(): Promise<Context> {
  const { env } = getCloudflareContext();
  const db = makeDb(env.DB);

  const access = (await cookies()).get(COOKIE_NAME.access)?.value;
  const publicJwks = env.JWT_PUBLIC_JWK ? [parseJwk(env.JWT_PUBLIC_JWK, "JWT_PUBLIC_JWK")] : [];
  const claims = access && publicJwks.length ? await verifyAccessToken(publicJwks, access) : null;
  const actor = claims ? { userId: claims.userId, channelId: claims.channelId } : null;

  // 인가 순간에만 역할을 조회한다(요청 스코프 메모이즈). 공개 읽기는 안 불러 DB 왕복 0.
  let cached: ReadonlySet<Authority> | undefined;
  const authoritiesOf = async (): Promise<ReadonlySet<Authority>> => {
    if (cached) return cached;
    cached = actor
      ? authoritiesFor(await listRolesForChannel(db, actor.channelId))
      : new Set<Authority>();
    return cached;
  };

  return {
    db,
    actor,
    authoritiesOf,
    chzzk:
      env.CHZZK_CLIENT_ID && env.CHZZK_CLIENT_SECRET
        ? { clientId: env.CHZZK_CLIENT_ID, clientSecret: env.CHZZK_CLIENT_SECRET }
        : null,
  };
}

function handler(req: Request): Promise<Response> {
  // 상태를 바꾸는 요청은 Origin 이 우리 것일 때만 받는다(CSRF). GET 은 tRPC v11 기본값상
  // 뮤테이션을 태우지 못하므로(allowMethodOverride=false) 검사 대상이 아니다.
  if (req.method !== "GET") {
    const { env } = getCloudflareContext();
    if (!isAllowedOrigin(req.headers.get("origin"), env.AUTH_URL)) {
      return Promise.resolve(new Response("forbidden origin", { status: 403 }));
    }
  }
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
  });
}

export { handler as GET, handler as POST };
