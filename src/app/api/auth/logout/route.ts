/* 로그아웃(ADR-0017, Q12). 현재 기기(제시된 refresh 의 family)를 폐기하고 세션 쿠키를 지운다.
   다른 기기(다른 family)는 유지된다. POST + **Origin 검증**만 받는다 — POST·SameSite 만으로는
   강제 로그아웃이 막히지 않는다: 크로스사이트 폼 POST 는 쿠키가 안 실려 DB 폐기는 건너뛰지만
   응답의 Set-Cookie(삭제)는 그대로 적용돼 피해자가 조용히 로그아웃된다. Origin 이 우리 것일
   때만 처리해 그 경로를 끊는다. access(15분 무상태)는 취소 못 해 쿠키 삭제로만 끊고, 최대
   15분 잔존 창이 남는다(설계상 불가피). */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { makeDb } from "@/db";
import { COOKIE_NAME } from "@/features/auth/config";
import { clearedCookieOptions } from "@/features/auth/cookies";
import { isAllowedOrigin } from "@/features/auth/csrf";
import { revokeSession } from "@/features/auth/refresh-service";

export async function POST(req: Request) {
  const { env } = getCloudflareContext();
  // AUTH_URL 부재 시 login 은 503 인데 여기만 Host 헤더로 폴백하면, Host 를 통제할 수 있는
  // 경로에서 리다이렉트 대상이 조작된다. 세 라우트 모두 fail-closed 로 통일한다.
  if (!env.AUTH_URL) return new NextResponse("AUTH_URL 미설정", { status: 503 });
  if (!isAllowedOrigin(req.headers.get("origin"), env.AUTH_URL)) {
    return new NextResponse("forbidden origin", { status: 403 });
  }
  const origin = env.AUTH_URL;
  const refresh = (await cookies()).get(COOKIE_NAME.refresh)?.value;
  if (refresh) await revokeSession(makeDb(env.DB), refresh, Date.now());

  const res = NextResponse.redirect(new URL("/", origin), { status: 303 });
  res.cookies.set(COOKIE_NAME.access, "", clearedCookieOptions());
  res.cookies.set(COOKIE_NAME.refresh, "", clearedCookieOptions());
  return res;
}
