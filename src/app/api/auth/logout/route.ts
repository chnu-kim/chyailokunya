/* 로그아웃(ADR-0017, Q12). 현재 기기(제시된 refresh 의 family)를 폐기하고 세션 쿠키를 지운다.
   다른 기기(다른 family)는 유지된다. POST 만 받는다 — SameSite=Lax + POST 로 CSRF 로 강제
   로그아웃되는 것을 막는다(GET 로그아웃 금지). access(15분 무상태)는 취소 못 해 쿠키 삭제로만
   끊고, 최대 15분 잔존 창이 남는다(설계상 불가피). */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { makeDb } from "@/db";
import { COOKIE_NAME } from "@/features/auth/config";
import { clearedCookieOptions } from "@/features/auth/cookies";
import { revokeSession } from "@/features/auth/refresh-service";

export async function POST(req: Request) {
  const { env } = getCloudflareContext();
  const origin = env.AUTH_URL ?? new URL(req.url).origin;
  const refresh = (await cookies()).get(COOKIE_NAME.refresh)?.value;
  if (refresh) await revokeSession(makeDb(env.DB), refresh, Date.now());

  const res = NextResponse.redirect(new URL("/", origin), { status: 303 });
  res.cookies.set(COOKIE_NAME.access, "", clearedCookieOptions());
  res.cookies.set(COOKIE_NAME.refresh, "", clearedCookieOptions());
  return res;
}
