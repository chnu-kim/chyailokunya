import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./chrome.css";
import { SvgDefs } from "@/components/ui/svg-defs";
import { SiteNav } from "@/components/ui/site-nav";
import { SiteFooter } from "@/components/ui/site-footer";
import { OG_IMAGE, OG_LOCALE, OG_SITE_NAME } from "./site-meta";

// og:image·og:url 은 절대 URL 이어야 한다 — X·Slack 은 상대 경로를 무시해 이미지 없는
// 카드가 나간다. metadataBase 가 페이지별 상대 경로를 이 도메인으로 절대화한다. 컷오버
// (Phase 5)까지 구 사이트가 라이브지만, 새 카드는 처음부터 chyailokunya.com 을 가리킨다.
export const metadata: Metadata = {
  metadataBase: new URL("https://chyailokunya.com"),
  title: "챠이로 쿠냐 — 팬 사이트",
  description: "버추얼 스트리머 챠이로 쿠냐 팬 사이트. 소개 랜딩과 플레이 게임 목록.",
  openGraph: {
    siteName: OG_SITE_NAME,
    locale: OG_LOCALE,
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#15110f" },
  ],
};

// 첫 페인트 전에 테마를 확정해 라이트 모드 깜빡임을 없앤다 — localStorage 우선, 없으면
// OS 선호. 구 site.js 의 "인라인 스크립트가 먼저 칠하고 토글은 결과만 읽는다" 계약.
// 토글(theme-toggle.tsx)이 쓰는 키("theme")와 반드시 일치한다.
const themeInit = `(function(){try{
var t=localStorage.getItem("theme");
if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}
document.documentElement.setAttribute("data-theme",t);
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {/* 웹폰트는 각 head 에서 로드한다 — globals.css 에서 @import 하면 파싱이 끝나야
            폰트 origin 을 발견하는 직렬 렌더블로킹 체인이 생긴다. Gloock·Sacramento 는
            한글 글리프가 없어 토큰 스택이 각자 한글 페이스를 뒤에 세운다. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* no-page-custom-font 는 Pages Router 시절 휴리스틱이다 — App Router 루트
            레이아웃 head 는 폰트를 사이트 전역으로 로드하는 올바른 자리라 경고를 끈다. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Gloock&family=Gothic+A1:wght@400;500;700&family=Nanum+Myeongjo:wght@400;700&family=Nanum+Pen+Script&family=Sacramento&display=swap"
        />
      </head>
      <body>
        <SvgDefs />
        <div className="page">
          <a className="skip-link" href="#main">
            본문 바로가기
          </a>
          <SiteNav />
          {children}
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
