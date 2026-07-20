import { expect, test } from "@playwright/test";
import { E2E_USER, signIn } from "./session";

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

/* 로그인 상태. 이 상태를 안 본 게 결함을 숨긴 원인이었다: 브랜드 폭은 형제가 남긴 잔여값이라
   로그아웃 320px 에서 44.02px 로 걸쳐 있다가 로그인하면 32.56px 로 떨어졌는데, 로그아웃만
   도는 e2e 는 통과했다.

   세션은 e2e/session.ts 가 서명한 access 쿠키로 만든다 — 한때 여기서 `.nav__auth` 에
   마크업을 주입했지만, 그건 컴포넌트가 그 마크업을 낸다는 보장이 없었다(이슈 #23). */
test.describe("nav 브랜드 — 로그인 상태", () => {
  for (const width of [320, 390]) {
    test(`${width}px: 로그인해도 브랜드가 44×44 를 지킨다`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await signIn(page.context(), baseURL!);
      await page.goto("/");

      // 세션이 정말 섰는지 먼저 못박는다 — 안 서면 아래 단언들이 "로그아웃 상태에선 통과"라
      // 조용히 초록이 된다(브랜드 폭 압박이 사라지므로 정확히 이 스펙이 잡으려는 회귀를 놓친다).
      await expect(
        page.locator(".nav__signout"),
        "로그인 nav 가 안 떴다 — dev 서버가 .dev.vars.e2e 의 세션 키를 못 읽은 것이다(남의 dev 서버를 재사용 중이거나 서버 부팅 뒤 키가 바뀌었다). e2e/session.ts 주석 참고",
      ).toBeVisible();

      const box = (await page.locator(".nav .brand").boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);

      // 브랜드에 바닥을 깔면 그 폭이 형제를 밀 수 있다 — 넘침과 토글 덮임으로 확인한다.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      /* 덮임은 두 겹으로 본다. elementFromPoint 는 "토글 중심의 최상위 요소가 토글인가"를
         직접 묻고(덮은 게 무엇인지도 알려 준다), click() 은 Playwright 의 actionability 로
         같은 것을 한 번 더 확인한다. 인증 슬롯 넘침이 토글을 덮었던 회귀가 이 자리다. */
      const toggle = page.getByRole("button", { name: "다크 모드" });
      const t = (await toggle.boundingBox())!;
      const hit = await page.evaluate(
        (p) => document.elementFromPoint(p.x, p.y)?.closest(".theme-toggle")?.className ?? null,
        { x: t.x + t.width / 2, y: t.y + t.height / 2 },
      );
      expect(hit).toBe("theme-toggle");
      await toggle.click({ timeout: 3000 });
    });
  }
});

/* 데스크톱 폭에선 이름이 말줄임되면 안 된다. .nav__user-name 의 max-width 는 6em 인데, 그
   값은 "사이트 주인공 이름(공백 포함 6자)이 온전히 들어가는 최소 단"으로 유도됐다 —
   5em 이던 시절 1280px 에서까지 "챠이로 …"로 잘렸다. 그래서 fixture 기본 채널명이 그
   경계값이고(E2E_USER), 상한을 줄이면 이 단언이 바로 깨진다.
   1280 은 시각 베이스라인이 찍히는 폭이기도 하다. */
test.describe("nav 채널명 — 로그인 상태", () => {
  test("1280px: 채널명이 말줄임되지 않는다", async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!);
    await page.goto("/");

    const name = page.locator(".nav__user-name");
    await expect(name).toHaveText(E2E_USER.channelName);
    /* 여유가 1px 인 건 의도다. 실측: 이 이름의 콘텐츠 폭 ≈72px, 상한 6em=84px 라 지금은
       차이가 0 이고, 상한을 5em(70px)으로 되돌리면 2 가 된다(음성 대조 실행함). scrollWidth·
       clientWidth 는 정수로 반올림되니 0 을 요구하면 소수점 폭에서 흔들릴 수 있고, 2 를 허용하면
       5em 회귀를 못 잡는다 — 그 사이가 1 뿐이다. 이 값을 올리려면 재측정부터. */
    const clipped = await name.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(clipped).toBeLessThanOrEqual(1);
  });
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
