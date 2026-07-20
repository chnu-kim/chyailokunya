/* 세션 쿠키 배선의 단일 정본(ADR-0017). 쿠키 이름·TTL 옵션·access/refresh 짝·로그아웃 마커
   규칙·레거시 만료가 전부 이 파일 안에 산다 — 전에는 set/clear 짝이 middleware·logout·callback
   세 곳에 중복돼 있었고, 마커 의미론이 여섯 파일에 흩어져 있었다. 호출자는 "세션을 심는다/
   걷는다/마커를 남긴다"만 말하고, 어떤 이름의 쿠키가 어떤 속성으로 나가는지는 여기가 정한다.

   레이어 경계: features 는 next 런타임 API 를 직접 만지지 않는다 — NextResponse 대신 그
   부분집합인 구조적 sink/jar 타입을 받는다. NextResponse(res)·NextRequest.cookies·
   next/headers 의 cookies() 가 전부 이 타입을 그대로 만족하므로 호출자는 캐스팅 없이 넘기고,
   테스트는 가짜 sink 로 Set-Cookie 의 이름·값·속성을 바이트 수준으로 못박는다. */

import {
  ACCESS_TTL_MS,
  COOKIE_NAME,
  LEGACY_COOKIE_NAMES,
  REFRESH_TTL_MS,
  STATE_TTL_MS,
} from "./config";
import type { SessionTokens } from "./session";

export type CookieOptions = {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

/* 응답의 Set-Cookie 를 쓸 수 있는 최소 표면. NextResponse 가 구조적으로 만족한다. */
export type CookieSink = {
  cookies: { set(name: string, value: string, options: CookieOptions): void };
};

/* 요청 쿠키를 읽는 최소 표면. NextRequest.cookies·next/headers 의 cookies() 가 만족한다. */
export type CookieJar = {
  get(name: string): { value: string } | undefined;
};

/* middleware 전용: 같은 요청의 다운스트림(RSC·route·tRPC)에 넘길 요청 쿠키를 고쳐 쓰는 표면.
   Set-Cookie(응답)가 아니라 request.cookies 를 덮는 forward 용이다. */
export type RequestCookieWriter = {
  set(name: string, value: string): unknown;
  delete(name: string): unknown;
};

/* 쿠키 옵션. httpOnly(XSS 로 토큰 탈취 방어)·Secure·SameSite=Lax(CSRF 1겹)·Path=/.
   maxAge 는 쿠키 스펙상 초 단위. __Host- 프리픽스 요건(Secure·Path=/·Domain 미지정)은 이
   BASE 가 이미 전부 충족한다(config.COOKIE_NAME 주석 참고). */
const BASE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

const withTtl = (ttlMs: number): CookieOptions => ({ ...BASE, maxAge: Math.floor(ttlMs / 1000) });
// 쿠키 삭제: maxAge 0 으로 즉시 만료시킨다(로그아웃·세션 무효).
const cleared = (): CookieOptions => ({ ...BASE, maxAge: 0 });

/* access+refresh 는 항상 짝으로 심는다 — 한쪽만 심는 조합은 존재하지 않는다(로그인 확정·
   rotation 성공 둘 다 새 짝을 받는다). 순서(access → refresh)도 기존 응답과 동일하게 유지. */
export function plantSessionCookies(sink: CookieSink, tokens: SessionTokens): void {
  sink.cookies.set(COOKIE_NAME.access, tokens.access, withTtl(ACCESS_TTL_MS));
  sink.cookies.set(COOKIE_NAME.refresh, tokens.refresh, withTtl(REFRESH_TTL_MS));
}

/* 걷을 때도 짝으로 걷는다(로그아웃·도난/만료 refresh·로그아웃 마커 적중). */
export function clearSessionCookies(sink: CookieSink): void {
  sink.cookies.set(COOKIE_NAME.access, "", cleared());
  sink.cookies.set(COOKIE_NAME.refresh, "", cleared());
}

export function readSessionCookies(jar: CookieJar): {
  access: string | undefined;
  refresh: string | undefined;
} {
  return {
    access: jar.get(COOKIE_NAME.access)?.value,
    refresh: jar.get(COOKIE_NAME.refresh)?.value,
  };
}

/* 로그아웃 마커(config.COOKIE_NAME.loggedOut 주석 참고). 쿠키 삭제만으로는 로그아웃이 확정되지
   않는다 — 로그아웃 직전에 회전 중이던 요청의 응답이 나중에 도착하면 access 를 되심는다.
   마커 수명은 access TTL 과 맞춘다: 늦게 도착한 응답이 되심을 수 있는 access 의 최대 수명이
   딱 그만큼이다 — 짧으면 창이 열린 채 남고, 길면 이미 죽은 access 를 계속 막느라 재로그인을
   방해할 이유가 없다(로그인이 마커를 지운다). */
export function plantLoggedOutMarker(sink: CookieSink): void {
  sink.cookies.set(COOKIE_NAME.loggedOut, "1", withTtl(ACCESS_TTL_MS));
}

// 로그인 확정이 부른다 — 안 지우면 방금 로그인한 세션이 마커에 막혀 계속 비로그인으로 보인다.
export function clearLoggedOutMarker(sink: CookieSink): void {
  sink.cookies.set(COOKIE_NAME.loggedOut, "", cleared());
}

/* 마커는 값이 아니라 **존재**로 판정한다 — 값이 빈 문자열이어도 세션 쿠키를 믿지 않는다
   (middleware·server-session 이 같은 판정을 써야 경로에 따라 결과가 갈리지 않는다). */
export function hasLoggedOutMarker(jar: CookieJar): boolean {
  return jar.get(COOKIE_NAME.loggedOut) !== undefined;
}

/* OAuth state(CSRF nonce) 왕복. login 이 심고 callback 이 대조 후 — 성공이든 실패든 — 걷는다.
   실패에도 걷는 이유: 남겨 두면 같은 nonce 로 TTL(10분) 내내 콜백을 재시도할 수 있어
   "state = 일회용" 속성이 코드로 지켜지지 않는다. */
export function plantOauthStateCookie(sink: CookieSink, state: string): void {
  sink.cookies.set(COOKIE_NAME.state, state, withTtl(STATE_TTL_MS));
}

export function clearOauthStateCookie(sink: CookieSink): void {
  sink.cookies.set(COOKIE_NAME.state, "", cleared());
}

export function readOauthStateCookie(jar: CookieJar): string | undefined {
  return jar.get(COOKIE_NAME.state)?.value;
}

/* 로그인 후 복귀 경로 왕복(이슈 #25). login 이 검증된 경로를 심고 callback 이 — 성공이든
   실패든 — 읽고 걷는다. state 와 수명·왕복 구간이 같지만 별도 쿠키다: state 는 CSRF nonce 라
   값이 대조 대상이고 이건 리다이렉트 대상이라, 한 쿠키에 이어 붙이면 파싱 실수 하나가 두
   보안 속성을 동시에 무너뜨린다. 걷는 걸 빠뜨리면 다음 로그인이 남의 경로로 튄다. */
export function plantReturnToCookie(sink: CookieSink, path: string): void {
  sink.cookies.set(COOKIE_NAME.returnTo, path, withTtl(STATE_TTL_MS));
}

export function clearReturnToCookie(sink: CookieSink): void {
  sink.cookies.set(COOKIE_NAME.returnTo, "", cleared());
}

export function readReturnToCookie(jar: CookieJar): string | undefined {
  return jar.get(COOKIE_NAME.returnTo)?.value;
}

/* 레거시 세션·OAuth 쿠키(구 이름 ck_at·ck_rt·ck_oauth_state·ck_lo, __Host- 프리픽스 이전)를
   응답에서 만료시킨다. auth 상태를 건드리는 응답(로그인 성공/실패·로그아웃·미들웨어의 세션
   정리)에 실어, 배포를 롤백했을 때 브라우저에 남은 구 쿠키가 옛 세션을 되살릴 창을 좁힌다 —
   부분 완화지 완전 차단이 아니다(한계는 config.LEGACY_COOKIE_NAMES 주석). 전에는 middleware 가
   레이어 경계 때문에 app 헬퍼와 같은 로직을 따로 들고 있었는데, sink 타입 덕에 이제 한 벌이다. */
export function expireLegacyCookies(sink: CookieSink): void {
  for (const name of LEGACY_COOKIE_NAMES) sink.cookies.set(name, "", cleared());
}

/* 익명 트래픽엔 불필요한 Set-Cookie 를 붙이지 않으려고, 구 이름 쿠키가 실제로 있을 때만
   만료를 싣는 판정(middleware 의 no-session 이른 반환 경로). */
export function hasLegacyCookies(jar: { has(name: string): boolean }): boolean {
  return LEGACY_COOKIE_NAMES.some((name) => jar.has(name));
}

/* middleware 전용 request-forward 짝. 응답 Set-Cookie 와 별개로, **이번 요청**의 다운스트림이
   보는 쿠키를 고친다 — 안 그러면 rotation 으로 새 access 를 심어도 이번 요청은 옛 쿠키를 보고,
   로그아웃 마커가 있어도 되심긴 세션이 다운스트림에 그대로 넘어간다. */
export function forwardRotatedAccess(req: RequestCookieWriter, access: string): void {
  req.set(COOKIE_NAME.access, access);
}

export function dropSessionFromRequest(req: RequestCookieWriter): void {
  req.delete(COOKIE_NAME.access);
  req.delete(COOKIE_NAME.refresh);
}
