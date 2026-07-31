import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openDay } from "./schedule-helpers";
import { E2E_FAN, expectSignedIn, signIn } from "./session";

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
/* 팬아트 업로드용 1×1 PNG(fanart.spec 과 같은 파일). 여기선 그림이 **떠 있는 상태**를 만드는
   용도이고(내리기·표기 칸이 그때만 DOM 에 있다) 치수는 재지 않는다. */
const FANART_PNG = fileURLToPath(new URL("./fixtures/fanart-2x3.png", import.meta.url));

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

   **두 가지를 본다. 자기 상자만 재면 이 사이트의 잘림을 거의 다 놓친다.**

   (1) 자기 넘침 — `scrollWidth > clientWidth`.
   (2) **가장 가까운 클리핑 조상의 상자를 넘는가** — `getBoundingClientRect` 로 가로만 비교.

   (1) 만 두면 `white-space: nowrap` 이면서 **동시에** 자기 폭이 제한된 좁은 경우에만 걸린다.
   이 사이트 본문은 그렇게 안 생겼다: 글자는 `overflow-wrap: anywhere` 로 감기고
   (games.css:590) 폭 제한은 조상이 건다. (2) 가 그 경로를 맡는다 — 실측으로 조상이
   오려 내는 회귀를 `span.game__date div.game__body 밖으로 +12px` 처럼 짚어 낸다.

   **잘림이 아닌 회귀는 여기가 아니라 위 describe 가 잡는다. 그 분담을 알고 있어야 한다.**
   `.game__name` 에 nowrap 만 주면 상자가 429px 로 부푸는데, 이 보드의 그리드 트랙은
   `1fr 1fr`(= `minmax(auto, 1fr)`)라 **트랙이 같이 늘어난다** — 아무것도 안 잘리므로 (1)·(2)
   둘 다 정당하게 통과하고, 대신 문서가 늘어나 가로 넘침 축이 2건으로 잡는다(음성 대조 실행함).
   여기서 그걸 같이 잡으려 들면 "글자가 제 상자 안에 드는가"가 아닌 것을 재게 된다.

   **세로는 안 잰다.** `-webkit-line-clamp` 로 두 줄에서 자르는 게 이 보드의 **계약**이라
   (games.css:591-595, 픽스처 6번이 일부러 긴 이름으로 그걸 덮는다) `scrollHeight >
   clientHeight` 를 결함으로 세면 의도한 설계가 빨개진다. 그래서 세로 잘림이 새로 생기는
   변경은 여전히 사람이 본다 — SKILL.md §6.3 에 그렇게 적어 뒀다.

   허용 오차 1px 은 소수점 레이아웃이 정수로 반올림될 때의 흔들림 몫이다. 실패 시 무엇이
   넘쳤는지 셀렉터·수치를 같이 뱉는다 — "어딘가 넘쳤다"만으로는 못 고친다. */
async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scrolls = (v: string) => v === "auto" || v === "scroll";
    const clips = (v: string) => v === "hidden" || v === "clip";

    // 클래스 이름 읽기 — SVG 요소의 className 은 문자열이 아니라 SVGAnimatedString 이다.
    const name = (el: Element) => {
      const id = el.getAttribute("data-od-id");
      if (id) return `${el.tagName.toLowerCase()}[${id}]`;
      const cls = typeof el.className === "string" ? el.className : el.getAttribute("class");
      return `${el.tagName.toLowerCase()}${cls ? `.${cls.trim().split(/\s+/).join(".")}` : ""}`;
    };

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

      const ox = getComputedStyle(el).overflowX;
      // (1) 자기 넘침. clientWidth 0 은 인라인·치환 요소라 이 판정이 의미 없다.
      const over = el.scrollWidth - el.clientWidth;
      if (el.clientWidth > 0 && over > 1 && !scrolls(ox)) {
        out.push(`${name(el)} 자기 상자 +${over}px`);
        continue;
      }

      // (2) 클리핑 조상을 넘는가. 스크롤 가능한 조상은 잘림이 아니라 스크롤이므로 제외한다.
      const box = el.getBoundingClientRect();
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (scrolls(s.overflowX)) break;
        if (!clips(s.overflowX)) continue;
        const pb = p.getBoundingClientRect();
        const cut = Math.max(pb.left - box.left, box.right - pb.right);
        if (cut > 1) out.push(`${name(el)} ${name(p)} 밖으로 +${Math.round(cut)}px`);
        break;
      }
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

      /* +1px 쪽이 이 스펙의 이빨이다. 접힌 쪽만 보면 브레이크포인트를 **더 넓게** 옮겨도
         통과하고, `display:grid` 를 지우면 computed 값이 `none` 이라 트랙 1개로 읽혀
         접힌 쪽 단언마저 통과한다 — 두 폭을 같이 봐야 둘 다 막힌다.

         ±1px 대조는 **뷰포트 폭 = 미디어쿼리 폭**을 전제한다. 헤드리스 크로미움은 오버레이
         스크롤바라 그게 성립하지만, 스크롤바가 폭을 먹는 환경에서 돌리면 경계가 한 칸
         밀려 무너진다. 이 스펙을 다른 브라우저로 옮길 땐 여기부터 확인한다. */
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

   수정·삭제는 이제 카드가 아니라 **상세 모달** 안에 있다(game-board 주석) — 그래서 이 스펙도
   카드를 먼저 연다. 카드를 여는 손잡이 자체의 터치 타깃은 boundingBox 로 못 잰다: 히트 영역을
   제목 버튼의 ::after 가 카드 전체로 넓히는데 그 의사요소는 요소 상자에 안 잡힌다(games.css).
   그래서 **카드 네 귀퉁이를 히트테스트**해 실제로 그 버튼이 잡히는지로 판정한다 — 44 하한은
   카드 크기가 이미 압도하므로 여기서 재야 할 것은 크기가 아니라 "정말 카드 전체가 눌리는가"다. */
test.describe("본문 터치 타깃 — 쓰기 권한", () => {
  for (const width of NARROW) {
    test(`${width}px /games: 추가·카드 열기·수정·삭제가 44 하한을 지킨다`, async ({
      page,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await signIn(page.context(), baseURL!);
      await page.goto("/games");
      await expectSignedIn(page);
      await page.evaluate(() => document.fonts.ready);

      await expectTouchTarget(page.locator('[data-od-id="composer-open"]'), "게임 추가");

      /* 카드 전체가 열기 버튼이다. 집게(.clip)가 z-index 로 카드 위쪽 가운데를 덮고 있어
         pointer-events 를 끄지 않으면 그 띠가 클릭을 삼키는데, 그게 정확히 여기서 잡힌다.

         **먼저 뷰포트 한가운데로 스크롤한다.** elementFromPoint 는 뷰포트 좌표를 받으므로
         화면 밖 카드는 통째로 null 을 돌려준다(2열 격자의 첫 카드는 390×800 에서 접힌 아래에
         있다 — 실측). center 로 넣는 건 sticky nav(69px)가 카드 윗변을 덮는 걸 함께 피한다. */
      /* behavior:"instant" 가 필수다 — 사이트가 `scroll-behavior: smooth` 를 켜 두고 있어
         기본값이면 스크롤이 애니메이션으로 진행되고, 곧바로 좌표를 읽으면 **스크롤 전 위치**가
         잡힌다(실측: 390 에서 top 이 541 그대로라 카드 아래쪽이 뷰포트 800 밖이었다). */
      await page
        .locator('[data-od-id="game-card-1"]')
        .evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      /* **세로 중심선 위에서만 찍는다.** 카드는 `--rest-rot` 로 기울어 있어
         getBoundingClientRect 가 회전 AABB 를 주는데, 그 네 모서리는 원래 카드 바깥 여백이다
         (390 에서 오른쪽 아래 모서리 안쪽 6px 이 실제로 카드 밖이었다). 회전 중심이 카드
         중심이라 중심선 위의 점만 각도와 무관하게 카드 안이 보장된다. */
      const hits = await page.evaluate(() => {
        const card = document.querySelector('[data-od-id="game-card-1"]') as HTMLElement;
        const r = card.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const pts: [string, number, number][] = [
          ["집게 아래", cx, r.top + 10],
          ["썸네일 한가운데", cx, r.top + r.height / 3],
          ["이름 줄", cx, r.bottom - 24],
        ];
        return pts.map(([name, x, y]) => {
          const el = document.elementFromPoint(x, y);
          return { name, od: el?.getAttribute("data-od-id") ?? el?.tagName ?? "none" };
        });
      });
      for (const h of hits) {
        expect(h.od, `${width}px: 카드 ${h.name} 이 열기 버튼에 안 걸린다`).toBe("game-open-1");
      }

      // 조작은 카드를 연 다음에 만난다.
      await page.locator('[data-od-id="game-open-1"]').click({ timeout: 3000 });
      const detail = page.locator('dialog[data-od-id="game-detail"]');
      await expect(detail).toBeVisible();

      const edit = page.locator('[data-od-id="game-edit-1"]');
      const del = page.locator('[data-od-id="game-del-1"]');
      await expectTouchTarget(edit, "수정");
      await expectTouchTarget(del, "삭제");

      // 상세 카드 밖으로 새면 잘려서 못 누른다 — 페이지 전체 넘침 스펙이 못 보는 자리다.
      const [dialogBox, editBox, delBox] = await Promise.all([
        detail.boundingBox(),
        edit.boundingBox(),
        del.boundingBox(),
      ]);
      for (const [name, b] of [
        ["수정", editBox],
        ["삭제", delBox],
      ] as const) {
        expect(b!.x, `${width}px: ${name} 이 상세 왼쪽으로 샜다`).toBeGreaterThanOrEqual(
          dialogBox!.x - 0.5,
        );
        expect(b!.x + b!.width, `${width}px: ${name} 이 상세 오른쪽으로 샜다`).toBeLessThanOrEqual(
          dialogBox!.x + dialogBox!.width + 0.5,
        );
      }

      // 파괴 액션 이격. margin-left:auto 가 삭제를 오른쪽 끝으로 밀어 오식 여유를 만든다 —
      // 이 값이 무너지면 되돌릴 수 없는 삭제가 수정 옆에 붙는다.
      expect(delBox!.x - editBox!.x, `${width}px: 수정·삭제 간격`).toBeGreaterThanOrEqual(44);

      // 덮여 있으면 크기가 맞아도 못 누른다 — 눌러서 확인한다.
      await del.click({ timeout: 3000 });
      await expect(page.locator('[data-od-id="game-delete-cancel"]')).toBeVisible();
    });
  }
});

/* `.addslot`(빈 종이)은 게임 카드 키를 따라 늘어나지 않는다 — `align-self: start`(games.css).
   격자가 `grid-auto-rows: 1fr` 라 기본값 stretch 로 두면 카드가 큰 만큼 빈 종이 안쪽에
   아무것도 없는 여백이 생긴다. 그 회귀를 **로컬 시각 스냅샷만** 잡고 있었고
   (다크만 빨개진다, 라이트는 흰 종이 → 흰 배경이라 threshold 아래) 베이스라인은 darwin
   전용이라 CI 에 없다 — 리눅스 CI 가 보는 자리는 여기뿐이라 여기에 못박는다.

   **키는 `offsetHeight` 로 잰다.** 카드가 `--rest-rot` 로 기울어 `getBoundingClientRect` 는
   회전 AABB 를 준다. 각도는 **좁은 폭에서도 안 풀린다** — 2열로 접히는 480 아래에서도 남긴다는
   게 명시된 결정이고 열 gap 침범 계산이 붙어 있다(games.css 의 480 미디어 쿼리).

   하한은 관측값이 아니라 **유도값**이다. 앞에서는 액션 줄(44 버튼 + 6 마진 = 50)이 그 차이를
   냈는데, 수정·삭제가 상세 모달로 내려가며 카드에서 사라졌다. 지금 남은 차이는 **클리어 칩
   줄** 하나다 — `.game__meta` = padding-top 8 + 칩 27 = 35. 그게 격자 전체에 퍼지는 건
   `grid-auto-rows: 1fr` 때문이다: 칩 있는 카드가 한 장이라도 있으면 **모든 행**이 그 키로
   수렴한다(실측: 8장이 폭마다 한 값 — 320/390/1280 에서 253·300·348).

   30 을 쓰는 건 35 에서 서브픽셀 반올림 여유를 뺀 값이다(실측 차 34~35). 하한만 보는 이유는
   그대로다 — `align-self` 를 stretch 로 되돌리면 차가 0 이 되므로 이빨은 이 하한으로도 난다.
   **픽스처에서 클리어 칩이 전부 사라지면 이 스펙은 이빨을 잃는다**(차이가 0 이 되어 무엇을
   해도 통과한다) — 칩 있는 게임을 지울 땐 여기부터 본다. */
test.describe("빈 종이 키", () => {
  for (const width of NARROW) {
    test(`${width}px /games: 빈 종이가 카드 키를 따라가지 않는다`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await signIn(page.context(), baseURL!);
      await page.goto("/games");
      await expectSignedIn(page);
      await page.evaluate(() => document.fonts.ready);

      const heights = await page.evaluate(() => ({
        add: (document.querySelector(".addslot") as HTMLElement).offsetHeight,
        game: (document.querySelector(".games .game") as HTMLElement).offsetHeight,
      }));

      expect(
        heights.game - heights.add,
        `${width}px: 빈 종이(${heights.add})가 카드(${heights.game}) 키까지 늘어났다`,
      ).toBeGreaterThanOrEqual(30);
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
      // 아래에서 상자를 재므로 폰트 확정을 기다린다 — 다른 describe 와 같은 이유다.
      await page.evaluate(() => document.fonts.ready);

      await page.locator('[data-od-id="composer-open"]').click();
      const dialog = page.locator("dialog.composer");
      await expect(dialog).toBeVisible();

      /* 이 두 줄이 보는 건 **화면 밖으로 안 나갔는가**뿐이다 — 안쪽으로 들어와 앉아도 통과한다.
         실제로 이슈 #68(오른쪽만 38px 빔)이 여기를 초록으로 지나갔다. 좌우가 화면 끝에 닿는지는
         아래 「바텀시트 전폭」이 별도로 못박는다. */
      const box = (await dialog.boundingBox())!;
      expect(box.x, "왼쪽으로 삐져나갔다").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "오른쪽으로 삐져나갔다").toBeLessThanOrEqual(width);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

      // 검색 입력은 손가락으로 눌러야 하는 첫 관문이다.
      await expectTouchTarget(page.locator('[data-od-id="composer-input"]'), "검색 입력");
    });
  }
});

/* 바텀시트는 **화면 끝에서 끝까지** 깔린다(이슈 #68).

   왜 별도 축인가: 위 「composer 바텀시트」의 두 단언은 "화면 밖으로 안 나갔는가"만 봐서,
   시트가 왼쪽에 붙고 오른쪽만 38px 비는 상태를 초록으로 통과시켰다. 시트의 계약은 "안에
   들어 있다"가 아니라 **좌우 여백 0** 이다 — 한쪽만 빈 시트는 화면이 기운 것처럼 읽힌다.

   38px 의 출처가 이 스펙이 지키는 제약이다: Chrome UA 스타일시트가 `dialog:modal` 에
   `max-width: calc(100% - 6px - 2em)` 을 거는데, 그건 기본 테두리(medium 3px 둘)와
   패딩(1em 둘)을 **content-box 기준으로 미리 뺀** 보정이라 box-sizing:border-box 인 이
   저장소에선 한 번 더 깎인다. 그 상태에서 시트는 `margin:0` + `left/right:0` 이라
   over-constrained 이고, over-constrained 의 승자는 언제나 `left` 다 — 깎인 몫이 전부
   오른쪽에 몰린다. games.css 의 `max-width: none` 이 그 상한을 끄고, 이 스펙이 그 줄을
   지운 순간 빨개진다(실측: 320 → 오른쪽 끝 282, 390 → 352, 560 → 522).

   **변종을 전부 연다.** 좁은 폭 규칙은 `dialog.composer` 하나에 걸려 있어 상세(`--detail`
   440px)·미저장 확인(`--confirm` 380px)·겹친 수정/삭제(`--stacked`)가 전부 그 폭 선언을
   덮어쓰는 구조다 — 어느 하나의 특정도가 올라가면 그 변종만 조용히 옛 폭으로 돌아간다.
   여기서 D1 은 안 건드린다(고르기·되돌리기·취소까지만 간다) — 픽스처를 공유하는 다른
   스펙과 안 싸운다.

   폭은 320·390(이슈가 지목한 두 폭)과 560(시트가 켜지는 경계 자신)이다. */
const SHEET_WIDTHS = [320, 390, 560] as const;

async function expectFlush(dialog: Locator, width: number, label: string): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box, `${label}: 상자를 못 잰다`).not.toBeNull();
  // 0.5px 은 소수점 레이아웃이 정수로 반올림될 때의 흔들림 몫이다. 이 스펙이 잡는 결함은
  // 38px 단위라 이 관용으로 이빨이 무뎌지지 않는다.
  expect(
    Math.abs(box!.x),
    `${width}px ${label}: 왼쪽이 ${box!.x} 에서 시작한다`,
  ).toBeLessThanOrEqual(0.5);
  expect(
    Math.abs(box!.x + box!.width - width),
    `${width}px ${label}: 오른쪽 끝이 ${box!.x + box!.width} 라 ${width} 에 안 닿는다`,
  ).toBeLessThanOrEqual(0.5);
}

test.describe("바텀시트 전폭", () => {
  for (const width of SHEET_WIDTHS) {
    test(`${width}px: 컴포저·상세·수정·삭제·미저장 확인이 좌우 끝에 닿는다`, async ({
      page,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await signIn(page.context(), baseURL!);
      await page.goto("/games");
      await expectSignedIn(page);
      await page.evaluate(() => document.fonts.ready);

      // (1) 컴포저. dirty 가 아니므로 Esc 가 그대로 닫는다.
      await page.locator('[data-od-id="composer-open"]').click();
      const composer = page.locator('dialog[data-od-id="composer"]');
      await expect(composer).toBeVisible();
      await expectFlush(composer, width, "컴포저");
      await page.keyboard.press("Escape");
      await expect(composer).toHaveCount(0);

      /* (2) 상세. behavior:"instant" 가 필수다 — 사이트가 `scroll-behavior: smooth` 를 켜 둬서
         기본값이면 클릭이 스크롤 전 좌표로 나간다(위 터치 타깃 describe 와 같은 이유). */
      await page
        .locator('[data-od-id="game-card-1"]')
        .evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.locator('[data-od-id="game-open-1"]').click();
      const detail = page.locator('dialog[data-od-id="game-detail"]');
      await expect(detail).toBeVisible();
      await expectFlush(detail, width, "상세(--detail 440px)");

      // (3) 수정 — 상세 **위에** 겹쳐 뜬다(--stacked).
      await page.locator('[data-od-id="game-edit-1"]').click();
      const editor = page.locator('dialog[data-od-id="game-editor"]');
      await expect(editor).toBeVisible();
      await expectFlush(editor, width, "수정(--stacked)");

      /* (4) 미저장 확인 — 클리어 체크를 뒤집으면 dirty 가 되고, 그때의 Esc 가 이 카드를 부른다.
         검색으로 dirty 를 만들면 치지직 프록시를 가로채야 하는데(games-composer.spec.ts),
         여기서 볼 것은 검색이 아니라 폭이라 그 배선을 안 들인다. */
      await page.locator('[data-od-id="editor-clear-cleared"]').click();
      await page.keyboard.press("Escape");
      const discard = page.locator('dialog[data-od-id="game-editor-discard"]');
      await expect(discard).toBeVisible();
      await expectFlush(discard, width, "미저장 확인(--confirm 380px)");
      await page.locator('[data-od-id="game-editor-discard-keep"]').click();
      await expect(discard).toHaveCount(0);
      // 취소는 dirty 가드를 안 거친다(부모가 세우는 closing 신호 — game-dialog.tsx).
      await page.locator('[data-od-id="game-editor-cancel"]').click();
      await expect(editor).toHaveCount(0);

      // (5) 삭제 확인. 여는 데까지만 간다 — 확정하면 픽스처가 줄어 남의 스펙이 빨개진다.
      await page.locator('[data-od-id="game-del-1"]').click();
      const del = page.locator('dialog[data-od-id="game-delete"]');
      await expect(del).toBeVisible();
      await expectFlush(del, width, "삭제 확인(--stacked)");
    });
  }
});

/* 시트가 **켜지고 꺼지는** 자리. 위 describe 는 켜진 뒤의 결과만 보므로 560px 쿼리를 통째로
   지우거나 넓게 옮겨도 다른 데서 우연히 통과할 수 있다 — 경계 ±1px 로 전환 자체를 못박는다
   (이 파일의 「감축 경로 — 경계」와 같은 장치다).

   561 쪽 단언이 이 테스트의 이빨이다: 좌우 여백이 **같고 0 이 아닌지**를 본다. 폭을 안 박는
   건 의도적이다 — `--detail` 의 440px 은 디자인 값이라 패딩·토큰이 바뀌면 따라 움직이는데,
   그때마다 이 스펙이 깨지면 신호가 잡음이 된다. 여기서 지킬 계약은 "넓은 폭에선 가운데"다.

   열린 채로 뷰포트만 넓힌다 — 시트/카드 전환은 CSS 미디어 쿼리라 리마운트가 필요 없고,
   같은 요소를 재야 "전환됐다"가 요소 교체로 가려지지 않는다. */
test("560/561 경계: 바텀시트가 켜지고, 한 픽셀 넓으면 가운데 카드로 돌아온다", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await signIn(page.context(), baseURL!);
  await page.goto("/games");
  await expectSignedIn(page);
  await page.evaluate(() => document.fonts.ready);

  await page
    .locator('[data-od-id="game-card-1"]')
    .evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.locator('[data-od-id="game-open-1"]').click();
  const detail = page.locator('dialog[data-od-id="game-detail"]');
  await expect(detail).toBeVisible();
  await expectFlush(detail, 560, "상세");

  await page.setViewportSize({ width: 561, height: 800 });
  const box = (await detail.boundingBox())!;
  expect(box.x, "561px 는 시트가 아니라 가운데 카드여야 한다").toBeGreaterThan(0);
  expect(
    Math.abs(box.x - (561 - box.x - box.width)),
    `561px: 좌우 여백이 다르다(왼 ${box.x} / 오른 ${561 - box.x - box.width})`,
  ).toBeLessThanOrEqual(0.5);
});

/* 팬 제안 진입점의 44 하한(ADR-0025). 위 블록과 **신원이 갈린다** — 「들어온 제안」은 관리자에게만,
   「게임 추가 요청」·「수정 제안」은 권한이 빈 팬에게만 뜨므로 한 세션으로는 셋을 다 못 잰다.

   여기서 재야 하는 이유: `.btn` 계열엔 min-height 가 없어 패딩만으로 서면 좁은 폭에서 44 가
   조용히 깨진다(.head__act 가 하한을 직접 박는 이유). 그리고 이 셋은 위 목록에 없어 기존
   스펙이 안 본다 — 셀렉터를 손으로 열거하는 구조라 새 조작은 여기 적어야 검사에 든다. */
test.describe("본문 터치 타깃 — 팬 제안", () => {
  for (const width of NARROW) {
    test(`${width}px /games: 제안함·추가 요청·수정 제안이 44 하한을 지킨다`, async ({
      page,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      // 관리자에게만 보이는 제안함부터 잰다.
      await signIn(page.context(), baseURL!);
      await page.goto("/games");
      await expectSignedIn(page);
      await page.evaluate(() => document.fonts.ready);
      await expectTouchTarget(page.locator('[data-od-id="inbox-open"]'), "들어온 제안");

      // 신원을 팬으로 바꾼다 — 나머지 둘은 권한이 **없어야** 뜬다.
      await page.context().clearCookies();
      await signIn(page.context(), baseURL!, E2E_FAN);
      await page.goto("/games");
      await expectSignedIn(page);
      await page.evaluate(() => document.fonts.ready);
      await expectTouchTarget(page.locator('[data-od-id="suggest-add-open"]'), "게임 추가 요청");

      // 수정 제안은 카드를 연 다음에 만난다(수정·삭제와 같은 자리).
      await page.locator('[data-od-id="game-open-1"]').click({ timeout: 3000 });
      await expect(page.locator('dialog[data-od-id="game-detail"]')).toBeVisible();
      await expectTouchTarget(page.locator('[data-od-id="game-suggest-1"]'), "수정 제안");
    });
  }
});

/* 주간표 카드 조작의 44 하한(이슈 #109 작업순서 3 · 결정 35 로 개정 2026-08-01).

   **편집기에서 다운로드가 아이콘이 됐다** — 글자 버튼이던 시절엔 `.btn` 계열에 min-height 가
   없는 함정(위 두 자리와 같다)을 `.week-card-download__btn` 이 직접 못박았고, 이제는
   `.week-card-download__icon` 이 고정 44×44 로 선다. 아이콘 버튼은 글자 크기가 하한을 좌우하지
   않으므로 그 함정 자체가 없어졌지만, **좁은 폭에서 아이콘이 카드 위에서 카드 밖으로 자리를
   옮기므로**(schedule.css 의 560 미디어쿼리) 그 이동 뒤에도 44 가 서는지는 여기서만 볼 수 있다.

   픽스처엔 발행된 주가 없어(schedule.spec.ts 의 같은 주석) 버튼은 항상 비활성이다 — `disabled`
   는 opacity 만 깎지 레이아웃은 안 바꾸므로 이 상태로도 크기 계약은 그대로 검증된다. */
test.describe("본문 터치 타깃 — 주간표 다운로드", () => {
  for (const width of NARROW) {
    test(`${width}px /schedule: 카드 조작이 44 하한을 지킨다`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await signIn(page.context(), baseURL!);
      // 다른 스펙이 안 읽는 먼 미래 주 — 초안이라 버튼은 비활성이지만 크기 계약은 같다.
      await page.goto("/schedule?week=2029-02-05");
      await expectSignedIn(page);
      await page.evaluate(() => document.fonts.ready);
      await expectTouchTarget(
        page.locator('[data-od-id="week-card-download-btn"]'),
        "PNG 다운로드 아이콘",
      );
      /* **확대는 이제 미리보기 카드 자신이다**(결정 35 — 텍스트 버튼을 걷고 그림에 넘겼다).
         카드는 44 를 한참 넘으므로 크기가 걱정인 자리는 아니지만, **눌리는지**는 그렇지 않다:
         절대배치한 다운로드 아이콘이 카드 위에 얹혀 있어 히트 영역이 겹치고, 이 폭에서는
         그 아이콘이 카드 밖으로 내려간다. `expectTouchTarget` 은 `click()` 으로 판정하므로
         "덮여서 못 누른다"를 그대로 잡는다.

         이 스펙은 셀렉터를 **손으로** 열거하므로 새 조작을 더하면 여기 같이 적어야 검사에 든다
         (상단 주석의 원칙). */
      const zoom = page.locator('[data-od-id="week-card-download-zoom"]');
      await expectTouchTarget(zoom, "카드 확대(미리보기)");
      await zoom.click();
      await expectTouchTarget(page.locator('[data-od-id="week-card-zoom-close"]'), "확대 창 닫기");
      /* 확대 창은 1200px 카드를 담으므로 **자기 상자 안에서** 가로 스크롤한다 — 문서를 늘리면
         안 된다(그러면 페이지 전체가 옆으로 밀린다). 열린 채로 그 둘을 갈라 잰다. */
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

/* 주간 일정 편집기 — sticky 저장·발행 바 + 게임 검색 돋보기(이슈 #56 결정 11·19·23,
   2026-07-28). 새로 넣은 인터랙티브 요소라 위 목록들처럼 여기 적어야 검사에 든다(narrow-body
   상단 주석의 원칙) — `/schedule` 자체가 세 PAGES 상수엔 없어서 로그아웃 상태의 가로 넘침·
   잘림은 이 describe 밖이다(편집기는 로그인 전용이라 그 둘로는 못 잰다).

   sticky 바는 `position:sticky`(fixed 아님, schedule.css 주석)라 문서 흐름 안에 자기 자리가
   그대로 남는다 — 그래도 실측으로 "마지막 요일 카드가 가려지지 않는가"를 직접 재는 이유는
   sticky 가 스크롤 중 콘텐츠를 **덮는 것 자체는 의도**이기 때문이다(늘 보이게 하려고 도입한
   패턴) — 가려도 되는 범위(스크롤 중)와 안 되는 범위(다 내려도 안 가림)를 가르는 게 이 재기다. */
test.describe("본문 터치 타깃 — 일정 편집기 sticky 바", () => {
  for (const width of NARROW) {
    test(`${width}px /schedule: sticky 저장·발행 바와 게임 검색 돋보기가 44 하한을 지키고, 가로 넘침이 없다`, async ({
      page,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await signIn(page.context(), baseURL!);
      // 다른 스펙이 안 읽는 먼 미래 주.
      await page.goto("/schedule?week=2034-03-06");
      await expectSignedIn(page);
      await page.evaluate(() => document.fonts.ready);

      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      await expectTouchTarget(page.locator('[data-od-id="schedule-save"]'), "저장");

      /* 하루 칸 펼치기 트리거(결정 28) — 접힌 요약 줄 전체가 44×44 이상이어야 한다. 새
         조작이라 여기 같이 적어야 검사에 든다(이 스펙은 셀렉터를 손으로 열거한다, AGENTS).
         아래 시각·휴방·항목 조작은 전부 이 버튼으로 편 패널 안에 있어 펴야 존재한다. */
      await expectTouchTarget(
        page.locator('[data-od-id^="schedule-day-toggle-"]').first(),
        "하루 칸 펼치기",
      );
      await openDay(page, 0);

      /* 하루의 속성 조작(이슈 #117) — 시각 입력과 휴방 토글. 이 스펙은 셀렉터를 **손으로**
         열거하므로 본문에 인터랙티브 요소를 더하면 여기 같이 적어야 검사에 든다(AGENTS).
         체크박스는 네이티브 상자가 18px 이라 라벨이 감싸 44 를 세운다 — 그 라벨을 재야 실제
         히트 영역이 잡힌다(상자만 재면 늘 미달로 보인다). */
      await expectTouchTarget(
        page.locator('[data-od-id^="schedule-day-time-"]').first(),
        "하루 시작 시각",
      );
      /* **부모(`xpath=..`)가 아니라 클래스로 잡는다**(2026-07-31). 히트 영역을 만드는 것은
         "체크박스의 부모"라는 **위치**가 아니라 `.sched-day__rest-toggle` 이라는 **부품**이다 —
         위치로 잡으면 그 토글을 다른 줄로 옮기는 순간(레이아웃 개편) 조상이 바뀌어, 검사가
         엉뚱한 상자를 재거나 조용히 통과한다. 이름으로 잡으면 어디로 옮겨도 같은 것을 잰다. */
      await expectTouchTarget(page.locator(".sched-day__rest-toggle").first(), "휴방 토글");
      await expectTouchTarget(
        page.locator('[data-od-id="schedule-publish-toggle"]'),
        "발행 상태 전환",
      );

      /* 팬아트 조작(이슈 #120) — 새 조작이라 여기 적어야 검사에 든다(이 스펙은 셀렉터를 손으로
         열거한다). 두 가지를 조심해야 한다:

         1. **44 는 label(`.sched-fanart__pick`)로 잰다.** 안의 file input 은 `.sr-only` 1px
            상자라 그걸 재면 늘 미달이고, 사람이 실제로 누르는 것도 label 이다(주입 셀렉터와
            배포 셀렉터를 같게 — kunya-design §6).
         2. **썸네일·내리기·표기 칸은 그림이 있을 때만 DOM 에 있다.** globalSetup 이 schedule
            테이블을 비우므로, 올리지 않고 셀렉터만 더하면 세 검사가 **0건을 재고 통과한다** —
            이 저장소가 두 번 만든 그 초록이다. 그래서 먼저 실제로 올린다. */
      const pick = page.locator('[data-od-id="schedule-fanart"] .sched-fanart__pick');
      await expectTouchTarget(pick, "팬아트 그림 올리기");
      await page.locator('[data-od-id="schedule-fanart-file"]').setInputFiles(FANART_PNG);
      await expect(page.locator('[data-od-id="schedule-fanart-thumb"]')).toBeVisible();
      await expectTouchTarget(
        page.locator('[data-od-id="schedule-fanart-remove"]'),
        "팬아트 내리기",
      );
      await expectTouchTarget(
        page.locator('[data-od-id="schedule-fanart-credit"]'),
        "팬아트 작가 표기",
      );
      /* 96px 고정 슬롯 + 버튼 스택이 한 행에 서는 유일한 자리다 — 320 에서 그 조합이 넘치지
         않는지 본다(고정 px 트랙은 해제 폭 없이 두면 그 값이 그대로 가로 넘침이다). */
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

      /* ＋ 는 44×44 아이콘으로 줄었다(결정 28) — 글자였을 때보다 폭이 좁아져 하한을 못 채울
         위험이 커진 자리라 클릭 전에 크기부터 잰다. 그다음 눌러야 게임 검색 트리거가 존재한다. */
      const dayAdd = page.locator('[data-od-id^="schedule-day-add-"]').first();
      await expectTouchTarget(dayAdd, "항목 추가");
      await dayAdd.click();
      const trigger = page.locator('[data-od-id^="schedule-entry-game-trigger-"]').first();
      await expectTouchTarget(trigger, "게임 검색 돋보기");
      await expectTouchTarget(
        page.locator('[data-od-id^="schedule-entry-del-"]').first(),
        "항목 삭제",
      );

      // 검색 패널을 열어도 넘치지 않는지 — 좁은 폭에서 로컬 매치 목록이 흔한 오버플로 자리다.
      await trigger.click();
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

      /* 마지막 요일 카드가 sticky 바에 다 가려진 채로 끝나지 않는다 — 끝까지 스크롤하면
         카드 아랫변이 바의 윗변보다 위(또는 같은 자리)에 온다.

         **`scrollIntoViewIfNeeded` 가 아니라 문서 끝까지 직접 스크롤한다**(결정 28 이후 실측
         지뢰) — 그 메서드는 대상이 "충분히 보이면" 일찍 멈춘다. 접힌 마지막 카드는 66px 라
         뷰포트 중간쯤에서 이미 "보이는" 것으로 판정돼, 미저장 힌트 문구로 195px 까지 늘어난
         sticky 바 밑까지는 안 밀어붙였다(실측: scrollY 1014 인데 maxScroll 1541 — 527px 를
         남기고 멈췄다). `position: sticky` 는 실제 최대 스크롤에서 정적 위치와 일치하므로,
         진짜 문서 끝까지 스크롤해야 이 단언이 "가려짐"만 잡고 스크롤 도중의 겹침(의도된 동작)은
         안 잡는다.

         **`behavior: "instant"` 를 명시한다** — 이 사이트가 `scroll-behavior: smooth` 를 켜
         둬서(schedule.css 상단이 아니라 전역 CSS) 기본값이면 스크롤이 애니메이션으로 진행되고,
         곧바로 좌표를 읽으면 **중간값**이 잡힌다(AGENTS 의 같은 지뢰 — `scrollIntoViewIfNeeded`
         자리가 아니라 여기서도 재현됐다: 실측 1097.8, 스크롤이 안 끝난 상태). */
      const lastDay = page.locator(".sched-day").last();
      await page.evaluate(() =>
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          left: 0,
          behavior: "instant",
        }),
      );
      const [dayBox, barBox] = await Promise.all([
        lastDay.boundingBox(),
        page.locator('[data-od-id="schedule-save-bar"]').boundingBox(),
      ]);
      expect(dayBox).not.toBeNull();
      expect(barBox).not.toBeNull();
      expect(dayBox!.y + dayBox!.height).toBeLessThanOrEqual(barBox!.y + 1);
    });
  }
});

/* 주간표 카드의 감축 경로(2026-07-29 · **결정 35 로 뒤집힘 2026-08-01**).

   ── 무엇이 바뀌었나 ────────────────────────────────────────────────────────────
   전엔 560 아래에서 **미리보기를 통째로 감췄다**. 근거는 "390px 에선 배율이 0.285 라 요일
   34px→9.7px · 항목 제목 16px→4.6px 로 글자를 전혀 못 읽는다"였고 **그 실측은 지금도 참이다.**
   바뀐 것은 그 상자의 일이다: 확대가 텍스트 버튼에서 **카드 클릭**으로 옮겨 가면서 미리보기는
   판독 수단이 아니라 확대의 **진입점**이 됐다 — 감추면 좁은 폭에서 확대에 닿을 길이 통째로
   사라진다. 옛 규칙이 성립했던 건 그때 확대 버튼이 미리보기 **밖**에 따로 있어서다.

   대신 이 폭에서 감축되는 것은 **다운로드 아이콘의 자리**다. 44×44 는 터치 하한이라 못 줄이는데
   카드는 여기서 340×178 까지 작아져, 카드 위에 얹으면 아이콘이 우측 상단의 주 범위 표기를
   그대로 가린다(1600px 에선 같은 44 가 아무것도 안 가린다 — 실측). 그래서 아이콘만 카드 밖으로
   내려온다(schedule.css 의 560 미디어쿼리).

   ── 그래서 이 스펙이 재는 것 ───────────────────────────────────────────────────
   경계 ±1px 로 **아이콘이 카드 위에 얹혔나 / 카드 아래로 내려갔나**를 가른다. 위 상단 주석대로
   320·390 사이엔 브레이크포인트가 없어 그 둘만으론 감축이 실제로 일어나는지를 증명하지 못한다.
   미리보기는 **모든 폭에서 보여야 한다** — 그게 이번에 뒤집은 계약이라 여기서 못박는다.

   발행 단계가 남는 이유: 아래에서 **실제로 내려받아 PNG 바이트를 재는데** 다운로드는 발행 +
   저장을 요구한다(그래야 "보이는 것 = 받는 것"이 성립한다). 다른 스펙이 안 읽는 먼 주를 쓴다
   (AGENTS 의 "e2e 스펙은 D1 픽스처 하나를 공유한다"). */
test.describe("감축 경로 — 주간표 카드 조작", () => {
  test("560 아래에서도 미리보기는 남고 다운로드 아이콘만 카드 밖으로 내려온다", async ({
    page,
    baseURL,
  }) => {
    await signIn(page.context(), baseURL!);
    await page.goto("/schedule?week=2035-09-03");
    await expectSignedIn(page);

    /* 카드 자체는 항목 하나로 서지만(draft), 아래에서 실제로 받으려면 발행 + 저장이 필요하다 —
       저장 뒤 칩을 눌러 확인창을 거친다(schedule.spec 의 publishNow 와 같은 순서). 결정 28
       이후 조작은 패널 안이다. */
    await openDay(page, 0);
    await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
    await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("좁은 폭 미리보기");
    await page.locator('[data-od-id="schedule-save"]').click();
    await expect(page.locator('[data-od-id="schedule-save"]')).toBeDisabled();
    await page.locator('[data-od-id="schedule-publish-toggle"]').click();
    await page.locator('[data-od-id="schedule-publish-confirm-confirm"]').click();
    await expect(page.locator('[data-od-id="schedule-publish-chip"]')).toHaveText("공개 중");

    const preview = page.locator(".week-card-download__preview");
    const button = page.locator('[data-od-id="week-card-download-btn"]');

    /* 아이콘이 카드 **위에 얹혀 있나**. 절대배치일 땐 카드 상자 안(윗변 기준)에 들고,
       static 으로 내려오면 카드 아랫변보다 아래에 선다 — 그 한 줄이 이 감축의 전부다. */
    const iconOverlapsCard = async () => {
      const card = (await preview.boundingBox())!;
      const icon = (await button.boundingBox())!;
      return icon.y < card.y + card.height;
    };

    await page.setViewportSize({ width: 561, height: 800 });
    await expect(preview).toBeVisible();
    expect(await iconOverlapsCard()).toBe(true);

    await page.setViewportSize({ width: 560, height: 800 });
    // **미리보기는 남는다** — 이 단언이 옛 계약(560 아래에서 감춘다)을 정확히 뒤집는다.
    await expect(preview).toBeVisible();
    await expect(button).toBeVisible();
    expect(await iconOverlapsCard()).toBe(false);

    await page.setViewportSize({ width: 320, height: 800 });
    await expect(preview).toBeVisible();
    await expect(button).toBeVisible();
    expect(await iconOverlapsCard()).toBe(false);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

    /* 320px 에서 진짜 바이트를 받아 PNG 시그니처와 1200×630 의 2배 치수까지 확인한다
       (schedule.spec 의 PNG 검증과 같은 방식). 캡처는 클릭 시점에 노드를 복제해 body 직속으로
       붙여 찍으므로(week-card-download.tsx 의 snapshotCard) 미리보기가 이 폭에서 어떤 크기로
       보이든 결과물은 항상 원본 치수다 — 버튼이 보이는 것만 재고 넘어가면 그 사실이 주장으로만
       남는다. */
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    const file = await download.path();
    expect(file).not.toBeNull();
    const buf = readFileSync(file!);
    expect(buf.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(buf.readUInt32BE(16)).toBe(2400);
    expect(buf.readUInt32BE(20)).toBe(1260);

    /* 미저장으로 잠겼을 때 **이 폭에서도 이유가 화면에 있는가.** 위에서 발행·저장까지 마쳤으므로
       제목만 고치면 미저장이 되어 잠긴다. 문구를 박지 않고 존재만 재는 이유: 사유가 늘거나 문구가
       다듬어져도 "이유가 화면에 있다"는 계약은 그대로다(문구 자체는 dom 스펙이 사유별로 잰다).

       **미발행 사유는 여기서 안 뜬다** — 그건 화면 문장을 안 내고 버튼 이름이 진다(결정 35).
       미저장만 문장을 내므로 이 자리에서 재는 것이 정확히 그 하나다. */
    await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("좁은 폭 미저장");
    const blocked = page.locator('[data-od-id="week-card-download-blocked"]');
    await expect(blocked).toBeVisible();
    /* 잠긴 것과 감춰지는 것은 다르다 — 미리보기도 아이콘도 자리를 지킨다. 잠금은 폭이 아니라
       저장 상태가 정하고, 폭이 정하는 것은 아이콘의 **자리**뿐이라는 게 이 세 단언의 뜻이다. */
    await expect(preview).toBeVisible();
    await expect(button).toBeVisible();
    expect(await iconOverlapsCard()).toBe(false);
  });
});
