/* 로그인 시작(ADR-0017). state(CSRF nonce)를 httpOnly 쿠키에 심고 치지직 account-interlock 으로
   302. 콜백이 쿼리 state 와 쿠키 state 를 대조해 위조 콜백을 막는다(이중 제출, DB 미사용 —
   공격자는 우리 httpOnly 쿠키를 못 심는다). 치지직 파라미터는 camelCase(clientId·redirectUri). */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { plantOauthStateCookie } from "@/features/auth/session-cookies";

export async function GET() {
  const { env } = getCloudflareContext();
  if (!env.CHZZK_CLIENT_ID || !env.AUTH_URL) {
    return new NextResponse("로그인이 아직 설정되지 않았어요", { status: 503 });
  }
  const state = crypto.randomUUID();
  const authUrl = new URL("https://chzzk.naver.com/account-interlock");
  authUrl.searchParams.set("clientId", env.CHZZK_CLIENT_ID);
  /* 경로 끝의 `/chzzk` 는 치지직 콘솔에 **등록된 redirect URI 와 완전 일치**해야 하는 값이다 —
     다르면 동의 화면에서 403 이 난다(실제로 그렇게 막혔다). provider 를 경로에 새기는 형태라
     oauth_accounts.provider 로 다중 로그인 수단을 대비한 스키마(ADR-0014)와도 맞다. 바꾸려면
     콘솔 등록값을 먼저 바꿔야 한다. */
  authUrl.searchParams.set("redirectUri", `${env.AUTH_URL}/api/auth/callback/chzzk`);
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl);
  plantOauthStateCookie(res, state);
  return res;
}
