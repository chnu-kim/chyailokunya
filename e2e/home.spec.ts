import { expect, test } from "@playwright/test";

test("홈: 히어로·런처 카드가 렌더되고 테마 토글이 data-theme 를 뒤집는다", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "챠이로 쿠냐" })).toBeVisible();

  // 두 런처 카드 — 각각 소개/게임으로 간다(index/landing 분리 유지).
  const about = page.locator('[data-od-id="nav-card-about"]');
  const games = page.locator('[data-od-id="nav-card-games"]');
  await expect(about).toHaveAttribute("href", "/landing");
  await expect(games).toHaveAttribute("href", "/games");

  // 첫 페인트 전 인라인 스크립트가 data-theme 를 심고, 토글이 그걸 뒤집는다.
  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  expect(before === "light" || before === "dark").toBe(true);

  const toggle = page.getByRole("button", { name: "다크 모드" });
  await expect(toggle).toHaveAttribute("aria-pressed", String(before === "dark"));

  await toggle.click();
  const after = await html.getAttribute("data-theme");
  expect(after).not.toBe(before);
  await expect(toggle).toHaveAttribute("aria-pressed", String(after === "dark"));
});
