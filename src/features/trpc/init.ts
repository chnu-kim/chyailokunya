/* tRPC 루트(ADR-0004). 라우터 타입이 클라이언트로 그대로 흘러 별도 API 스키마 동기화가
   필요 없다. transformer 는 두지 않는다 — 우리 페이로드는 문자열·숫자(epoch ms)·null 뿐이라
   JSON 으로 무손실이고(Date 객체를 안 싣는다), superjson 의존을 아낀다(YAGNI). */

import { initTRPC, TRPCError } from "@trpc/server";
import type { Authority } from "@/core/authorities";
import type { Db } from "@/db";
import type { ChzzkCreds } from "../chzzk/client";

/* tRPC 컨텍스트. authorities 는 세션의 effective 권한 집합이다(ADR-0014) — Phase 3 엔 인증이
   없어 route 가 빈 집합을 넣고, #6(인증)이 JWT 세션에서 채운다. 이 seam 덕에 쓰기 인가를
   HTTP·세션 없이 주입 컨텍스트로 단위테스트한다. chzzk 는 client_credentials(없으면 null). */
export type Context = {
  db: Db;
  authorities: ReadonlySet<Authority>;
  chzzk: ChzzkCreds | null;
};

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
// HTTP 없이 프로시저를 직접 부르는 caller(단위테스트·서버 컴포넌트가 주입 컨텍스트로 호출).
export const createCallerFactory = t.createCallerFactory;

/* 쓰기 인가는 서버가 정본이다(불변식 3). 권한 단위로 검사하고 없으면 FORBIDDEN — UI 버튼
   숨김은 편의일 뿐. 세션에 해당 authority 가 있어야 통과한다(member=빈 집합이라 전부 막힘). */
export function authorizedProcedure(authority: Authority) {
  return t.procedure.use(({ ctx, next }) => {
    if (!ctx.authorities.has(authority)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `권한이 필요해요: ${authority}` });
    }
    return next();
  });
}
