/* 자동 access 갱신(ADR-0017). Next16 proxy(구 middleware — Node 런타임. OpenNext 는 엣지
   미지원이라 D1·jose 가 여기서 돈다). access 가 유효하면 서명 검증만 하고 통과(DB 0). 만료·부재면
   refresh 로 rotation 해 새 access·refresh 를 세팅하고, 같은 요청의 다운스트림(RSC·route·tRPC)이
   갱신된 access 를 읽도록 request.cookies 를 덮어 forward 한다(안 그러면 이번 요청은 옛 쿠키를
   본다). refresh 실패(도난·만료)면 세션 쿠키를 걷고 비로그인으로 통과(공개 읽기는 계속). matcher
   로 정적 에셋·/api/auth(자체 쿠키 세팅)는 제외한다. */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { makeDb } from "@/db";
import { COOKIE_NAME } from "@/features/auth/config";
import {
  accessCookieOptions,
  clearedCookieOptions,
  refreshCookieOptions,
} from "@/features/auth/cookies";
import { parseJwk } from "@/features/auth/keys";
import { refreshSession } from "@/features/auth/session";
import { verifyAccessToken } from "@/features/auth/tokens";

export const config = {
  matcher: ["/((?!_next/|api/auth/|assets/|favicon|icon).*)"],
};

export async function proxy(request: NextRequest) {
  const { env } = await getCloudflareContext({ async: true });
  // 키는 쌍으로만 의미가 있다. public 만 빠지면 access 검증이 **영원히 실패**해 모든 요청이
  // 회전 분기로 떨어진다 — 요청마다 refresh 행이 늘고 세션이 안착하지 못한다. 한쪽만 있는
  // 설정은 오설정이므로 세션 기능 자체를 끈 비로그인으로 통과시킨다(fail-closed, 조용한 폭주 금지).
  if (!env.JWT_PUBLIC_JWK || !env.JWT_SIGNING_JWK) return NextResponse.next();
  const publicJwks = [parseJwk(env.JWT_PUBLIC_JWK, "JWT_PUBLIC_JWK")];

  // access 유효 → 서명 검증만(DB 0) → 통과.
  const access = request.cookies.get(COOKIE_NAME.access)?.value;
  if (access && (await verifyAccessToken(publicJwks, access))) {
    return NextResponse.next();
  }

  // access 만료·부재. refresh 가 없으면 비로그인으로 통과(공개 읽기는 무관).
  const refresh = request.cookies.get(COOKIE_NAME.refresh)?.value;
  if (!refresh) return NextResponse.next();

  const db = makeDb(env.DB);
  const privateJwk = parseJwk(env.JWT_SIGNING_JWK, "JWT_SIGNING_JWK");
  const next = await refreshSession(db, privateJwk, refresh, Date.now());

  if (!next) {
    // 도난·만료 refresh → 세션 쿠키를 걷고 비로그인으로 통과.
    const res = NextResponse.next();
    res.cookies.set(COOKIE_NAME.access, "", clearedCookieOptions());
    res.cookies.set(COOKIE_NAME.refresh, "", clearedCookieOptions());
    return res;
  }

  // 갱신 성공 → 다운스트림이 이번 요청에서 새 access 를 읽도록 request 쿠키를 덮어 forward.
  request.cookies.set(COOKIE_NAME.access, next.access);
  const res = NextResponse.next({ request });
  res.cookies.set(COOKIE_NAME.access, next.access, accessCookieOptions());
  res.cookies.set(COOKIE_NAME.refresh, next.refresh, refreshCookieOptions());
  return res;
}
