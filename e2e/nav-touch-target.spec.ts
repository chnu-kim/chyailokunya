import { expect, test } from "@playwright/test";

/* nav 크롬의 터치 타깃 회귀 방지. --nav-h 는 "12+12 패딩 + 44 자식 + 1.5 보더"로 유도되는데
   브랜드만 콘텐츠 높이(25px)로 남아 그 전제를 어기고 있었다. 44 하한은 실측상 nav 높이를
   안 바꾸므로(형제 링크·토글이 이미 44 를 세운 flex 행이다) 누군가 "레이아웃에 영향 없는 줄"로
   보고 지우기 쉽다 — 그래서 여기서 못박는다.
   폭은 home.spec.ts 의 두 describe 를 따른다: 390 은 nav 압축 회귀가 가장 심했던 폭,
   320 은 WCAG 1.4.10 reflow 기준 폭이다. */

const PAGES = ["/", "/landing", "/games"] as const;

test.describe("nav 브랜드 터치 타깃", () => {
  for (const width of [320, 390]) {
    for (const path of PAGES) {
      test(`${width}px ${path}: 브랜드가 44 하한을 지키고 눌린다`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);

        const brand = page.locator(".nav .brand");
        const box = await brand.boundingBox();
        expect(box).not.toBeNull();
        // click() 은 덮임만 본다 — 크기는 여기서 따로 잰다. 폭도 재는 건 min-width:44 가
        // 있어서다. 그게 없던 시절엔 이 단언이 잔여 폭(320px 에서 44.02px)에 기대 우연히
        // 통과했다 — 아래 로그인 describe 가 그 우연을 깨는 조건을 건다.
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);

        // 덮임 판정. 브랜드는 홈으로 가는 진짜 링크라 포인터로 눌려야 의미가 있다.
        await brand.click({ timeout: 3000 });
        await expect(page).toHaveURL(/\/$/);

        // 44 하한이 세로에만 걸리고 가로 계약을 안 건드리는지 같은 자리에서 확인한다.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  }
});

/* 로그인 상태는 e2e 픽스처가 없어(쓰기 UI 는 역할이 있어야 뜬다) 마크업 주입으로 만든다.
   이 상태를 안 본 게 결함을 숨긴 원인이었다: 브랜드 폭은 형제가 남긴 잔여값이라 로그아웃
   320px 에서 44.02px 로 걸쳐 있다가 로그인하면 32.56px 로 떨어졌는데, 로그아웃만 도는
   e2e 는 통과했다. 긴 채널명은 6em 상한에 걸려 ellipsis 되지만 형제 폭 압박은 최대가 된다. */
const SIGNED_IN = `<span class="nav__user-name">아주아주긴채널이름입니다정말로</span><button class="nav__signout" type="button">로그아웃</button>`;

test.describe("nav 브랜드 — 로그인 상태", () => {
  for (const width of [320, 390]) {
    test(`${width}px: 로그인해도 브랜드가 44×44 를 지킨다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");

      await page.evaluate((html) => {
        const auth = document.querySelector(".nav__auth");
        if (!auth) throw new Error(".nav__auth 없음 — nav 마크업이 바뀌었다");
        auth.innerHTML = html;
      }, SIGNED_IN);

      const box = (await page.locator(".nav .brand").boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);

      // 브랜드에 바닥을 깔면 그 폭이 형제를 밀 수 있다 — 넘침과 토글 덮임으로 확인한다.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: /모드/ }).click({ timeout: 3000 });
    });
  }
});

/* skip-link 는 포커스 전엔 화면 밖이라 "키보드 전용이니 44 는 면제"로 오해되기 쉽다.
   실제로는 포커스로 내려오면 화면에 그려지고 포인터로 히트된다 — 면제 대상이 아니다.
   transform transition 이 끝나기 전에 재면 음수 y 가 잡히니 도착을 기다린 뒤 잰다. */
test.describe("skip-link 터치 타깃", () => {
  for (const width of [320, 1280]) {
    test(`${width}px: 포커스된 skip-link 가 44 하한을 지킨다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");

      const skip = page.locator("a.skip-link");
      await page.keyboard.press("Tab");
      await expect(skip).toBeFocused();
      await expect
        .poll(async () => (await skip.boundingBox())!.y, { timeout: 2000 })
        .toBeGreaterThanOrEqual(0);

      const box = (await skip.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    });
  }
});

/* nav 높이는 브랜드가 아니라 링크·토글의 44 가 정한다. "브랜드 44 하한이 nav 를 안 민다"가
   이 변경의 안전 근거였으므로 그 성질을 실측값으로 직접 못박는다 — 부등식으로 두면 브랜드를
   25px 로 되돌려도 통과해 회귀를 못 잡는다. 1280 은 시각 베이스라인 6장이 찍히는 폭이라
   여기가 흔들리면 스냅샷이 통째로 깨진다. */
test.describe("nav 높이 안정성", () => {
  for (const width of [320, 390, 560, 1280]) {
    test(`${width}px: nav 높이가 69px 로 고정된다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const nav = await page.locator(".nav").boundingBox();
      expect(nav).not.toBeNull();
      // 69 = 12+12 패딩 + 44 자식 + 1px(1.5px 보더가 dpr=1 에서 장치 픽셀로 스냅된 값).
      expect(nav!.height).toBeCloseTo(69, 0);
    });
  }
});
