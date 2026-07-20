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
  // 빈 채널명이어도 라벨을 비우지 않는다 — 이름 슬롯이 통째로 사라지면 로그인 상태에서
  // 계정 영역이 로그아웃 버튼 하나로 보여 "누구로 로그인했는지"를 물을 수조차 없다.
  const label = user ? user.name || "로그인됨" : "";
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
              {/* 채널명 첫 글자 이니셜 배지를 뺐다 — 치지직 users/me 가 프로필 이미지를 안 줘서
                  글자로 대신 그린 것이었는데, 진짜 아바타가 아닌 이니셜은 신원 정보를 하나도
                  더하지 않고 바로 옆 이름의 첫 글자를 크게 반복할 뿐이다(그래서 aria-hidden
                  이었다 — 접근성 트리엔 애초에 아무것도 안 실렸다). 진짜 프로필 이미지가
                  생기면 그때 이 자리에 이미지를 넣는다(이슈 #26).
                  title 은 달지 않는다 — clip 대상이 .nav__user-name 자신이라 이름은 어느
                  폭에서도 접근성 트리에 남는다. title 은 description 이 되어 VoiceOver 가
                  이름을 두 번 읽을 수 있고, 툴팁은 정작 이 폭대의 터치 기기에서 못 띄운다. */}
              <span className="nav__user-name">{label}</span>
              <button className="nav__signout" type="submit">
                로그아웃
              </button>
            </form>
          ) : (
            <div className="nav__auth">
              {/* 로그인 후 지금 보던 페이지로 돌아오게 현재 경로를 실어 보낸다(이슈 #25).
                  경로는 서버가 화이트리스트로 좁히므로(core.safeReturnTo) 여기선 그대로 넘긴다 —
                  클라이언트 검증은 사용자가 URL 을 손대면 그만이라 방어선이 아니다. */}
              <a
                className="nav__signin"
                href={`/api/auth/login?return_to=${encodeURIComponent(pathname)}`}
                data-od-id="login"
              >
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
