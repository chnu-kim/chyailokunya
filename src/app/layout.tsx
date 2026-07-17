import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "챠이로 쿠냐",
  description: "버추얼 스트리머 챠이로 쿠냐 팬 사이트",
};

// 첫 페인트 전에 테마를 확정해 깜빡임을 없앤다 — localStorage 우선, 없으면 OS 선호.
// 구 site.js 의 "인라인 스크립트가 먼저 칠하고 토글은 결과만 읽는다" 계약을 그대로 옮긴 최소본.
// 전체 크롬(토글 UI·이미지 스왑·푸터 연도)은 Phase 2 에서 이식한다.
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
      </head>
      <body className="bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
