import { defineConfig, devices } from "@playwright/test";

// e2e + 시각회귀의 자리. Phase 2 에서 3페이지 시각 스냅샷이 "검증된 베이스라인" 이 된다.
// Phase 1 은 홈이 뜨는지 확인하는 스모크 하나로 하네스만 세운다.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
