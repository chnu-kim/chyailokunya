import { expect, test } from "@playwright/test";

// 스모크: 홈이 뜨고, 첫 페인트 전 인라인 스크립트가 data-theme 를 심고, 토글이 그걸 뒤집는다.
// Phase 2 에서 여기에 toHaveScreenshot 시각회귀를 얹는다.
test("홈이 렌더되고 테마 토글이 data-theme 를 뒤집는다", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  expect(before === "light" || before === "dark").toBe(true);

  await page.getByRole("button", { name: /테마 전환/ }).click();

  const after = await html.getAttribute("data-theme");
  expect(after).not.toBe(before);
});
