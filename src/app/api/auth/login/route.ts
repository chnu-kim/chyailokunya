/* 로그인 시작(ADR-0017). state(CSRF nonce)를 httpOnly 쿠키에 심고 치지직 account-interlock 으로
   302. 콜백이 쿼리 state 와 쿠키 state 를 대조해 위조 콜백을 막는다(이중 제출, DB 미사용 —
   공격자는 우리 httpOnly 쿠키를 못 심는다). 치지직 파라미터는 camelCase(clientId·redirectUri). */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { safeReturnTo } from "@/core/auth";
import { plantOauthStateCookie, plantReturnToCookie } from "@/features/auth/session-cookies";
import { KNOWN_PAGE_PATHS } from "@/features/routes";

export async function GET(req: Request) {
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
  /* 어디서 로그인을 눌렀는지를 여기서 **검증해서** 심는다 — 쿠키에 검증된 값만 들어가야
     "이 쿠키는 믿을 수 있다"가 성립한다. 검증 실패는 조용히 `/`(core.safeReturnTo).

     **`return_to` 가 없어도 반드시 심는다(무조건 덮어쓰기).** 기본값이면 안 심는 게 절약처럼
     보이지만 그러면 이런 일이 난다: `/games` 에서 로그인을 눌러 쿠키가 `/games` 로 심긴 뒤
     치지직 동의 화면에서 이탈 → 쿠키는 10분 산다 → `/` 로 돌아와 다시 로그인 → 조건부 심기면
     쿠키가 여전히 `/games` → 누른 적 없는 `/games` 로 착지한다. 매 로그인이 이전 시도의
     잔여를 덮는 것이 이 쿠키의 계약이다. */
  plantReturnToCookie(
    res,
    safeReturnTo(new URL(req.url).searchParams.get("return_to"), KNOWN_PAGE_PATHS),
  );
  return res;
}
