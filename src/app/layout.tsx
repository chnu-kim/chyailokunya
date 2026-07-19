import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./chrome.css";
import { SvgDefs } from "@/components/ui/svg-defs";
import { SiteNav } from "@/components/ui/site-nav";
import { SiteFooter } from "@/components/ui/site-footer";
import { getServerActor } from "./server-session";
import { OG_IMAGE, OG_LOCALE, OG_SITE_NAME } from "./site-meta";
import { buildThemeInitScript } from "@/components/ui/theme-contract";

// og:image·og:url 은 절대 URL 이어야 한다 — X·Slack 은 상대 경로를 무시해 이미지 없는
// 카드가 나간다. metadataBase 가 페이지별 상대 경로를 이 도메인으로 절대화한다. 컷오버는
// 끝났고 구 정적 사이트는 은퇴했다 — chyailokunya.com 이 정본 origin 이다. apex 만 열려
// 있으므로(www 는 DNS 에 없다) 이 URL 의 호스트를 바꾸면 공유 카드가 조용히 어긋난다.
export const metadata: Metadata = {
  metadataBase: new URL("https://chyailokunya.com"),
  title: "챠이로 쿠냐 — 팬 사이트",
  description: "버추얼 스트리머 챠이로 쿠냐 팬 사이트. 소개 랜딩과 플레이한 게임 보드.",
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
// 키·속성 상수는 theme-contract.ts 가 정본 — 토글·useTheme 도 같은 곳에서 가져온다.
const themeInit = buildThemeInitScript();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // middleware 가 진입점에서 access 를 갱신해 두므로 여기선 세션을 읽어 nav 로그인 상태만
  // 그린다. (proxy.ts 가 아니라 middleware.ts 인 이유는 ADR-0017 — OpenNext 가 거부한다.)
  const actor = await getServerActor();
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
          <SiteNav user={actor ? { name: actor.channelName } : null} />
          {children}
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
