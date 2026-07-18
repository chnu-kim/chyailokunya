import { expect, test } from "@playwright/test";

/* 게임 보드는 이제 D1 에서 서버가 읽어 렌더한다(Phase 3). 데이터는 globalSetup 이 심은 결정적
   픽스처 4장(상태 골고루, poster null). 추가·삭제 UI 는 인증(#6)이 세션을 주면 붙으므로 여기선
   읽기·필터만 스모크한다 — 쓰기의 "서버 권위"는 tRPC 단위테스트가 증명한다(이슈 #5). */

const CARDS = ".game";

test("게임: D1 에서 읽어 렌더 · 상태 필터", async ({ page }) => {
  await page.goto("/games");

  await expect(page.getByRole("heading", { level: 1, name: "플레이한 게임" })).toBeVisible();
  // 서버가 D1 에서 읽어온 픽스처 4장.
  await expect(page.locator(CARDS)).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "엘든 링" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "마인크래프트" })).toBeVisible();

  // 필터: 플레이중 → 마인크래프트(playing)만 남고 엘든 링(played)은 빠진다.
  await page.getByRole("button", { name: "플레이중" }).click();
  await expect(page.getByRole("button", { name: "플레이중" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(CARDS)).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "마인크래프트" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "엘든 링" })).toBeHidden();

  // 전체로 복귀 → 다시 4장.
  await page.getByRole("button", { name: "전체" }).click();
  await expect(page.locator(CARDS)).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "엘든 링" })).toBeVisible();
});
