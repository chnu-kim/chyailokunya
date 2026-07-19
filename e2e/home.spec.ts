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

/* 좁은 폭 스모크. 다른 스펙은 전부 devices["Desktop Chrome"] 기본 뷰포트(1280)에서만 돌아,
   인증 슬롯이 콘텐츠 폭 아래로 짜부라져 넘침이 토글을 통째로 덮은 회귀가 format·lint·
   typecheck·boundaries·unit·build·e2e 게이트를 전부 초록으로 통과했다.
   click() 을 쓰는 게 핵심이다 — toBeVisible() 은 덮여 있어도 통과하지만 click() 의
   actionability 검사는 "다른 요소가 포인터 이벤트를 가로챈다"로 실패한다.
   390 은 그 회귀가 가장 심했던 폭(토글 3점이 전부 CTA 였다)이고, 320 은 WCAG 1.4.10
   reflow 기준 폭이라 가로 넘침 0 을 여기서 같이 못박는다. */
test.describe("좁은 폭 nav", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("390px: 테마 토글이 인증 UI 에 덮이지 않는다", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "다크 모드" });
    await toggle.click({ timeout: 3000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
  });
});

test.describe("최소 폭 nav", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test("320px: 가로 넘침이 없고 토글이 눌린다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "다크 모드" }).click({ timeout: 3000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
