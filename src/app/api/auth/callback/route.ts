/* 치지직 OAuth 콜백(ADR-0017). state 이중제출 검증 → 코드 교환 → 신원 조회 → users/oauth
   upsert(+표시명 스냅샷) → 부트스트랩 → 자체 세션(access+refresh 쿠키) 발급 → /games 리다이렉트.
   치지직 토큰은 신원확인 1회에만 쓰고 버린다(저장 안 함, ADR-0006). 어떤 실패든 /?login=failed
   로 안전하게 되돌린다(내부 오류를 노출하지 않는다). */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { shouldBootstrapSuperadmin } from "@/core/auth";
import { makeDb } from "@/db";
import { exchangeCodeForTokens, fetchChzzkUser } from "@/features/auth/chzzk-api";
import { COOKIE_NAME } from "@/features/auth/config";
import {
  accessCookieOptions,
  clearedCookieOptions,
  refreshCookieOptions,
} from "@/features/auth/cookies";
import { parseJwk } from "@/features/auth/keys";
import { ensureSuperadmin, upsertChzzkAccount } from "@/features/auth/service";
import { issueSession, type SessionTokens } from "@/features/auth/session";

export async function GET(req: Request) {
  const { env } = getCloudflareContext();
  const url = new URL(req.url);
  // AUTH_URL 부재 시 url.origin(=Host 헤더)으로 폴백하면 리다이렉트 대상이 요청자에게 좌우된다.
  // login 이 이미 503 으로 막으므로 여기도 fail-closed 로 맞춘다.
  if (!env.AUTH_URL) return new NextResponse("AUTH_URL 미설정", { status: 503 });
  const origin = env.AUTH_URL;
  // 실패해도 state 쿠키를 걷는다 — 남겨 두면 같은 nonce 로 TTL(10분) 내내 콜백을 재시도할 수
  // 있어 "state = 일회용" 속성이 코드로 지켜지지 않는다.
  const fail = () => {
    const res = NextResponse.redirect(new URL("/?login=failed", origin));
    res.cookies.set(COOKIE_NAME.state, "", clearedCookieOptions());
    return res;
  };

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = (await cookies()).get(COOKIE_NAME.state)?.value;

  // CSRF: 쿼리 state 와 쿠키 state 대조. 공격자는 우리 httpOnly 쿠키를 못 심으므로 위조 콜백이 막힌다.
  if (!code || !state || !savedState || state !== savedState) return fail();
  // 공개키도 함께 요구한다 — 서명키만 있으면 세션 쿠키는 발급되지만 검증자(proxy·서버 컴포넌트
  // ·tRPC)가 전부 공개키를 필요로 해 사용자는 계속 비로그인으로 보인다. 쓸 수 없는 세션을 만들지
  // 않고 실패시킨다(키는 쌍으로만 의미가 있다 — proxy 와 같은 규칙).
  if (!env.CHZZK_CLIENT_ID || !env.CHZZK_CLIENT_SECRET) return fail();
  if (!env.JWT_SIGNING_JWK || !env.JWT_PUBLIC_JWK) return fail();

  let session: SessionTokens | null;
  try {
    const creds = { clientId: env.CHZZK_CLIENT_ID, clientSecret: env.CHZZK_CLIENT_SECRET };
    const tokens = await exchangeCodeForTokens(creds, code, state);
    const user = await fetchChzzkUser(tokens.accessToken);

    const db = makeDb(env.DB);
    const { userId } = await upsertChzzkAccount(db, user.channelId, user.channelName);
    if (shouldBootstrapSuperadmin(user.channelId, env.SUPERADMIN_CHANNEL_ID)) {
      await ensureSuperadmin(db, userId);
    }
    const privateJwk = parseJwk(env.JWT_SIGNING_JWK, "JWT_SIGNING_JWK");
    session = await issueSession(db, privateJwk, userId, Date.now());
  } catch {
    return fail();
  }
  if (!session) return fail();

  const res = NextResponse.redirect(new URL("/games", origin));
  res.cookies.set(COOKIE_NAME.access, session.access, accessCookieOptions());
  res.cookies.set(COOKIE_NAME.refresh, session.refresh, refreshCookieOptions());
  res.cookies.set(COOKIE_NAME.state, "", clearedCookieOptions());
  return res;
}
