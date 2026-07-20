/* 이 사이트가 가진 페이지의 단일 목록. 라우트 사실이지 도메인 로직이 아니라 core 가 아니라
   여기 산다 — core 는 판정만 하고 상수는 인자로 받는다는 관례가 auth/config.ts 에 이미 적혀
   있고 core/session.ts(capMs·graceMs)가 그걸 실행한다.

   **features 에 두는 이유가 하나 더 있다: 여기여야 nav 와 로그인 복귀가 같은 목록을 본다.**
   `components/ui → core` 는 dependency-cruiser 가 error 로 막으므로(ui-uses-features-not-data)
   목록이 core 에 있으면 site-nav 는 그걸 영원히 못 읽고, "이 사이트의 페이지가 무엇인가"가
   nav 링크와 복귀 허용목록 두 곳으로 갈라진다. 갈라지면 페이지를 추가할 때 한쪽만 고쳐도
   게이트가 전부 초록이고, 새 페이지에서 로그인한 사람만 조용히 `/` 로 떨어진다 — 이슈 #25 가
   고치려던 바로 그 증상이다.

   그래서 **페이지를 추가하는 일은 이 파일 하나를 고치는 일**이어야 한다. */

/* 주 메뉴에 거는 페이지. 경로와 라벨은 한 사실("이 페이지가 있고 이렇게 부른다")이라 쪼개지
   않는다 — 쪼개면 링크는 늘었는데 라벨이 없는 상태가 타입으로 표현 가능해진다. */
export const NAV_LINKS = [
  { href: "/landing", label: "소개" },
  { href: "/games", label: "게임" },
] as const;

/* 로그인 후 복귀를 허용하는 경로(core.safeReturnTo 에 넘긴다). `/` 는 nav 링크가 아니라
   브랜드 로고가 가리키므로 NAV_LINKS 밖에서 따로 더한다.
   여기 없는 경로로는 복귀시키지 않는다 — 목록에 `/api/auth/logout` 같은 내부 엔드포인트가
   섞이면 로그인 직후 로그아웃되거나 리다이렉트 루프가 돈다(그게 허용목록의 진짜 값어치다). */
export const KNOWN_PAGE_PATHS: readonly string[] = ["/", ...NAV_LINKS.map((link) => link.href)];
