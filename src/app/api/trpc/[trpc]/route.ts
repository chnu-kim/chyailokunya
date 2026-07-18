/* tRPC HTTP 경계(fetch 어댑터, ADR-0017). app 은 조립 지점이라 여기서 요청 스코프의 D1 바인딩·
   시크릿과 세션을 꺼내 컨텍스트를 만든다. access 쿠키를 EdDSA public key 로 검증해 actor 를
   세우고, authorities 는 인가 순간에만 DB 조회한다(authoritiesOf, 메모이즈) — 강등 즉시 반영·
   공개 읽기 DB 0. 로그인 안 했거나 권한 없으면 공개 읽기(list)만 통과하고 나머지는 FORBIDDEN
   (서버 권위는 caller 단위테스트로 증명). */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Authority } from "@/core/authorities";
import { makeDb } from "@/db";
import { isAllowedOrigin } from "@/features/auth/csrf";
import { appRouter } from "@/features/router";
import type { Context } from "@/features/trpc/init";
import { authoritiesForActor, getServerActor } from "../../../server-session";

async function createContext(): Promise<Context> {
  const { env } = getCloudflareContext();
  const db = makeDb(env.DB);

  // 세션 읽기는 server-session 이 정본이다 — 여기서 따로 구현하면 쿠키명·키 라벨·키 부재 처리가
  // 조용히 갈라진다(실제로 갈라져 있었다).
  const claims = await getServerActor();
  const actor = claims ? { userId: claims.userId, channelId: claims.channelId } : null;

  // 인가 순간에만 역할을 조회한다(요청 스코프 메모이즈). 공개 읽기는 안 불러 DB 왕복 0.
  let cached: ReadonlySet<Authority> | undefined;
  const authoritiesOf = async (): Promise<ReadonlySet<Authority>> =>
    (cached ??= await authoritiesForActor(db, actor));

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
  /* 크로스사이트 요청은 **GET(쿼리)도** 막는다. GET 은 뮤테이션을 태우지 못하지만
     (tRPC v11 allowMethodOverride=false) 쿠키를 업고 인가된 쿼리를 크로스사이트에서 트리거할 수
     있다 — 응답은 SOP 로 못 읽어도 부수효과와 외부 API 쿼터(chzzk 카테고리 검색)는 남는다.
     Origin 으로는 못 막는다: 브라우저가 same-origin GET 엔 Origin 을 안 실어 준다. 그래서 GET
     표면은 Sec-Fetch-Site 로 닫는다(모던 브라우저가 항상 보낸다). 헤더가 없는 옛 브라우저는
     이 겹을 못 받지만, 쓰기는 아래 Origin 검사와 SameSite 가 계속 막는다. */
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return Promise.resolve(new Response("forbidden origin", { status: 403 }));
  }

  // 상태를 바꾸는 요청은 Origin 이 우리 것일 때만 받는다(CSRF).
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
