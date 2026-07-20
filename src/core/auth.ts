/* 인증 세션의 순수 로직(ADR-0006·0017). HTTP·DB 무관 — 부트스트랩 판정과 로그인 후 복귀 경로
   검증을 담아 단위테스트로 못박는다. OAuth 콜백(app/api/auth/callback/chzzk)이 이 함수들을
   호출한다. (access 엔 authorities 를 싣지 않으므로 클레임 직렬화·좁힘 로직은 없다 —
   인가는 인가 순간 DB 조회로 한다, ADR-0017.) */

/* SUPERADMIN_CHANNEL_ID 부트스트랩 판정. env 가 비었으면(미설정) 아무도 승격하지 않는다 —
   부트스트랩은 "정확히 이 channelId 의 최초 로그인"에만 일어나야 superadmin 증식·오승격이
   없다. env 값에 딸려오는 앞뒤 공백은 조여 비교한다(설정 실수로 조용히 어긋나지 않게). */
export function shouldBootstrapSuperadmin(
  channelId: string,
  superadminChannelId: string | undefined,
): boolean {
  const target = (superadminChannelId ?? "").trim();
  if (!target) return false;
  return channelId.trim() === target;
}

/* 로그인 후 복귀 경로 화이트리스트. 이 사이트의 페이지는 셋뿐이라(`/`·`/landing`·`/games`)
   "상대경로처럼 보이는가"를 검사하는 대신 **알려진 경로와 통째로 대조**한다 — 패턴 검사는
   `//evil.example`(프로토콜 상대 URL)·`/\evil.example`·`/%2f%2fevil.example` 처럼 브라우저가
   외부로 해석하는 형태를 하나씩 막아야 하고, 한 줄만 빠져도 오픈 리다이렉트가 된다.
   목록 대조는 빠뜨릴 구멍이 없다. 페이지가 늘면 여기에 추가한다. */
const RETURN_TO_ALLOWED = ["/", "/landing", "/games"] as const;

/* 신뢰할 수 없는 return_to(쿼리·쿠키)를 안전한 내부 경로로 좁힌다. 목록에 없으면 조용히
   기본값 `/` — 사용자가 위조 링크를 눌렀는지 알 필요가 없고, 에러를 띄우면 로그인 자체가 막힌다.
   쿼리스트링·프래그먼트는 통째로 버린다: 세 페이지 다 URL 상태를 쓰지 않아 보존할 게 없다. */
export function safeReturnTo(raw: string | null | undefined): string {
  const candidate = (raw ?? "").trim();
  return (RETURN_TO_ALLOWED as readonly string[]).includes(candidate) ? candidate : "/";
}
