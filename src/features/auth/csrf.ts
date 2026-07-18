/* Origin 헤더 검증 — CSRF 방어의 실질적인 한 겹(ADR-0017).

   왜 SameSite=Lax 만으로 부족한가: Lax 는 크로스사이트 POST 에 쿠키를 안 실어 주지만 그 하나에
   기대면 방어가 한 겹뿐이다. Lax 는 origin 이 아니라 **site** 단위라 서브도메인이 하나라도
   생기면 같은 site 로 취급되고, 임베드 요구로 SameSite=None 으로 바꾸는 순간 통째로 사라진다.
   "JSON POST 라 preflight 가 강제된다"는 것도 방어로 세면 안 된다 — multipart/form-data 는
   CORS simple content-type 이라 preflight 없이 POST 가 도달한다.

   fail-closed 로 설계한다: 기대 origin(AUTH_URL)을 모르거나 Origin 헤더가 없으면 거절한다.
   브라우저는 same-origin 이라도 POST 엔 Origin 을 보낸다(폼·fetch 모두) — 없으면 브라우저가
   보낸 상태 변경 요청이 아니다. */
export function isAllowedOrigin(origin: string | null, expected: string | undefined): boolean {
  if (!origin || !expected) return false;
  try {
    return new URL(origin).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}
