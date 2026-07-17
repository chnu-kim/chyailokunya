"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";

/* 공유 상단 네비게이션. usePathname 으로 현재 라우트에 aria-current="page" 를 건다 —
   구 사이트는 각 HTML 에 손으로 박았지만 여기선 한 컴포넌트가 경로를 보고 정한다. */
export function SiteNav() {
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
      </div>
    </header>
  );
}
