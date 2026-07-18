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
  const origin = env.AUTH_URL ?? url.origin;
  const fail = () => NextResponse.redirect(new URL("/?login=failed", origin));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = (await cookies()).get(COOKIE_NAME.state)?.value;

  // CSRF: 쿼리 state 와 쿠키 state 대조. 공격자는 우리 httpOnly 쿠키를 못 심으므로 위조 콜백이 막힌다.
  if (!code || !state || !savedState || state !== savedState) return fail();
  if (!env.CHZZK_CLIENT_ID || !env.CHZZK_CLIENT_SECRET || !env.JWT_SIGNING_JWK) return fail();

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
