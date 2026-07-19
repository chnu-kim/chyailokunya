"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";

/* 공유 상단 네비게이션. usePathname 으로 현재 라우트에 aria-current="page" 를 건다 —
   구 사이트는 각 HTML 에 손으로 박았지만 여기선 한 컴포넌트가 경로를 보고 정한다.
   user 는 서버 컴포넌트(layout)가 세션에서 읽어 넘긴다 — 로그인 상태를 SSR 로 정확히 그린다.
   로그아웃은 POST(SameSite+POST 로 CSRF 강제 로그아웃 차단), 로그인은 GET 링크.

   시각 위계는 3단이다: 현재 페이지·내 이름(--fg 700) > 이동 링크(--fg-muted 500) >
   세션 컨트롤(--fg-muted 500 + 밑줄). 예전엔 링크·로그인·로그아웃이 전부 700/--fg/14px 라
   "다른 화면으로 이동"과 "세션 상태 변경"이 픽셀 단위로 같았다.
   로그인을 채운 잉크 CTA 로 올렸다가 되돌린 이유는 chrome.css 의 .nav__signin 주석에 있다 —
   세션이 여는 UI 가 관리자 전용 쓰기뿐이라 헤더 최상위 무게를 정당화할 payoff 가 없다.

   로그아웃이 드롭다운 없이 상시 노출인 건 **의도된 선택**이다. 넣으려면 이름을
   <button aria-expanded> 로 만들어야 하는데, .nav 의 backdrop-filter:blur(8px) 가 fixed
   자손의 containing block 이 되어 팝오버 스태킹을 먼저 풀어야 한다. 클릭 한 번으로 끝나는
   되돌릴 수 있는 액션 하나를 감추자고 그 비용을 치르지 않는다. */
export function SiteNav({ user }: { user: { name: string } | null }) {
  const pathname = usePathname();
  // 빈 채널명도 슬롯을 비우지 않는다 — 아바타가 항상 한 글자를 그려야 좁은 화면에서
  // 로그인 여부의 시각 단서가 사라지지 않는다(≤560px 에선 이름이 clip 되고 배지만 남는다).
  const label = user ? user.name || "로그인됨" : "";
  // 코드포인트 단위로 자른다 — slice(0,1)·charAt(0) 은 이모지가 든 채널명의 서로게이트
  // 쌍을 반쪽만 남겨 U+FFFD 로 렌더한다. 폴백 라벨("로그인됨")일 때 첫 글자를 쓰지 않는
  // 이유: 배지에 '로' 만 남으면 사람 이름의 첫 글자로 읽혀 실제 채널명처럼 오독된다.
  // 비언어 문자로 두면 "이름을 못 받았다"가 그대로 읽힌다.
  const initial = user?.name ? (Array.from(user.name)[0] ?? "?") : "?";
  return (
    <header className="nav" data-od-id="site-nav">
      <div className="nav__inner">
        <Link className="brand" href="/" aria-label="챠이로 쿠냐 홈">
          <svg className="brand__cat" aria-hidden="true">
            <use href="#mk-kao" />
          </svg>
          <span className="brand__name">챠이로 쿠냐</span>
        </Link>
        <span className="brand__tag">VTUBER</span>
        <span className="nav__spacer" />
        <nav className="nav__links" aria-label="주 메뉴">
          <Link
            className="nav__link"
            href="/landing"
            aria-current={pathname === "/landing" ? "page" : undefined}
          >
            소개
          </Link>
          <Link
            className="nav__link"
            href="/games"
            aria-current={pathname === "/games" ? "page" : undefined}
          >
            게임
          </Link>
        </nav>
        {/* 외형 설정(토글)과 계정을 한 덩어리로 묶는다 — 링크와의 간격(--space-4, 16px)이
            덩어리 안 간격(--space-2, 8px)보다 넓어 "이동 / 내 것" 두 그룹으로 읽힌다.
            예전엔 토글이 링크와 계정 사이에 홀로 서서 헤더가 세 조각으로 쪼개졌다. */}
        <div className="nav__end" data-od-id="nav-utility">
          <ThemeToggle />
          {user ? (
            <form className="nav__auth" action="/api/auth/logout" method="post" data-od-id="logout">
              {/* title 을 달지 않는다 — clip 대상이 래퍼가 아니라 .nav__user-name 으로
                  좁아진 뒤로 이름은 어느 폭에서도 접근성 트리에 남는다. 이름 없는 generic
                  에 붙은 title 은 description 이 되어 VoiceOver 가 이름을 두 번 읽을 수
                  있고, 툴팁은 정작 이 폭대의 터치 기기에서 띄울 수 없다. */}
              <span className="nav__user">
                {/* 옆 이름을 그대로 중복하므로 aria-hidden — 스크린리더는 .nav__user-name 을
                    읽는다(좁은 폭에서 clip 되어도 접근성 트리엔 남는다). 560px 이하에서
                    시각 사용자에게 남는 건 이 배지의 원형이 아니라 그 안 글자 하나다
                    (칩 채움은 1.23:1 — chrome.css .nav__user-avatar 주석). */}
                <span className="nav__user-avatar" aria-hidden="true">
                  {initial}
                </span>
                <span className="nav__user-name">{label}</span>
              </span>
              <button className="nav__signout" type="submit">
                로그아웃
              </button>
            </form>
          ) : (
            <div className="nav__auth">
              <a className="nav__signin" href="/api/auth/login" data-od-id="login">
                {/* 공급자 이름은 430px 이하에서 시각적으로만 접힌다(chrome.css) — 접근
                    이름은 어느 폭에서도 "치지직 로그인" 이라 스크린리더가 어디로 가는지
                    안다. 공백을 span 안에 두는 게 그 계약이다: 밖에 두면 접히는 순간
                    이름이 "치지직로그인" 으로 붙는다. */}
                <span className="nav__signin-brand">치지직 </span>로그인
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
