/* tRPC HTTP 경계(fetch 어댑터, ADR-0017). app 은 조립 지점이라 여기서 요청 스코프의 D1 바인딩·
   시크릿과 세션을 꺼내 컨텍스트를 만든다. access 쿠키를 EdDSA public key 로 검증해 actor 를
   세우고, authorities 는 인가 순간에만 DB 조회한다(authoritiesOf, 메모이즈) — 강등 즉시 반영·
   공개 읽기 DB 0. 로그인 안 했거나 권한 없으면 공개 읽기(list)만 통과하고 나머지는 FORBIDDEN
   (서버 권위는 caller 단위테스트로 증명). */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Authority } from "@/core/authorities";
import { makeDb } from "@/db";
import { rejectCrossSiteFetch, rejectForeignOrigin } from "@/features/auth/request-guard";
import { credsFromEnv } from "@/features/chzzk-http";
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
    chzzk: credsFromEnv(env.CHZZK_CLIENT_ID, env.CHZZK_CLIENT_SECRET),
  };
}

function handler(req: Request): Promise<Response> {
  // 크로스사이트는 **GET(쿼리)도** 막는다 — Origin 은 same-origin GET 에 안 실려 GET 표면은
  // Sec-Fetch-Site 로 닫는다(왜 두 겹인지는 request-guard 주석이 정본).
  const crossSite = rejectCrossSiteFetch(req);
  if (crossSite) return Promise.resolve(crossSite);

  // 상태를 바꾸는 요청은 Origin 이 우리 것일 때만 받는다(CSRF).
  if (req.method !== "GET") {
    const { env } = getCloudflareContext();
    const denied = rejectForeignOrigin(req, env.AUTH_URL);
    if (denied) return Promise.resolve(denied);
  }
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
    /* 실패를 로그로 남긴다. 이게 없어서 프로덕션의 games.add 400 을 `wrangler tail` 로
       진단할 수 없었다 — Worker 관점에선 tRPC 에러도 정상 응답(Ok)이라 요청 줄만 찍히고
       이유가 아무 데도 안 남는다.

       **입력값은 찍지 않는다.** 우리 쓰기 입력은 로그인한 사용자의 것이라 개인정보로
       이어질 수 있고, 진단에 필요한 건 "어느 필드가 왜 걸렸나"지 값 자체가 아니다.
       BAD_REQUEST 는 Zod 이슈의 path·code 만 추린다(message 에는 값이 섞여 들어온다). */
    onError({ error, path, type }) {
      const zod = error.cause as { issues?: { path: (string | number)[]; code: string }[] } | null;
      const issues = zod?.issues?.map((i) => i.path.join(".") + ":" + i.code).join(", ");
      console.error(
        `[trpc] ${type} ${path ?? "<no-path>"} ${error.code}` + (issues ? ` — ${issues}` : ""),
      );
    },
  });
}

export { handler as GET, handler as POST };
