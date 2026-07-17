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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
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
