import { defineConfig, devices } from "@playwright/test";

// 포트는 env 로 바꿀 수 있다(기본 3000). CI 는 3000 이 비어 있어 그대로지만, 여러 프로젝트를
// 돌리는 개발 머신에선 3000 이 남의 dev 서버로 막혀 있을 수 있다 — PORT=3100 npm run e2e.
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BASE_URL = `http://localhost:${PORT}`;

// 두 갈래로 나눈다:
//  - smoke: 3페이지 동작 패리티(렌더·크롬·게임 보드 상호작용). 크로스플랫폼이라 CI e2e 게이트가
//    이걸 돌린다(npm run e2e = --project=smoke).
//  - visual: toHaveScreenshot 시각 스냅샷. 베이스라인은 OS 별 파일이라(‑darwin/‑linux) 여기서
//    만든 macOS 베이스라인은 리눅스 CI 와 안 맞는다 — 그래서 CI 스모크에서 제외하고, 로컬 dev
//    베이스라인으로만 둔다(npm run e2e:visual). reduced-motion 으로 등장 애니메이션을 꺼 안정화.
export default defineConfig({
  testDir: "./e2e",
  // 로컬 D1 에 스키마+결정적 픽스처를 심는다(games 페이지가 D1 을 읽으므로 필수). --local 이라
  // CF 인증 불요 → CI 에서도 그대로. 스냅샷 대상 파일이 아니라 testDir 밖 setup 이다.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  /* dev 서버를 띄우기 전에 e2e 세션 키를 심는다(scripts/e2e-dev-vars.mjs 주석이 정본).
     globalSetup 에 둘 수 없다 — Playwright 는 webServer(플러그인)를 globalSetup 보다 먼저
     띄우므로 그때 심은 키는 이미 부팅한 서버가 못 읽는다. NEXT_DEV_WRANGLER_ENV=e2e 는
     wrangler 가 `.dev.vars` 대신 `.dev.vars.e2e` 를 읽게 하는 스위치다(개발자의 `.dev.vars`
     를 안 건드리려고). wrangler.jsonc 에 env.e2e 섹션이 없어 경고가 두 줄 뜨는데 정상이다 —
     섹션을 만들면 오히려 d1 바인딩이 딸려오지 않는다. */
  webServer: {
    command: `node scripts/e2e-dev-vars.mjs && npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_DEV_WRANGLER_ENV: "e2e" },
  },
  projects: [
    {
      name: "smoke",
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual",
      testMatch: /visual\.spec\.ts/,
      // reduced-motion 은 스펙 안에서 page.emulateMedia 로 켠다 — 이 Playwright 버전은
      // project-level use 에 reducedMotion 키를 타입으로 받지 않는다(build 가 잡는다).
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
