/* tRPC 루트(ADR-0004). 라우터 타입이 클라이언트로 그대로 흘러 별도 API 스키마 동기화가
   필요 없다. transformer 는 두지 않는다 — 우리 페이로드는 문자열·숫자(epoch ms)·null 뿐이라
   JSON 으로 무손실이고(Date 객체를 안 싣는다), superjson 의존을 아낀다(YAGNI). */

import { initTRPC, TRPCError } from "@trpc/server";
import type { Authority } from "@/core/authorities";
import type { Db } from "@/db";
import type { ChzzkCreds } from "@/features/chzzk-http";

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

/* 로그인만 요구한다 — authority 검사가 **없는 게 설계다**(ADR-0025).

   권한 단위(AUTHORITIES)는 "관리자가 부여하는 상승"의 어휘고, core/authorities.ts 는 상승 역할만
   저장하며 member 는 행 없는 암묵 기본값이라고 못박았다. 팬 제안은 상승이 아니라 **로그인의 기본
   대가**라, 여기에 authority 를 붙이려면 로그인마다 users_roles 에 아무 힘도 없는 행을 써야 하고
   그 순간 그 설계가 뒤집힌다. 얻는 것도 없다 — 모든 로그인 사용자가 가지는 권한은 "로그인했나"와
   같은 말이다.

   대가는 안다: 남용자 한 명의 제안 권한만 뺏을 자리가 없다. 그런 요구가 실제로 서면 그때 authority
   를 연다(ADR-0010 의 JIT) — 지금은 게임당 사람당 미처리 제안 1건(부분 UNIQUE)과 사람당 미처리
   총량 상한이 그 자리를 대신한다.

   actor 를 next 로 좁혀 넘긴다 — 다운스트림이 다시 null 검사를 하지 않아도 되고, "여긴 로그인이
   보장된다"가 타입으로 읽힌다(role/router.ts 가 방어로 한 번 더 검사하던 자리를 없앤다). */
export const authenticatedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.actor) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "로그인이 필요해요" });
  }
  return next({ ctx: { ...ctx, actor: ctx.actor } });
});
