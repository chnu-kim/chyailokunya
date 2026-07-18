/* tRPC HTTP 경계(fetch 어댑터). app 은 조립 지점이라 여기서 요청 스코프의 D1 바인딩과
   시크릿을 꺼내 컨텍스트를 만든다. authorities 는 지금 빈 집합이다 — 인증(#6)이 JWT 세션에서
   effective authorities 를 채우면 쓰기가 점등한다. 그 전까지 공개 읽기(list)만 통과하고,
   쓰기(add·remove)·카테고리 검색은 FORBIDDEN 이다(서버 권위는 단위테스트로 증명). */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { makeDb } from "@/db";
import { appRouter } from "@/features/router";
import type { Context } from "@/features/trpc/init";

function createContext(): Context {
  const { env } = getCloudflareContext();
  return {
    db: makeDb(env.DB),
    authorities: new Set(),
    chzzk:
      env.CHZZK_CLIENT_ID && env.CHZZK_CLIENT_SECRET
        ? { clientId: env.CHZZK_CLIENT_ID, clientSecret: env.CHZZK_CLIENT_SECRET }
        : null,
  };
}

function handler(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
  });
}

export { handler as GET, handler as POST };
