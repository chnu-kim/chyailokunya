import { expect, test } from "@playwright/test";
import { signIn } from "./session";

/* 시각 스냅샷 베이스라인 — 3페이지 × 라이트/다크. 이 사이트는 prefers-color-scheme 가 아니라
   data-theme 로 테마를 정하므로, 첫 페인트 전 인라인 스크립트가 읽는 localStorage("theme")를
   goto 전에 심어 테마를 확정한다. 웹폰트가 다 로드된 뒤(document.fonts.ready) 찍고, 등장
   애니메이션은 config 의 reduced-motion + animations:"disabled" 로 꺼 안정화한다.

   베이스라인은 OS 별 파일이라(‑darwin/‑linux) CI(리눅스) 스모크에는 안 들어간다 — 로컬 dev
   회귀용이다. 처음 생성: npm run e2e:visual:update. 시각 패리티 판단은 사람 몫이다. */
const PAGES = [
  { name: "home", path: "/" },
  { name: "landing", path: "/landing" },
  { name: "games", path: "/games" },
] as const;

for (const p of PAGES) {
  for (const theme of ["light", "dark"] as const) {
    test(`시각: ${p.name} · ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("theme", t);
        } catch {
          // storage 가 막혀도 인라인 스크립트가 OS 선호로 떨어질 뿐 — 스냅샷엔 무해.
        }
      }, theme);

      // 등장 애니메이션을 꺼 스냅샷을 안정화한다(toHaveScreenshot 의 animations:"disabled"
      // 와 이중 안전장치). config 의 project use 대신 여기서 켠다 — 타입 이유(위 config 주석).
      await page.emulateMedia({ reducedMotion: "reduce" });

      await page.goto(p.path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.evaluate(() => document.fonts.ready);

      await expect(page).toHaveScreenshot(`${p.name}-${theme}.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}

/* 로그인 상태는 오래 시각 베이스라인이 0 장이었다(이슈 #23) — 헤더 재편 때 계정 영역을 크게
   고치고도 스냅샷이 한 장도 안 흔들렸다. 이제 세션 fixture 가 있으니 한 장 찍는다.

   페이지가 아니라 nav 만, 라이트만 찍는다. 로그인이 바꾸는 건 헤더의 계정 영역 하나뿐이라
   본문까지 담으면 무관한 diff(폰트·이미지)가 이 한 장을 흔들 뿐이고, 다크는 같은 토큰
   경로를 타서 위 6장이 이미 덮는다. 폭은 1280 — 이름이 안 잘리는 계약이 사는 폭이다
   (nav-touch-target.spec.ts 의 채널명 단언과 같은 자리). */
test("시각: nav 로그인 상태 · light", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("theme", "light");
    } catch {
      // 위 스냅샷들과 같은 이유로 무해하다.
    }
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page.context(), baseURL!);

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".nav__signout")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await expect(page.locator(".nav")).toHaveScreenshot("nav-signed-in-light.png", {
    animations: "disabled",
  });
});
