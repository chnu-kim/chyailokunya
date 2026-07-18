/* tRPC 루트(ADR-0004). 라우터 타입이 클라이언트로 그대로 흘러 별도 API 스키마 동기화가
   필요 없다. transformer 는 두지 않는다 — 우리 페이로드는 문자열·숫자(epoch ms)·null 뿐이라
   JSON 으로 무손실이고(Date 객체를 안 싣는다), superjson 의존을 아낀다(YAGNI). */

import { initTRPC, TRPCError } from "@trpc/server";
import type { Authority } from "@/core/authorities";
import type { Db } from "@/db";
import type { ChzzkCreds } from "../chzzk/client";

/* tRPC 컨텍스트(ADR-0017). actor 는 로그인 주체(channelId·userId, access JWT 에서 검증) — 비로그인
   이면 null. authoritiesOf 는 인가가 필요한 순간에만 역할을 DB 조회한다(access 엔 authorities 를
   싣지 않아 강등이 즉시 반영된다). 요청 스코프 메모이즈라 한 요청에 여러 authorizedProcedure 가
   있어도 조회는 1회, 공개 읽기는 안 불러 DB 왕복 0. 이 seam 으로 인가를 HTTP·세션 없이 주입
   컨텍스트로 단위테스트한다. chzzk 는 client_credentials(없으면 null). */
export type SessionActor = { channelId: string; userId: number };

export type Context = {
  db: Db;
  actor: SessionActor | null;
  authoritiesOf: () => Promise<ReadonlySet<Authority>>;
  chzzk: ChzzkCreds | null;
};

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
// HTTP 없이 프로시저를 직접 부르는 caller(단위테스트·서버 컴포넌트가 주입 컨텍스트로 호출).
export const createCallerFactory = t.createCallerFactory;

/* 쓰기 인가는 서버가 정본이다(불변식 3). 권한 단위로 검사하고 없으면 FORBIDDEN — UI 버튼
   숨김은 편의일 뿐. 인가 순간에 authoritiesOf()로 현재 역할을 조회해 검사한다(강등 즉시 반영). */
export function authorizedProcedure(authority: Authority) {
  return t.procedure.use(async ({ ctx, next }) => {
    const authorities = await ctx.authoritiesOf();
    if (!authorities.has(authority)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `권한이 필요해요: ${authority}` });
    }
    return next();
  });
}
