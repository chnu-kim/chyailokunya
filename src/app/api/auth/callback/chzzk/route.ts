/* 치지직 OAuth 콜백(ADR-0017). state 이중제출 검증 → 코드 교환 → 신원 조회 → users/oauth
   upsert(+표시명 스냅샷) → 부트스트랩 → 자체 세션(access+refresh 쿠키) 발급 → 로그인을 누른
   페이지로 복귀(return_to 쿠키, 이슈 #25).
   치지직 토큰은 신원확인 1회에만 쓰고 버린다(저장 안 함, ADR-0006). 어떤 실패든 /?login=failed
   로 안전하게 되돌린다(내부 오류를 노출하지 않는다). */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeReturnTo, shouldBootstrapSuperadmin } from "@/core/auth";
import { makeDb } from "@/db";
import { exchangeCodeForTokens, fetchChzzkUser } from "@/features/auth/chzzk-api";
import { sessionKeys } from "@/features/auth/keys";
import { requireAuthOrigin } from "@/features/auth/request-guard";
import { ensureSuperadmin, superadminExists, upsertChzzkAccount } from "@/features/auth/service";
import { issueSession, type SessionTokens } from "@/features/auth/session";
import {
  clearLoggedOutMarker,
  clearOauthStateCookie,
  clearReturnToCookie,
  expireLegacyCookies,
  plantSessionCookies,
  readOauthStateCookie,
  readReturnToCookie,
} from "@/features/auth/session-cookies";
import { credsFromEnv } from "@/features/chzzk-http";
import { KNOWN_PAGE_PATHS } from "@/features/routes";

export async function GET(req: Request) {
  const { env } = getCloudflareContext();
  const url = new URL(req.url);
  // AUTH_URL 부재 시 url.origin(=Host 헤더)으로 폴백하면 리다이렉트 대상이 요청자에게 좌우된다.
  // login 이 이미 503 으로 막으므로 여기도 fail-closed 로 맞춘다(request-guard).
  const guarded = requireAuthOrigin(env);
  if (guarded instanceof Response) return guarded;
  const origin = guarded.origin;
  // 실패해도 state 쿠키를 걷는다 — 남겨 두면 같은 nonce 로 TTL(10분) 내내 콜백을 재시도할 수
  // 있어 "state = 일회용" 속성이 코드로 지켜지지 않는다.
  const fail = () => {
    const res = NextResponse.redirect(new URL("/?login=failed", origin));
    clearOauthStateCookie(res);
    // 복귀 경로도 같이 걷는다 — 남기면 다음 로그인이 이번 시도의 경로로 튄다(state 와 같은 이유).
    clearReturnToCookie(res);
    // 로그인 흐름을 탄 브라우저의 구 이름 쿠키를 만료 — 롤백 시 옛 세션이 되살아날 창을
    // 좁힌다(부분 완화, 완전 차단 아님 — 한계는 config.ts 의 LEGACY_COOKIE_NAMES 주석 참고).
    expireLegacyCookies(res);
    return res;
  };

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const savedState = readOauthStateCookie(jar);

  // CSRF: 쿼리 state 와 쿠키 state 대조. 공격자는 우리 httpOnly 쿠키를 못 심으므로 위조 콜백이 막힌다.
  if (!code || !state || !savedState || state !== savedState) return fail();
  const creds = credsFromEnv(env.CHZZK_CLIENT_ID, env.CHZZK_CLIENT_SECRET);
  if (!creds) return fail();
  // 서명키만 있으면 세션 쿠키는 발급되지만 검증자(proxy·서버 컴포넌트·tRPC)가 전부 공개키를
  // 필요로 해 사용자는 계속 비로그인으로 보인다. 쓸 수 없는 세션을 만들지 않고 실패시킨다
  // (키는 쌍으로만 의미가 있다 — proxy 와 같은 규칙, keys.sessionKeys 가 정본).
  const keys = sessionKeys(env);
  if (!keys) return fail();

  let session: SessionTokens | null;
  try {
    const tokens = await exchangeCodeForTokens(creds, code, state);
    const user = await fetchChzzkUser(tokens.accessToken);

    const db = makeDb(env.DB);
    const { userId } = await upsertChzzkAccount(db, user.channelId, user.channelName);
    // 부트스트랩은 **아무도 superadmin 이 아닐 때만** — env 가 DB 를 매 로그인 덮으면 회수가
    // 무의미해지고(감사 없이 부활) 최고 권한만 "즉시 회수" 계약 밖에 놓인다(service 주석 참고).
    if (
      shouldBootstrapSuperadmin(user.channelId, env.SUPERADMIN_CHANNEL_ID) &&
      !(await superadminExists(db))
    ) {
      await ensureSuperadmin(db, userId);
    }
    session = await issueSession(db, keys.signingKey(), userId, Date.now());
  } catch {
    return fail();
  }
  if (!session) return fail();

  /* 로그인을 누른 페이지로 돌려보낸다. 쿠키가 없으면(구 로그인 링크·10분 초과) `/` 로 간다.

     여기서 한 번 더 좁히는 건 **공격자를 막으려는 게 아니다** — 이 쿠키는 `__Host-` + httpOnly라
     남이 심을 수 없다. 막는 대상은 둘이다: (a) 검증 없이 심는 경로가 나중에 생기는 것,
     (b) 허용목록이 좁아진 뒤 도착한 10분 전 쿠키(그 사이 페이지를 뺐다면 없는 곳으로 보낸다).
     같은 함수를 두 번 부르는 것이라 safeReturnTo 자체의 버그는 이걸로 안 막힌다. */
  const res = NextResponse.redirect(
    new URL(safeReturnTo(readReturnToCookie(jar), KNOWN_PAGE_PATHS), origin),
  );
  plantSessionCookies(res, session);
  clearOauthStateCookie(res);
  clearReturnToCookie(res);
  // 로그아웃 마커를 걷는다 — 안 지우면 방금 로그인한 세션이 마커에 막혀 계속 비로그인으로 보인다.
  clearLoggedOutMarker(res);
  // 새 __Host- 세션으로 로그인 확정 — 남아 있던 구 이름 쿠키를 만료시켜 롤백 시 되살아날 창을
  // 좁힌다(부분 완화, 완전 차단 아님 — 한계는 config.ts 의 LEGACY_COOKIE_NAMES 주석 참고).
  expireLegacyCookies(res);
  return res;
}
