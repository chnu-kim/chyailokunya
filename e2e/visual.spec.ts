import { expect, test } from "@playwright/test";
import { expectSignedIn, signIn } from "./session";

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

   페이지가 아니라 nav 만, 라이트만 찍는다. 로그인이 바꾸는 건 헤더의 계정 영역 하나뿐이고,
   다크는 같은 토큰 경로를 타서 위 6장이 이미 덮는다. 폭은 1280 — 이름이 안 잘리는 계약이
   사는 폭이다(nav-touch-target.spec.ts 의 채널명 단언과 같은 자리).

   범위를 좁혀도 **본문에서 완전히 독립하진 못한다**: .nav 는 반투명 + backdrop-filter:blur(8px)
   라 뒤에 깔린 히어로가 블러된 채 이 한 장에 구워진다. 홈 상단을 바꾸면 이 베이스라인도 같이
   깨진다 — 그건 nav 회귀가 아니라 예상된 갱신이니 그때 재생성한다(npm run e2e:visual:update). */
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
  await expectSignedIn(page);
  await page.evaluate(() => document.fonts.ready);

  await expect(page.locator(".nav")).toHaveScreenshot("nav-signed-in-light.png", {
    animations: "disabled",
  });
});

/* 게임 보드의 **쓰기 권한 상태**. 위 games 두 장은 로그아웃이라 수정·삭제 액션이 DOM 에
   아예 없다 — 그 줄이 세 번(툴바 판 → 원형 칩 → 사진 밑 잉크 자국) 갈아엎히는 동안 시각
   회귀가 매번 초록이었는데, 잘 돌아서가 아니라 **안 봤기 때문**이다. 그 공백을 메운다.

   nav 스펙과 달리 **두 테마 다 찍는다.** 이 줄이 쓰는 --fg-muted·--danger 는 다크에서
   .polaroid 사진지 섬이 라이트 값으로 되돌리는 토큰이라(chrome.css), 되돌림이 깨지면
   크림 종이 위에서 조용히 씻긴다 — 그게 이 부품의 유일한 접근성 실패 경로고 라이트 한 장은
   그걸 못 본다. 대비 계산이 잡는 축이지만 계산은 사람이 안 돌리면 안 돌아간다.

   범위는 카드 하나가 아니라 **.games 격자 전체**다. 액션 줄이 카드를 50px 높이는데,
   액션 줄이 없는 .addslot(게임 추가)과 기준선이 어긋나는지는 격자를 봐야 드러난다.
   .addslot 은 이제 align-self:start 로 늘어나기를 거부하므로(games.css) 카드 키가 서로
   다른 게 정상이다 — 라벨과 .game__name 의 기준선 대응은 그래도 유지된다(offsetTop 어긋남
   0). 픽스처가 결정적이라(e2e/fixtures/games.sql, poster null) 격자를 넓게 잡아도
   흔들리지 않는다.

   **라이트 한 장은 카드 키 변화를 못 잡는다 — 이 베이스라인의 알려진 맹점이다.** .addslot 이
   줄면서 드러나는 자리가 라이트에선 흰 종이(#fff) → 거의 흰 노트 배경이라 픽셀 차가
   Playwright 기본 threshold 0.2(YIQ) 아래로 떨어져 **낡은 베이스라인이 초록으로 통과했다**
   (다크는 크림 섬 → 검정이라 21254px 로 즉시 빨개졌다). 실제로 이번에 라이트 파일을 지우고
   다시 구워야 했다. 카드 기하를 바꿨는데 다크만 빨개지면 라이트가 무사한 게 아니라 못 본
   것이다 — 두 장 다 지우고 재생성해라. */
for (const theme of ["light", "dark"] as const) {
  test(`시각: games 쓰기 권한 · ${theme}`, async ({ page, baseURL }) => {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {
        // 위 스냅샷들과 같은 이유로 무해하다.
      }
    }, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // 격자가 한 화면에 다 들도록 키운다. 안 그러면 Playwright 가 요소를 뷰포트로 스크롤하는데
    // nav 가 sticky 라 격자 위에 겹쳐 구워진다 — 그러면 nav 를 고칠 때마다 이 베이스라인이
    // 엉뚱하게 깨진다(로그인 nav 스냅샷이 히어로 블러에 물린 것과 같은 종류의 결합).
    await page.setViewportSize({ width: 1280, height: 1600 });
    await signIn(page.context(), baseURL!);

    await page.goto("/games");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectSignedIn(page);
    await page.evaluate(() => document.fonts.ready);
    /* 쓰기 권한이 격자에 실제로 드러났는지 먼저 못박는다 — 권한이 빠지면 이 스냅샷은 위
       로그아웃 두 장과 같은 그림이 되어 "찍었는데 아무것도 안 본" 초록이 된다.
       한때 여기서 카드의 수정 버튼을 봤는데, 수정·삭제가 상세 모달로 내려가며 격자에서
       사라졌다 — 지금 격자에 남은 권한의 흔적은 첫 칸의 빈 종이 하나뿐이다. */
    await expect(page.locator('[data-od-id="composer-open"]')).toBeVisible();

    await expect(page.locator(".games")).toHaveScreenshot(`games-signed-in-${theme}.png`, {
      animations: "disabled",
    });
  });
}
