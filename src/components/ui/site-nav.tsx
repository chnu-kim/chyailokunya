"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";

/* 공유 상단 네비게이션. usePathname 으로 현재 라우트에 aria-current="page" 를 건다 —
   구 사이트는 각 HTML 에 손으로 박았지만 여기선 한 컴포넌트가 경로를 보고 정한다.
   user 는 서버 컴포넌트(layout)가 세션에서 읽어 넘긴다 — 로그인 상태를 SSR 로 정확히 그린다.
   로그아웃은 POST(SameSite+POST 로 CSRF 강제 로그아웃 차단), 로그인은 GET 링크. */
export function SiteNav({ user }: { user: { name: string } | null }) {
  const pathname = usePathname();
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
        <ThemeToggle />
        {user ? (
          <form className="nav__auth" action="/api/auth/logout" method="post" data-od-id="logout">
            <span className="nav__user" title={user.name || "로그인됨"}>
              {user.name || "로그인됨"}
            </span>
            <button className="nav__link nav__link--btn" type="submit">
              로그아웃
            </button>
          </form>
        ) : (
          <a className="nav__link nav__link--btn" href="/api/auth/login" data-od-id="login">
            치지직 로그인
          </a>
        )}
      </div>
    </header>
  );
}
