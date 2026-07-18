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
  const publicJwks = env.JWT_PUBLIC_JWK ? [parseJwk(env.JWT_PUBLIC_JWK, "JWT_PUBLIC_JWK")] : [];

  // access 유효 → 서명 검증만(DB 0) → 통과.
  const access = request.cookies.get(COOKIE_NAME.access)?.value;
  if (access && publicJwks.length && (await verifyAccessToken(publicJwks, access))) {
    return NextResponse.next();
  }

  // access 만료·부재. refresh 나 서명키가 없으면 비로그인으로 통과(공개 읽기는 무관).
  const refresh = request.cookies.get(COOKIE_NAME.refresh)?.value;
  if (!refresh || !env.JWT_SIGNING_JWK) return NextResponse.next();

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
