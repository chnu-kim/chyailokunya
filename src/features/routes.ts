/* 이 사이트가 가진 페이지의 단일 목록. 라우트 사실이지 도메인 로직이 아니라 core 가 아니라
   여기 산다 — core 는 판정만 하고 상수는 인자로 받는다는 관례가 auth/config.ts 에 이미 적혀
   있고 core/session.ts(capMs·graceMs)가 그걸 실행한다.

   **features 에 두는 이유가 하나 더 있다: 여기여야 nav 와 로그인 복귀가 같은 목록을 본다.**
   `components/ui → core` 는 dependency-cruiser 가 error 로 막으므로(ui-uses-features-not-data)
   목록이 core 에 있으면 site-nav 는 그걸 영원히 못 읽고, "이 사이트의 페이지가 무엇인가"가
   nav 링크와 복귀 허용목록 두 곳으로 갈라진다. 갈라지면 페이지를 추가할 때 한쪽만 고쳐도
   게이트가 전부 초록이고, 새 페이지에서 로그인한 사람만 조용히 `/` 로 떨어진다 — 이슈 #25 가
   고치려던 바로 그 증상이다.

   그래서 **페이지를 추가하는 일은 이 파일 하나를 고치는 일**이어야 한다. 실제로 그런지는
   `e2e/routes.spec.ts` 가 `src/app` 을 훑어 대조한다 — 규칙만 적어 두면 사람의 기억에 걸린다.

   **이 파일은 features 중 유일하게 클라이언트 번들에 실린다**(site-nav 가 "use client"다).
   나머지 `features/**` 는 전부 서버 전용이다 — D1·drizzle·jose·getCloudflareContext. 그러니
   여기서 다른 features 모듈을 import 하지 않는다: 순수 데이터로 남아야 브라우저로 가는 짐이
   늘지 않는다. */

/* 이 사이트가 가진 페이지 전부. 경로와 라벨은 한 사실("이 페이지가 있고 이렇게 부른다")이라
   쪼개지 않는다 — 쪼개면 링크는 늘었는데 라벨이 없는 상태가 타입으로 표현 가능해진다.
   `primary` 는 상단 주 메뉴(nav)에 걸지 여부다. 페이지는 여기 하나에만 더하면 nav·푸터·복귀
   허용목록이 전부 이 배열에서 파생된다(아래 셋). */
export const SITE_LINKS = [
  { href: "/landing", label: "소개", primary: true },
  { href: "/games", label: "게임", primary: true },
  /* 일정은 **아직 상단 nav 에 안 건다**(primary:false). 상단 nav 는 320px 에서 "링크 2개 +
     로그인"에 맞춰 여유 0 으로 튜닝돼 있어(chrome.css 의 .nav .brand·.nav__link 주석) 3번째
     링크가 안 들어간다. 발견성은 푸터 사이트맵(FOOTER_LINKS)이 지금 맡고, 상단 nav 승격은
     /calendar 가 서며 nav 를 3~4 링크로 재편할 때 함께 한다(이슈 #56 결정 10 "nav 4개").
     그때까지도 복귀 허용목록(KNOWN_PAGE_PATHS)엔 들어 있어야 로그인 후 /schedule 로 정상
     복귀한다(이슈 #25 증상 방지 — 이 페이지에서 로그인한 사람만 조용히 `/` 로 안 떨어지게). */
  { href: "/schedule", label: "일정", primary: false },
] as const;

/* 상단 주 메뉴 — primary 만. site-nav 가 그린다. */
export const NAV_LINKS = SITE_LINKS.filter((link) => link.primary);

/* 푸터 사이트맵 — 페이지 전부. site-footer 가 그린다. 여기가 /schedule 의 유일한 링크 진입점
   이라(상단 nav 에 아직 없으므로) 빠지면 그 페이지는 URL 로만 닿는다. */
export const FOOTER_LINKS = SITE_LINKS;

/* 로그인 후 복귀를 허용하는 경로(core.safeReturnTo 에 넘긴다). `/` 는 nav 링크가 아니라
   브랜드 로고가 가리키므로 SITE_LINKS 밖에서 따로 더한다. **nav 에 걸리지 않은 페이지도 여기엔
   들어간다** — 복귀 허용은 "이 사이트의 페이지인가"지 "메뉴에 있나"가 아니다.
   여기 없는 경로로는 복귀시키지 않는다 — 목록에 `/api/auth/logout` 같은 내부 엔드포인트가
   섞이면 로그인 직후 로그아웃되거나 리다이렉트 루프가 돈다(그게 허용목록의 진짜 값어치다). */
export const KNOWN_PAGE_PATHS: readonly string[] = ["/", ...SITE_LINKS.map((link) => link.href)];
