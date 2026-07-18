/* 세션 토큰 수명·쿠키·JWT 설정의 단일 원천(ADR-0017 재설계). 값이 코드 곳곳에 흩어지지 않게
   여기 모은다 — 나중에 튜닝할 땐 이 파일만 고친다. 비밀이 아니라 상수라 env 로 빼지 않는다
   (신뢰하지 않는 입력 파싱 부담 회피). 정말 런타임 변경이 필요해지면 env 로 승격한다.
   core 순수 함수(만료·grace·cap 판정)는 이 상수를 import 하지 않고 인자로 받는다(레이어 경계:
   core 는 아무것도 import 안 함) — features 가 호출 시 이 값을 넘긴다. */

export const ACCESS_TTL_MS = 15 * 60 * 1000; // 15분 — 만료 후 proxy 가 refresh 로 갱신
export const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14일 sliding(rotation 마다 갱신)
export const ABSOLUTE_CAP_MS = 90 * 24 * 60 * 60 * 1000; // 90일 — family 첫 로그인 기준 절대 상한
export const GRACE_MS = 30 * 1000; // 30초 — 다중 탭 동시 refresh 오탐 방지 창
export const STATE_TTL_MS = 10 * 60 * 1000; // 10분 — OAuth state 쿠키 수명

/* 쿠키 이름·기본 옵션. httpOnly·Secure·SameSite=Lax(CSRF 1겹)·Path=/. access·refresh 는
   세션, state 는 OAuth 왕복용. */
export const COOKIE_NAME = {
  access: "ck_at",
  refresh: "ck_rt",
  state: "ck_oauth_state",
} as const;

// jose EdDSA(Ed25519) 서명(ADR-0017). algorithms 를 이 값으로 못박아 alg confusion 을 막는다.
export const JWT_ALG = "EdDSA" as const;
export const JWT_ISSUER = "chyailokunya";
export const JWT_AUDIENCE = "chyailokunya-app";
export const JWT_KID = "v1"; // 단일 키(v1). 회전은 kid 다중키로 후속.
