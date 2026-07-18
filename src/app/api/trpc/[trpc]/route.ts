/* tRPC HTTP 경계(fetch 어댑터). app 은 조립 지점이라 여기서 요청 스코프의 D1 바인딩·시크릿과
   세션을 꺼내 컨텍스트를 만든다. auth()로 JWT 세션을 읽어 effective authorities 를 채우면
   쓰기(add·remove·카테고리 검색)가 점등한다 — 로그인 안 했거나 권한 없으면 공개 읽기(list)만
   통과하고 나머지는 FORBIDDEN(서버 권위는 caller 단위테스트로 증명). authorities 는 서명된
   세션이라도 parseAuthorities 로 방어적으로 좁힌다(불변식 2). */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";
import { parseAuthorities } from "@/core/auth";
import { makeDb } from "@/db";
import { appRouter } from "@/features/router";
import type { Context } from "@/features/trpc/init";

async function createContext(): Promise<Context> {
  const { env } = getCloudflareContext();
  const session = await auth();
  // actor 는 로그인 주체 — 상승 가드 self 판정에 쓴다. userId·channelId 가 둘 다 있어야(로그인
  // 세션) 구성한다.
  const actor =
    session?.user?.userId != null && session.user.channelId
      ? { channelId: session.user.channelId, userId: session.user.userId }
      : null;
  return {
    db: makeDb(env.DB),
    authorities: parseAuthorities(session?.authorities),
    actor,
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
