/* next-auth 세션 타입 보강(ADR-0017). 우리 세션은 표시명·안정 식별자(userId·channelId)와
   effective authorities 를 싣는다 — 인가는 role 이 아니라 authorities 로 판단한다(ADR-0014).
   channelId·userId 는 optional: 로그인 세션은 jwt 콜백이 채우지만 타입 시스템은 그 불변식을
   모르므로 소비측(route·page)이 방어적으로 읽는다.

   Session 만 보강한다 — next-auth 는 Session 을 자체 interface 로 선언해 declare module 병합이
   닿지만, JWT 는 @auth/core/jwt 를 re-export 라 같은 방식이 안 닿는다. 그래서 JWT 클레임은
   src/auth.ts 의 jwt/session 콜백에서 로컬 타입으로 읽고 쓴다(JWT 는 Record<string,unknown>
   기반이라 쓰기는 통과, 읽기만 캐스팅). 파일은 src/auth.ts 의 "짝 선언 파일"로 오인되지
   않도록 types/ 아래 둔다 — src/auth.d.ts 로 두면 보강이 조용히 무시된다. */

import type { DefaultSession } from "next-auth";
import type { Authority } from "@/core/authorities";

declare module "next-auth" {
  interface Session {
    authorities: Authority[];
    user: {
      channelId?: string;
      userId?: number;
    } & DefaultSession["user"];
  }
}
