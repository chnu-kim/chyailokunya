import { expect, test } from "@playwright/test";

test("소개: 히어로·프로필·소셜 3채널(새 창)이 렌더되고 디스코드는 없다", async ({ page }) => {
  await page.goto("/landing");

  await expect(page.getByRole("heading", { level: 1, name: "Chyailo Kunya" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "쿠냐 프로필" })).toBeVisible();

  // 현재 라우트에 aria-current="page"
  await expect(page.locator('.nav__link[href="/landing"]')).toHaveAttribute("aria-current", "page");

  // 채널은 3개뿐, 전부 새 창(sr-only 안내 포함)
  const chzzk = page.locator('[data-od-id="social-link-chzzk"]');
  await expect(chzzk).toHaveAttribute("href", /chzzk\.naver\.com/);
  await expect(chzzk).toHaveAttribute("target", "_blank");
  await expect(chzzk.locator(".sr-only")).toHaveText("(새 창에서 열림)");

  await expect(page.locator('[data-od-id="social-link-youtube"]')).toHaveAttribute(
    "href",
    /youtube\.com\/@CHYAILOKUNYA/,
  );
  await expect(page.locator('[data-od-id="social-link-x"]')).toHaveAttribute(
    "href",
    "https://x.com/chyailokunya",
  );

  // 불변식 #5 — 디스코드는 운영하지 않으므로 언급·링크가 없어야 한다.
  await expect(page.getByText(/discord/i)).toHaveCount(0);
});

test("소개: 로그인 링크가 현재 경로를 return_to 로 실어 보낸다(이슈 #25)", async ({ page }) => {
  // 로그인 후 /games 로 떨어지던 하드코딩을 대체하는 배선의 클라이언트 절반이다 —
  // 서버 절반(화이트리스트 검증)은 core/auth.test.ts 의 safeReturnTo 가 못박는다.
  await page.goto("/landing");
  await expect(page.locator('[data-od-id="login"]')).toHaveAttribute(
    "href",
    "/api/auth/login?return_to=%2Flanding",
  );
});
