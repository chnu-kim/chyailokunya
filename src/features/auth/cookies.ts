/* 세션·OAuth 쿠키 옵션(ADR-0017). httpOnly(XSS 로 토큰 탈취 방어)·Secure·SameSite=Lax(CSRF
   1겹)·Path=/. maxAge 는 쿠키 스펙상 초 단위. 실제 set/read 는 route·proxy(app)가
   NextResponse/cookies 로 하고, 여기선 순수 옵션 객체만 만든다(레이어 경계: features 는 next
   런타임 API 를 직접 만지지 않는다). */

import { ACCESS_TTL_MS, REFRESH_TTL_MS, STATE_TTL_MS } from "./config";

export type CookieOptions = {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

const BASE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

export const accessCookieOptions = (): CookieOptions => ({
  ...BASE,
  maxAge: Math.floor(ACCESS_TTL_MS / 1000),
});
export const refreshCookieOptions = (): CookieOptions => ({
  ...BASE,
  maxAge: Math.floor(REFRESH_TTL_MS / 1000),
});
export const stateCookieOptions = (): CookieOptions => ({
  ...BASE,
  maxAge: Math.floor(STATE_TTL_MS / 1000),
});
/* 로그아웃 마커(config.COOKIE_NAME.loggedOut 주석 참고). 늦게 도착한 refresh 응답이 access 를
   되심는 창을 덮어야 하므로 수명을 access TTL 과 맞춘다 — 그보다 짧으면 창이 열린 채 남고,
   길면 이미 죽은 access 를 계속 막느라 재로그인을 방해할 이유가 없다(로그인이 마커를 지운다). */
export const loggedOutCookieOptions = (): CookieOptions => ({
  ...BASE,
  maxAge: Math.floor(ACCESS_TTL_MS / 1000),
});
// 쿠키 삭제: maxAge 0 으로 즉시 만료시킨다(로그아웃·세션 무효).
export const clearedCookieOptions = (): CookieOptions => ({ ...BASE, maxAge: 0 });
