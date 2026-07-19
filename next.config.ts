import type { NextConfig } from "next";

// 모든 응답에 붙는 보안 헤더. next.config 의 headers() 는 SSR/RSC 응답에만 붙고,
// Workers 가 직접 서빙하는 정적 에셋(_next/static·public)에는 안 붙는다 — 그쪽 미러는
// public/_headers 가 쥔다. 두 곳이 어긋나면 정적 에셋만 무방비가 되므로, 여기 값을
// 바꾸면 public/_headers 도 반드시 같이 고친다.
const securityHeaders = [
  // 2년. preload 는 일부러 뺀다 — hstspreload.org 등록은 브라우저에 하드코딩돼 되돌리기
  // 어려운(레지스트리) 커밋이라 사람 판단 몫이다. includeSubDomains 만으로도 apex·서브 보호.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 이 사이트는 카메라·마이크·위치·Topics API 를 안 쓴다 — 전부 빈 허용목록으로 잠근다.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // CSP 를 두 겹으로 나눈다. App Router 는 RSC 스트리밍·하이드레이션용 인라인 <script> 를
  // 런타임에 nonce 없이 주입하는데, script-src 를 조이면 그게 막혀 사이트가 통째로 깨진다.
  // nonce 로 조이려면 세션 갱신 미들웨어(middleware.ts) 수술이 필요해 지금은 미룬다(YAGNI).
  // 그래서 (1) 앱을 깰 수 없는 지시어만 enforced 로 실제 차단하고,
  //        (2) 스크립트·스타일·폰트·이미지까지 조이는 전체 정책은 Report-Only 로 관측만 한다.
  // enforced nonce-CSP 는 후속 작업.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      // 인라인 테마 스크립트(layout.tsx 의 themeInit)의 sha256. 그 바이트가 바뀌면 이
      // 해시도 같이 갱신해야 Report-Only 가 거짓 위반을 내지 않는다(= 후속 enforced 의 예행).
      "script-src 'self' 'sha256-qGNAy9rLmhC8By4yUHDYGLlyMkvZPaj3GDjYfs2qZww='",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' https: data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Next 버전을 광고하는 X-Powered-By 를 끈다 — 공격자에게 주는 무료 정찰 정보다.
  poweredByHeader: false,
  // source '/(.*)' 로 모든 경로에 보안 헤더를 단다. (SSR/RSC 응답 한정 — 위 주석 참고.)
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

// dev 서버에서도 Cloudflare 바인딩(env·D1 등)을 getCloudflareContext() 로 읽게 초기화한다.
// 개발과 프로덕션(Workers)의 바인딩 접근 경로를 하나로 맞춰, "로컬은 되는데 배포는 깨지는"
// 종류의 표류를 없앤다.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
