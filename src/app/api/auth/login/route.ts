/* 로그인 시작(ADR-0017). state(CSRF nonce)를 httpOnly 쿠키에 심고 치지직 account-interlock 으로
   302. 콜백이 쿼리 state 와 쿠키 state 를 대조해 위조 콜백을 막는다(이중 제출, DB 미사용 —
   공격자는 우리 httpOnly 쿠키를 못 심는다). 치지직 파라미터는 camelCase(clientId·redirectUri). */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/features/auth/config";
import { stateCookieOptions } from "@/features/auth/cookies";

export async function GET() {
  const { env } = getCloudflareContext();
  if (!env.CHZZK_CLIENT_ID || !env.AUTH_URL) {
    return new NextResponse("로그인이 아직 설정되지 않았어요", { status: 503 });
  }
  const state = crypto.randomUUID();
  const authUrl = new URL("https://chzzk.naver.com/account-interlock");
  authUrl.searchParams.set("clientId", env.CHZZK_CLIENT_ID);
  authUrl.searchParams.set("redirectUri", `${env.AUTH_URL}/api/auth/callback`);
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(COOKIE_NAME.state, state, stateCookieOptions());
  return res;
}
