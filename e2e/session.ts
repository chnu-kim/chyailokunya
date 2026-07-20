/* e2e 로그인 상태 fixture(이슈 #23). 치지직 OAuth 를 태우지 않고, dev 서버가 검증에 쓰는
   바로 그 키로 access 쿠키를 직접 서명해 심는다 — 서버는 이걸 진짜 세션과 구별할 수 없다
   (무상태 access 검증이라 DB 도 안 본다, ADR-0017).

   전에는 로그인 상태 nav 를 `.nav__auth` 에 마크업을 주입해 흉내 냈다. 그건 CSS 만 검증하고
   **컴포넌트가 실제로 그 마크업을 내는지는 못 봤다** — site-nav.tsx 가 구조를 바꿔도 주입
   문자열은 낡은 채 초록으로 남았다(실제로 이니셜 배지 제거로 구조가 한 번 바뀌었다).
   이제 layout → getServerActor → SiteNav 의 실제 경로가 돈다.

   서명 키는 `.dev.vars.e2e` 에서 읽는다. 그 파일을 만드는 주체와 wrangler 가 그걸 읽게 되는
   경로는 scripts/e2e-dev-vars.mjs 주석이 정본이다.

   토큰 서명은 앱 코드(features/auth)를 그대로 부른다 — 클레임 모양·iss/aud·alg 를 여기서
   베껴 쓰면 앱이 바뀔 때 조용히 갈라진다. */

import { readFileSync } from "node:fs";
import type { BrowserContext } from "@playwright/test";
import { ACCESS_TTL_MS, COOKIE_NAME } from "@/features/auth/config";
import { signAccessToken } from "@/features/auth/tokens";

const DEV_VARS_PATH = ".dev.vars.e2e";

/* dotenv 흉내지만 우리가 쓰는 한 줄 형식(KEY=JSON)만 지원한다. 값에 '=' 가 들어갈 수 있어
   첫 '=' 에서만 자른다. */
function readDevVar(name: string): string {
  let file: string;
  try {
    file = readFileSync(DEV_VARS_PATH, "utf8");
  } catch {
    throw new Error(
      `${DEV_VARS_PATH} 가 없다 — Playwright 의 webServer 가 scripts/e2e-dev-vars.mjs 를 돌리기 전에 이 헬퍼가 불렸거나, dev 서버를 손으로 띄우고 있다.`,
    );
  }
  for (const line of file.split("\n")) {
    if (line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0 && line.slice(0, eq) === name) return line.slice(eq + 1);
  }
  throw new Error(`${DEV_VARS_PATH} 에 ${name} 이 없다 — 파일을 지우고 다시 돌리면 재생성된다.`);
}

/* 기본 채널명이 "챠이로 쿠냐"인 건 우연이 아니다 — chrome.css 의 .nav__user-name 상한
   6em 이 "이 이름이 어절 공백까지 온전히 들어가는 최소 단"으로 유도됐다. 기본값을 그
   경계값으로 두면 상한을 줄이는 변경이 1280px 말줄임 단언에 바로 걸린다. */
export const E2E_USER = {
  userId: 1,
  channelId: "e2e-channel-0000",
  channelName: "챠이로 쿠냐",
} as const;

/* 로그인 상태로 만든다. goto 전에 부른다 — 쿠키는 첫 요청부터 실려야 SSR 이 로그인 nav 를
   그린다(클라이언트가 나중에 고칠 수 없다).

   쿠키 이름이 __Host- 프리픽스라 Secure·Path=/·Domain 미지정이어야 진짜 세션과 같은 모양이
   된다. 그래서 domain 이 아니라 url 로 심고(url 은 host-only 로 들어간다), 그 url 의 스킴은
   **https 여야 한다** — baseURL(http://localhost:PORT) 을 그대로 주면 CDP 가 "Secure 쿠키를
   http url 에" 로 보고 `Invalid cookie fields` 로 거부한다(실측: secure 를 빼도 __Host- 요건
   미달로 같은 에러). 쿠키는 포트를 구분하지 않고 localhost 는 브라우저가 secure context 로
   쳐 주므로, https://localhost 로 심은 이 쿠키가 http://localhost:PORT 요청에 그대로 실린다. */
export async function signIn(
  context: BrowserContext,
  baseURL: string,
  overrides: Partial<typeof E2E_USER> = {},
): Promise<void> {
  const user = { ...E2E_USER, ...overrides };
  const jwk = JSON.parse(readDevVar("JWT_SIGNING_JWK"));
  const access = await signAccessToken(jwk, user, ACCESS_TTL_MS, Date.now());

  await context.addCookies([
    {
      name: COOKIE_NAME.access,
      value: access,
      // url 하나로 호스트·경로가 정해진다(path 를 같이 주면 addCookies 가 거부한다).
      // 경로가 없는 origin 이라 __Host- 요건인 Path=/ 도 충족된다.
      url: `https://${new URL(baseURL).hostname}`,
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
