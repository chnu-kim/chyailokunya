import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectSignedIn, signIn } from "./session";

/* 좁은 폭 **본문** 회귀 방지(이슈 #45). nav-touch-target.spec.ts 가 크롬을 맡고 여기가 그
   아래를 맡는다 — 전에는 좁은 폭을 보는 스펙이 둘 다 nav 만 재서, 페이지 본문은 어느 폭에서도
   기계가 안 보는 상태였다(시각 베이스라인 6장은 전부 1280 데스크톱이고 OS 별 파일이라 CI 에도
   없다). 홈 601~928px 넘침(#24)이 정확히 그 공백에서 나온 버그다.

   폭은 nav 스펙과 같은 320·390 이다. 이 둘 사이에는 브레이크포인트가 하나도 없어서 — chrome
   699/560/430, home 760/600, landing 860/560, games 560/480 — 두 폭 모두 "모든 좁은 폭
   쿼리가 이미 발동한" 같은 구간에 있다. 그래서 이 둘만으로는 **감축이 실제로 일어나는지**를
   증명하지 못한다(어느 쪽이든 접힌 뒤의 결과만 본다). 전환 자체는 경계 ±1px 로 따로 못박는다. */

const PAGES = ["/", "/landing", "/games"] as const;
const NARROW = [320, 390] as const;

/* WCAG 1.4.10 reflow 의 판정 그대로 — 320px 에서 가로 스크롤이 생기면 안 된다.
   scrollWidth·clientWidth 는 정수로 반올림되므로 0 이 "완전히 딱 맞음"이 아니라 "1px 미만
   초과"까지 포함한다. 그 관용을 넓히지 마라: 이 저장소가 실제로 겪은 넘침은 카드 회전 모서리·
   인증 슬롯 압박처럼 수 px 단위라 1px 만 풀어 줘도 다 통과한다. */
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe("본문 가로 넘침", () => {
  for (const width of NARROW) {
    for (const path of PAGES) {
      test(`${width}px ${path}: 가로 스크롤이 없다`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        // 폰트 확정 전에는 폴백 폭으로 재게 된다 — 한글 폴백이 좁으면 진짜 넘침을 놓친다.
        await page.evaluate(() => document.fonts.ready);
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      });
    }
  }
});

/* 페이지 넘침 0 은 **텍스트가 안 잘린다는 뜻이 아니다.** overflow:hidden 인 조상이 있으면
   자식이 제 상자를 넘겨도 문서는 안 늘어난다 — 잘려 보일 뿐 스크롤은 안 생기고, 위 단언은
   초록이다. 이 사이트의 좁은 폭 잘림은 실제로 그 모양으로 온다(카드 이름·날짜 줄·칩).

   **잎 요소만 본다.** 컨테이너까지 재면 잡음이 신호를 덮는다: 이 사이트의 콜라주는 회전한
   폴라로이드와 절대배치 장식(리본·테이프·마스코트)으로 만들어져 있고, 그것들은 부모의
   스크롤 상자를 정상적으로 넘긴다 — 실측으로 320px 에서 `.hero`·`.profile__grid`·`.ccard`
   등 아홉 군데가 그렇게 걸렸는데 전부 의도된 삐져나옴이다. 그 삐져나옴이 **해로운** 경우는
   문서를 늘릴 때뿐이고 그건 위 describe 가 이미 잡는다. 여기가 답할 질문은 다른 것이다:
   글자가 제 상자 안에 드는가.

   `main` 아래만 보는 건 nav 가 의도적으로 자르는 곳이기 때문이다(`.nav__user-name` 은 6em
   상한으로 잘리는 게 계약이다 — 그건 nav 스펙이 그 자리에서 본다).

   `.sr-only` 는 1px 상자에 가둬 두는 게 정의라 언제나 넘친다(실측 +103px). 접근성 장치를
   레이아웃 결함으로 세면 이 스펙은 영원히 빨갛다.

   허용 오차 1px 은 소수점 레이아웃이 정수로 반올림될 때의 흔들림 몫이다. 실패 시 무엇이
   넘쳤는지 셀렉터·수치를 같이 뱉는다 — "어딘가 넘쳤다"만으로는 못 고친다. */
async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("main *")) {
      // 자식 요소를 가진 상자는 레이아웃 컨테이너다 — 위 주석의 이유로 건너뛴다.
      if (el.children.length > 0) continue;
      /* 글자가 없는 상자는 이 질문의 대상이 아니다. 장식은 **일부러** 제 상자를 넘긴다 —
         `.kv__ribbon` 은 72px 상자에 104px 띠를 넣고 overflow:hidden 으로 모서리 삼각형을
         오려 내는 구조라(landing.css:134) 언제나 +18px 로 걸린다. 폭과 무관한 상시 상태라
         좁은 폭 회귀를 하나도 못 알려 주면서 이 스펙만 영원히 빨갛게 만든다. */
      if (!el.textContent?.trim()) continue;
      if (el.classList.contains("sr-only")) continue;
      // clientWidth 0 은 인라인·치환 요소(svg, img)라 이 판정이 의미 없다.
      const over = el.scrollWidth - el.clientWidth;
      if (el.clientWidth === 0 || over <= 1) continue;
      // 스스로 스크롤하겠다고 선언한 상자는 넘침이 정상이다.
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") continue;
      const id = el.getAttribute("data-od-id");
      out.push(`${el.tagName.toLowerCase()}${id ? `[${id}]` : `.${el.className}`} +${over}px`);
    }
    return out;
  });
}

test.describe("본문 텍스트 잘림", () => {
  for (const width of NARROW) {
    for (const path of PAGES) {
      test(`${width}px ${path}: 글자가 제 상자 안에 든다`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        expect(await clippedText(page)).toEqual([]);
      });
    }
  }
});

/* 감축 경로가 **실제로 도는가**. 위 두 describe 는 접힌 뒤의 결과만 보므로, 브레이크포인트를
   지워도 다른 폭에서 우연히 통과할 수 있다. 경계 ±1px 로 전환 자체를 못박으면 그 우연이
   사라진다 — 값을 옮기면 두 단언 중 하나가 반드시 깨진다.

   gridTemplateColumns 는 계산값이 픽셀로 나오므로(`1fr 1fr` 이 아니라 `140px 140px`) 문자열
   비교가 아니라 **트랙 개수**로 판정한다. 개수만 보는 건 의도적이다: 정확한 픽셀을 박으면
   패딩·gap 을 건드리는 무관한 변경마다 이 스펙이 깨져 신호가 잡음이 된다. */
async function trackCount(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
}

const REDUCTIONS = [
  // home.css:209 — 카드가 읽을 만한 폭을 못 가지면 접는다. 761 이 2열이 유지되는 마지막 폭.
  { path: "/", selector: ".cards", boundary: 760 },
  // landing.css:506 — hero 2열(minmax(0,1fr) 360px) → 1열, 사진이 order:-1 로 위에 선다.
  { path: "/landing", selector: ".hero__grid", boundary: 860 },
  // 같은 쿼리가 profile 도 접는다(320px minmax(0,1fr) → 1fr). 한 쿼리에 둘이 들었으니 둘 다 본다.
  { path: "/landing", selector: ".profile__grid", boundary: 860 },
] as const;

test.describe("감축 경로 — 경계", () => {
  for (const r of REDUCTIONS) {
    test(`${r.selector}: ${r.boundary}px 경계에서 2열 → 1열`, async ({ page }) => {
      await page.setViewportSize({ width: r.boundary, height: 800 });
      await page.goto(r.path);
      expect(await trackCount(page, r.selector), `${r.boundary}px 는 접혀야 한다`).toBe(1);

      // +1px 쪽이 이 스펙의 이빨이다. 접힌 쪽만 보면 브레이크포인트를 **더 넓게** 옮겨도
      // 통과한다 — 두 폭을 같이 봐야 값이 정확히 여기임이 고정된다.
      await page.setViewportSize({ width: r.boundary + 1, height: 800 });
      expect(await trackCount(page, r.selector), `${r.boundary + 1}px 는 2열이어야 한다`).toBe(2);
    });
  }
});

/* `.games` 는 경계로 못 잡는다. 기본이 `auto-fill minmax(168px, 1fr)` 라 480 위아래가 둘 다
   2열이어서(실측 480 → 204px 204px, 481 → 204.5px 204.5px) ±1px 대조가 통과하나 마나다.
   games.css:794 의 역할은 **전환이 아니라 하한**이다: auto-fill 은 트랙 하나가 168px 을 못
   받으면 1열로 떨어지는데(320px 에서 콘텐츠 폭 272px < 168×2 + gap 24), 그 규칙이 2열을
   붙잡는다. 그래서 좁은 폭 자체에서 열 수를 못박는 게 맞는 판정이다 — 규칙을 지우면 320·390
   둘 다 1열이 되어 여기서 걸린다.

   2열을 지키는 게 왜 계약인가: 이 값에는 "2열이 되어도 카드 각도는 남긴다"는 계산이 딸려 있고
   (최악 360px 에서 카드 144px·높이 ~275px·최대 1.2° → 모서리 밀림 2.9px < 열 gap 24px),
   그 계산이 "썸네일 비율·ROT 폭·1열 전환 중 하나라도 바뀌면 다시 한다"는 조건을 달고 있다.
   지금까지 그 조건이 깨져도 알려 줄 것이 없었다. */
test.describe("감축 경로 — 하한", () => {
  for (const width of NARROW) {
    test(`${width}px .games: 2열이 유지된다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/games");
      expect(await trackCount(page, ".games")).toBe(2);
    });
  }
});

/* 본문 인터랙티브 요소의 44×44.

   **크기와 덮임은 다른 것을 잡는다.** click() 은 덮였는지만 보고 크기는 안 본다 — nav 결함
   2건(`.nav .brand` 25px · `.skip-link` 42px)이 게이트 6종을 전부 초록으로 통과한 이유가
   정확히 이것이다. 그래서 boundingBox() 로 재고, 링크는 눌러서 덮임까지 본다.

   세로만 재지 않는다. 폭이 잔여값으로 정해지는 요소는 세로 하한만 걸면 가로가 짜부라져도
   통과한다(nav 브랜드가 320px 에서 44.02px 로 아슬하게 걸쳐 있던 게 그 사례다). */
async function expectTouchTarget(el: Locator, label: string): Promise<void> {
  const box = await el.boundingBox();
  expect(box, `${label}: 상자를 못 잰다`).not.toBeNull();
  expect(box!.width, `${label} 폭`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${label} 높이`).toBeGreaterThanOrEqual(44);
}

test.describe("본문 터치 타깃", () => {
  for (const width of NARROW) {
    test(`${width}px /: 홈 카드가 44 하한을 지키고 눌린다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);

      for (const id of ["nav-card-about", "nav-card-games"]) {
        await expectTouchTarget(page.locator(`[data-od-id="${id}"]`), id);
      }
      // 덮임까지 본다 — 마스코트 스티커가 이 카드 위로 겹쳐 앉는 자리다(home.css:386).
      await page.locator('[data-od-id="nav-card-games"]').click({ timeout: 3000 });
      await expect(page).toHaveURL(/\/games$/);
    });

    test(`${width}px /landing: CTA 와 소셜 링크가 44 하한을 지킨다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/landing");
      await page.evaluate(() => document.fonts.ready);

      for (const id of [
        "cta-channels",
        "cta-games",
        "social-link-chzzk",
        "social-link-youtube",
        "social-link-x",
      ]) {
        await expectTouchTarget(page.locator(`[data-od-id="${id}"]`), id);
      }
    });
  }
});

/* `/games` 본문은 **로그인해야 인터랙티브 요소가 생긴다** — 추가·수정·삭제가 전부 canWrite/
   canDelete 뒤라 로그아웃 상태로 좁은 폭을 재면 이 페이지의 터치 타깃 검사가 0 건이 된다
   (검사한 척만 하는 초록이다). 그래서 픽스처가 user 1 에 admin 을 부여한다(e2e/fixtures/games.sql).

   수정·삭제 판은 쉼 상태에서 opacity:0 + pointer-events:none 이라 hover 로 띄운 뒤 눌러야
   한다. boundingBox() 는 opacity 와 무관하게 상자를 주므로 **크기는 hover 없이도** 재진다 —
   반대로 말하면 크기만 재고 넘어가면 "보이지도 않는데 통과"가 되므로 덮임은 hover 뒤에 본다. */
test.describe("본문 터치 타깃 — 쓰기 권한", () => {
  for (const width of NARROW) {
    test(`${width}px /games: 추가·수정·삭제가 44 하한을 지킨다`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await signIn(page.context(), baseURL!);
      await page.goto("/games");
      await expectSignedIn(page);
      await page.evaluate(() => document.fonts.ready);

      await expectTouchTarget(page.locator('[data-od-id="composer-open"]'), "게임 추가");

      const card = page.locator('[data-od-id="game-card-1"]');
      await card.hover();
      for (const id of ["game-edit-1", "game-del-1"]) {
        await expectTouchTarget(page.locator(`[data-od-id="${id}"]`), id);
      }
      // 판이 카드 밖으로 밀리면 잘려서 실제로는 못 누른다 — 눌러서 확인한다.
      await page.locator('[data-od-id="game-del-1"]').click({ timeout: 3000 });
      await expect(page.locator('[data-od-id="game-delete-cancel"]')).toBeVisible();
    });
  }
});

/* composer 는 560 이하에서 바텀시트가 된다(games.css:479). 다이얼로그는 열려야 존재하므로
   위 넘침 스펙이 못 보는 자리다 — 좁은 폭에서 화면 밖으로 나가거나 날짜 필드가 안 감기면
   여기서 걸린다. 560 은 바텀시트가 켜지는 **경계 자신**이라, 이 폭이 통과하면 그 아래는
   같은 규칙 안이다. */
test.describe("composer 바텀시트", () => {
  for (const width of [320, 560]) {
    test(`${width}px: composer 가 화면 안에 들고 넘치지 않는다`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await signIn(page.context(), baseURL!);
      await page.goto("/games");
      await expectSignedIn(page);

      await page.locator('[data-od-id="composer-open"]').click();
      const dialog = page.locator("dialog.composer");
      await expect(dialog).toBeVisible();

      const box = (await dialog.boundingBox())!;
      expect(box.x, "왼쪽으로 삐져나갔다").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "오른쪽으로 삐져나갔다").toBeLessThanOrEqual(width);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

      // 검색 입력은 손가락으로 눌러야 하는 첫 관문이다.
      await expectTouchTarget(page.locator('[data-od-id="composer-input"]'), "검색 입력");
    });
  }
});
