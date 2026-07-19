/* 인증이 걸린 요청의 진입 가드(ADR-0017). "검증된 값 또는 에러 Response" 를 돌려주는 함수군 —
   fail-closed 판정(AUTH_URL 503)·Origin 대조(403)·Sec-Fetch-Site 차단(403)의 상태코드와 문구가
   전에는 logout·callback·tRPC 라우트에 흩어져 중복돼 있었다. Response 는 웹 표준(workerd 전역)
   이라 features 가 만들어도 next 런타임 API 를 만지지 않는다. */

/* Origin 헤더 검증 — CSRF 방어의 실질적인 한 겹.

   왜 SameSite=Lax 만으로 부족한가: Lax 는 크로스사이트 POST 에 쿠키를 안 실어 주지만 그 하나에
   기대면 방어가 한 겹뿐이다. Lax 는 origin 이 아니라 **site** 단위라 서브도메인이 하나라도
   생기면 같은 site 로 취급되고, 임베드 요구로 SameSite=None 으로 바꾸는 순간 통째로 사라진다.
   "JSON POST 라 preflight 가 강제된다"는 것도 방어로 세면 안 된다 — multipart/form-data 는
   CORS simple content-type 이라 preflight 없이 POST 가 도달한다.

   fail-closed 로 설계한다: 기대 origin(AUTH_URL)을 모르거나 Origin 헤더가 없으면 거절한다.
   브라우저는 same-origin 이라도 POST 엔 Origin 을 보낸다(폼·fetch 모두) — 없으면 브라우저가
   보낸 상태 변경 요청이 아니다. */
function isAllowedOrigin(origin: string | null, expected: string | undefined): boolean {
  if (!origin || !expected) return false;
  try {
    return new URL(origin).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

const forbiddenOrigin = () => new Response("forbidden origin", { status: 403 });

/* AUTH_URL 부재 → 503. Host 헤더로 폴백하면, Host 를 통제할 수 있는 경로에서 리다이렉트
   대상이 조작된다 — login(자체 503)·logout·callback 세 라우트 모두 fail-closed 로 통일한다.
   성공이면 검증된 origin 문자열을 돌려준다(리다이렉트 조립에 그대로 쓴다). */
export function requireAuthOrigin(env: { AUTH_URL?: string }): { origin: string } | Response {
  if (!env.AUTH_URL) return new Response("AUTH_URL 미설정", { status: 503 });
  return { origin: env.AUTH_URL };
}

/* 상태를 바꾸는 요청은 Origin 이 우리 것일 때만 받는다(CSRF). 위조·부재·오설정(AUTH_URL 없음)
   전부 403 — 통과면 null. POST·SameSite 만으로는 강제 로그아웃이 막히지 않는다: 크로스사이트 폼
   POST 는 쿠키가 안 실려 DB 폐기는 건너뛰지만 응답의 Set-Cookie(삭제)는 그대로 적용돼 피해자가
   조용히 로그아웃된다 — Origin 이 우리 것일 때만 처리해 그 경로를 끊는다. */
export function rejectForeignOrigin(req: Request, authUrl: string | undefined): Response | null {
  return isAllowedOrigin(req.headers.get("origin"), authUrl) ? null : forbiddenOrigin();
}

/* 크로스사이트 요청은 **GET(쿼리)도** 막는다. GET 은 뮤테이션을 태우지 못하지만
   (tRPC v11 allowMethodOverride=false) 쿠키를 업고 인가된 쿼리를 크로스사이트에서 트리거할 수
   있다 — 응답은 SOP 로 못 읽어도 부수효과와 외부 API 쿼터(chzzk 카테고리 검색)는 남는다.
   Origin 으로는 못 막는다: 브라우저가 same-origin GET 엔 Origin 을 안 실어 준다. 그래서 GET
   표면은 Sec-Fetch-Site 로 닫는다(모던 브라우저가 항상 보낸다). 헤더가 없는 옛 브라우저는
   이 겹을 못 받지만, 쓰기는 Origin 검사(rejectForeignOrigin)와 SameSite 가 계속 막는다. */
export function rejectCrossSiteFetch(req: Request): Response | null {
  return req.headers.get("sec-fetch-site") === "cross-site" ? forbiddenOrigin() : null;
}
