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
   세션, state 는 OAuth 왕복용.

   이름에 __Host- 프리픽스를 박는 이유: 브라우저가 이 프리픽스를 보면 Secure·Path=/·Domain
   미지정을 이름 수준에서 강제한다. 특히 평문 http 로 같은 이름의 non-Secure 쿠키를 심는 것을
   막아, 로그인 CSRF·서브도메인발 쿠키 주입(쿠키 고정)을 방어심화한다(SameSite=Lax 위에 한 겹).
   요건은 session-cookies.ts 의 BASE 가 이미 전부 충족한다(secure:true·path:"/"·Domain 미지정) —
   그래서 옵션은 손대지 않고 이름만 바꾼다.

   배포 주의: 쿠키 이름이 바뀌므로 배포 순간 기존 로그인 세션(구 이름 쿠키)은 전부 무효가 되고
   전원 재로그인해야 한다. 데이터 손실은 없다 — 새 이름으로 다시 로그인하면 된다. 이름만 바꾸는
   것으론 부족하다: 구 이름 쿠키는 __Host- 와 이름이 달라 덮이지 않고 브라우저에 그대로 남는다.
   그래서 auth-touching 응답에서 구 쿠키를 명시적으로 만료시킨다(LEGACY_COOKIE_NAMES) — 이 응답을
   받은 브라우저는 그 자리에서 정리되지만, 배포~롤백 사이 auth-touching 응답을 한 번도 못 받은
   브라우저는 구 쿠키가 남는다. 즉 재로그인 강제는 확실해도 롤백 안전은 **완전 차단이 아니라
   되살아날 창을 좁히는 부분 완화**다(한계는 아래 LEGACY_COOKIE_NAMES 주석).

   dev/e2e: localhost(next dev, http) 도 브라우저가 secure context 로 취급해 __Host- Secure
   쿠키가 그대로 동작하며, 애초에 dev·e2e 는 실제 로그인 흐름을 타지 않아 이 프리픽스에 영향받지
   않는다. */
export const COOKIE_NAME = {
  access: "__Host-ck_at",
  refresh: "__Host-ck_rt",
  state: "__Host-ck_oauth_state",
  /* 로그아웃 마커. 쿠키 삭제만으로는 로그아웃이 확정되지 않는다 — 로그아웃 직전에 proxy 가
     회전 중이던 요청의 응답이 **나중에 도착하면** 방금 서명한 access 를 다시 심는다. refresh 는
     DB 에서 폐기됐지만 access 는 무상태라 최대 ACCESS_TTL 동안 통과한다(공용 브라우저에서
     "로그아웃했는데 로그인 상태"). 이 마커가 있으면 세션 쿠키를 무시·삭제해 그 창을 닫는다.
     수명은 access TTL 과 같다 — 되살아날 수 있는 access 의 최대 수명이 딱 그만큼이다. */
  loggedOut: "__Host-ck_lo",
  /* 로그인 후 복귀 경로. URL 에 실어 치지직을 왕복시키지 않고 우리 쿠키에 두는 이유: 왕복하는
     값은 공급자 로그·리퍼러에 남고, 무엇보다 콜백 쿼리는 공격자가 통째로 짤 수 있다(state 는
     쿠키 대조로 막히지만 복귀 경로까지 쿼리에 있으면 검증할 대상이 하나 늘 뿐이다).
     수명은 state 와 같은 STATE_TTL — 같은 한 번의 OAuth 왕복 동안만 살면 된다. */
  returnTo: "__Host-ck_return_to",
} as const;

/* 구 이름(__Host- 프리픽스 이전) 쿠키. auth-touching 응답마다 명시적으로 만료시켜, 배포를
   롤백했을 때 브라우저에 남은 구 쿠키가 되살아날 창을 좁힌다 — **부분 완화지 완전 차단이
   아니다.** __Host- 는 이름이 달라 구 쿠키를 덮어쓰지 못하니, 이름 교체만으론 구 쿠키가 그대로
   살아 있다 — 그래서 별도로 만료를 실어야 한다. 값은 구 COOKIE_NAME 그대로다(secure·lax·path"/"
   같은 BASE 로 설정됐었다). 만료 로직은 session-cookies.expireLegacyCookies 한 벌이고, 응답을
   쥔 app·middleware 가 sink 로 응답을 넘겨 부른다(features 는 next 런타임 API 를 만지지 않는다).

   한계: 여기서 만료시키는 건 브라우저 쿠키뿐이고, 레거시 refresh family 는 DB 에서 폐기하지
   않는다(logout 은 신 이름 __Host-ck_rt 만 읽어 revokeSession 을 태우므로 구 family 는 손대지
   않는다). 그래서 배포~롤백 사이 auth-touching 요청(미들웨어 커버 페이지·callback·logout)을
   한 번도 받지 않은 브라우저(예: 배포 직전 탭을 닫아 둠)는 구 ck_at/ck_rt 가 그대로 남고,
   롤백 시 레거시 refresh 의 최대 TTL(ABSOLUTE_CAP 90일 cap)까지 부활 가능하다. 완전 차단이
   목표면 배포 시 전 refresh family 를 일괄 폐기해야 하는데, member 무권한 공개 팬사이트엔
   과한 대응이라 이 응답별 쿠키 만료(부분 완화)로 둔다. 배포 후 최대 레거시 refresh TTL이
   지나 구 쿠키가 자연 만료되면 이 상수와 만료 코드를 제거한다. */
export const LEGACY_COOKIE_NAMES = ["ck_at", "ck_rt", "ck_oauth_state", "ck_lo"] as const;

// jose EdDSA(Ed25519) 서명(ADR-0017). algorithms 를 이 값으로 못박아 alg confusion 을 막는다.
export const JWT_ALG = "EdDSA" as const;
export const JWT_ISSUER = "chyailokunya";
export const JWT_AUDIENCE = "chyailokunya-app";
export const JWT_KID = "v1"; // 단일 키(v1). 회전은 kid 다중키로 후속.
