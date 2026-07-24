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

/* 신뢰할 수 없는 return_to(쿼리·쿠키)를 허용된 내부 경로로 좁힌다. 목록에 없으면 조용히
   기본값 `/` — 사용자가 위조 링크를 눌렀는지 알 필요가 없고, 에러를 띄우면 로그인 자체가 막힌다.
   허용목록은 인자로 받는다(정본은 features/routes.KNOWN_PAGE_PATHS) — core 는 판정만 하고
   상수는 호출자가 넘긴다는 이 저장소 관례이고(auth/config.ts 주석·session.ts 의 capMs·graceMs),
   무엇보다 목록이 여기 살면 nav 가 그걸 못 읽는다(routes.ts 주석 참고).

   **왜 패턴 검사가 아니라 목록 대조인가.** 값을 정화하는 게 아니라 **버린다** — 반환값은 언제나
   목록에 있던 문자열 그 자체라 공격자 바이트가 출력에 한 글자도 닿지 않는다. `new URL` 로
   외부 URL 을 걸러내는 방법도 오픈 리다이렉트 자체는 막지만, 그건 *외부*만 막고 **우리 내부의
   나쁜 목적지**를 그대로 통과시킨다: `/api/auth/logout`(로그인하자마자 로그아웃)·
   `/api/auth/login`(리다이렉트 루프)·없는 경로(로그인 성공 직후 404). 목록 대조는 둘 다 막는다.
   허용목록을 버리고 파서 검사로 갈아탈 땐 이 내부 목적지들을 따로 막아야 한다.

   쿼리스트링·프래그먼트는 통째로 버린다. **이젠 "보존할 게 없어서"가 아니다** — `/schedule` 은
   보고 있는 주를 `?week=` 에 담는다(이슈 #56). 그래서 과거·미래 주를 보다 로그인하면 그 주가
   아니라 이번 주로 돌아온다. 알고 감수하는 손실이다: 되살리려면 nav 가 현재 쿼리까지 실어
   보내야 하는데(`usePathname` 은 경로만 준다) 공유 크롬에서 `useSearchParams` 를 쓰면 정적
   렌더 경계(Suspense)가 딸려 오고, 그 대가가 "주 이동 한 번"이라는 손실보다 크다. 되살릴 땐
   여기서 임의 쿼리를 통과시키지 말고 **검증된 값으로 문자열을 다시 조립**한다 — 위 문단의
   "공격자 바이트가 출력에 한 글자도 닿지 않는다"가 이 함수의 성질이고, 그건 지켜야 한다. */
export function safeReturnTo(raw: string | null | undefined, allowed: readonly string[]): string {
  const candidate = (raw ?? "").trim();
  return allowed.includes(candidate) ? candidate : "/";
}
