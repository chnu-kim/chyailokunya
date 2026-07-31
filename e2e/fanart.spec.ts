import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import { openDay } from "./schedule-helpers";
import { E2E_FAN, expectSignedIn, signIn } from "./session";

/* 팬아트 업로드·서빙 라우트(ADR-0028). 파일 바이트가 오가는 경계라 tRPC 단위 테스트가 못 닿는다
   — 인가·CSRF·형식 판정·상한이 전부 HTTP 계층에 있고, R2 왕복까지 실제로 돌아야 계약이 증명된다.
   Miniflare 의 로컬 R2 위에서 돈다(D1 과 같은 구조).

   브라우저 대신 `context.request` 로 두드린다 — 이 라우트의 진짜 소비자는 화면의 fetch 이고
   (PR 2), 여기서 재려는 건 그 fetch 가 받게 될 서버 응답 자체다. */

const UPLOAD = "/api/fanart";

/* PNG 시그니처 + **IHDR 까지** 채운 앞머리(8×8). 매직 바이트만으론 이제 부족하다 — 라우트가
   IHDR 에서 치수를 읽어 픽셀 예산을 보고, 못 읽으면 415 로 거절한다(fail-closed). 픽셀 데이터는
   여전히 필요 없다: 라우트는 어느 경로에서도 디코드하지 않는다. */
const PNG_BYTES = (() => {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  Buffer.from([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 8);
  b.writeUInt32BE(8, 16);
  b.writeUInt32BE(8, 20);
  return b;
})();

/* Origin 을 손으로 싣는다 — 상태를 바꾸는 요청은 Origin 이 AUTH_URL 과 정확히 일치할 때만
   통과한다(rejectForeignOrigin, fail-closed). 브라우저는 이걸 자동으로 붙이지만 API 요청
   컨텍스트는 안 붙여, 안 실으면 전부 403 이라 나머지 축을 하나도 못 잰다. */
function upload(
  request: APIRequestContext,
  baseURL: string,
  body: Buffer,
  contentType = "image/png",
) {
  return request.post(UPLOAD, {
    headers: { origin: baseURL, "content-type": contentType },
    data: body,
  });
}

/* 신원을 바꿔 재려면 컨텍스트를 새로 연다 — 같은 컨텍스트에 다른 쿠키를 덮어쓰면 앞 요청의
   세션이 남아 축이 섞인다(suggestions.spec 의 openAsAdmin 과 같은 이유). 인자를 안 주면
   기본 신원(E2E_USER = admin)이다 — signIn 의 기본값과 같은 규약이라 여기서 다시 안 적는다. */
async function contextAs(browser: Browser, baseURL: string, who: Partial<typeof E2E_FAN> = {}) {
  const context = await browser.newContext({ baseURL });
  await signIn(context, baseURL, who);
  return context;
}

test("비로그인 업로드는 401 — 인가는 서버가 정본이다", async ({ request, baseURL }) => {
  const res = await upload(request, baseURL!, PNG_BYTES);
  expect(res.status()).toBe(401);
});

test("권한 없는 로그인(팬)은 403 — 로그인만으로는 못 올린다", async ({ browser, baseURL }) => {
  const context = await contextAs(browser, baseURL!, E2E_FAN);
  const res = await upload(context.request, baseURL!, PNG_BYTES);
  expect(res.status()).toBe(403);
  await context.close();
});

test("Origin 이 우리 것이 아니면 403 — 권한이 있어도 막힌다", async ({ browser, baseURL }) => {
  const context = await contextAs(browser, baseURL!);
  // 남의 사이트에서 관리자의 쿠키를 업고 오는 요청이 이 모양이다(CSRF).
  const res = await context.request.post(UPLOAD, {
    headers: { origin: "https://evil.example", "content-type": "image/png" },
    data: PNG_BYTES,
  });
  expect(res.status()).toBe(403);
  await context.close();
});

test("관리자: PNG 를 올리고 그 키로 되받는다", async ({ browser, baseURL }) => {
  const context = await contextAs(browser, baseURL!);

  const res = await upload(context.request, baseURL!, PNG_BYTES);
  expect(res.status()).toBe(201);
  const { key } = (await res.json()) as { key: string };
  // 저장되는 값은 URL 도 경로도 아닌 조각 하나다(ADR-0028) — 그래야 외부 호스트를 못 담는다.
  expect(key).toMatch(/^[0-9a-f-]{36}\.png$/);

  const got = await context.request.get(`/api/fanart/${key}`);
  expect(got.status()).toBe(200);
  // Content-Type 은 클라이언트가 보낸 값이 아니라 업로드가 바이트로 판정한 결과다.
  expect(got.headers()["content-type"]).toBe("image/png");
  /* 캐시는 걸되 **immutable 은 안 쓴다** — 이 자원은 삭제된다(관리자가 내리거나 교체한다).
     내용이 안 바뀐다고 1년 immutable 을 걸면 지운 뒤에도 옛 URL 이 계속 서빙된다. */
  expect(got.headers()["cache-control"]).toBe("public, max-age=3600");
  expect(Buffer.from(await got.body()).subarray(0, 8)).toEqual(PNG_BYTES.subarray(0, 8));

  /* 만료된 캐시가 되물으면 바이트를 다시 안 보낸다. 이걸 안 재면 CACHE_CONTROL 주석이 약속한
     재검증 경로가 코드에 없어도 게이트가 전부 초록이다(실제로 그랬다 — 코드 리뷰가 잡았다). */
  const etag = got.headers()["etag"];
  expect(etag).toBeTruthy();
  const revalidated = await context.request.get(`/api/fanart/${key}`, {
    headers: { "if-none-match": etag! },
  });
  expect(revalidated.status()).toBe(304);
  expect(Buffer.from(await revalidated.body()).byteLength).toBe(0);

  await context.close();
});

test("확장자·Content-Type 이 아니라 바이트로 판정한다", async ({ browser, baseURL }) => {
  const context = await contextAs(browser, baseURL!);

  /* SVG 를 image/png 라고 주장하며 올린다. 헤더를 믿으면 우리 origin 에서 **마크업**이 서빙되고,
     그건 스크립트를 실을 수 있는 문서다 — 형식 판정이 헤더가 아니라 바이트여야 하는 이유. */
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
  expect((await upload(context.request, baseURL!, svg)).status()).toBe(415);

  // GIF 도 같은 자리에서 걸린다(받는 형식 셋이 아니다).
  const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
  expect((await upload(context.request, baseURL!, gif)).status()).toBe(415);

  // 빈 본문도 형식이 아니다.
  expect((await upload(context.request, baseURL!, Buffer.alloc(0))).status()).toBe(400);

  await context.close();
});

test("픽셀 폭탄은 R2 에 들어가기 전에 거절된다 — 바이트 상한이 못 막는 축이다", async ({
  browser,
  baseURL,
}) => {
  /* IHDR 이 20000×20000(4억 화소)을 주장하는 **24바이트** PNG. 이 테스트가 싼 이유가 이 방어가
     싼 이유와 같다: 라우트는 헤더의 정수 몇 개만 읽으므로 거대한 본문이 필요 없다. **실제 폭탄도
     같은 헤더를 갖는다** — 단색 이미지는 그 픽셀 수가 5MB 안에 압축되고, 방문자 브라우저가
     디코드하면 1.6GB 로 펼쳐진다(적대적 리뷰 2라운드).

     바이트 상한(413)을 e2e 로 못 재는 이유(아래 주석)와 대조적이다 — 같은 상태 코드인데 이쪽은
     본문이 24바이트라 dev 서버를 묶지 않는다. */
  const bomb = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bomb, 0);
  Buffer.from([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(bomb, 8);
  bomb.writeUInt32BE(20000, 16);
  bomb.writeUInt32BE(20000, 20);

  const context = await contextAs(browser, baseURL!);
  const res = await upload(context.request, baseURL!, bomb);
  expect(res.status()).toBe(413);
  // 서버가 이유를 말하고 화면은 그 문구를 그대로 쓴다(fanartUploadErrorMessage).
  expect(((await res.json()) as { error: string }).error).toContain("화소");

  // 헤더를 못 읽는 파일은 415 다 — fail-closed(통과시키면 이 방어에 우회로가 생긴다).
  const truncated = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  expect((await upload(context.request, baseURL!, truncated)).status()).toBe(415);

  await context.close();
});

/* **크기 상한(413)은 여기서 안 잰다.** 재려면 5MB 본문을 실제로 전송해야 하는데, 그러면
   `next dev` 서버가 그 요청에 묶여 **무관한 스펙들이 줄줄이 타임아웃된다** — 실측으로 전체
   e2e 가 2.7분·5개 실패였다가, 그 테스트 하나를 빼니 1.2분·122개 전부 통과였다(실패하는
   스펙도 실행마다 달라지는 전형적인 자원 경합이다). Content-Length 만 크게 위조해 싸게 재는
   길도 막혀 있다: Playwright 가 실제 본문 길이로 덮어쓴다(실측 201).

   그래서 판정 자체를 순수 함수로 올려 경계값을 단위 테스트가 못박는다(core/fanart 의
   `isOverFanartLimit` — 상한 정확히·+1·헤더 부재·쓰레기 헤더). 이 파일이 증명하는 것은
   "라우트가 거절을 실제 상태 코드로 낸다"이고 그 계약은 아래 415·400 이 이미 보여 준다.
   상한만 유일하게 e2e 밖에 남는 것이 아니라, **같은 종류의 거절을 재는 경로가 이미 있다.** */

/* ── 화면 왕복(PR 2) ────────────────────────────────────────────────────────────
   위 테스트들은 라우트 계약을, 이 하나는 **관리자가 올린 그림이 팬 화면에 뜨는 전 구간**을 본다:
   파일 선택 → 업로드 → 미리보기 → 저장 → 발행 → 비로그인 읽기. 단위 테스트는 이 구간을 못
   잇는다(브라우저의 파일 선택·치수 판독과 서버 저장·서빙이 각각 다른 층에 있다).

   **먼 주를 쓰고 발행한다.** e2e 는 D1 픽스처 하나를 공유하므로(AGENTS) 현재 주를 발행하면
   schedule.spec 의 "미발행 현재 주 = 준비 중"이 조용히 깨진다. 2033-03-07 은 다른 스펙이 안
   읽는 월요일이다. */
/* 손으로 인코딩한 2×3 PNG. **1×1 을 쓰지 않는 이유**: 폭과 높이가 같으면 둘이 뒤바뀌어도
   단언이 통과한다(치수는 두 컬럼·두 Zod 필드·두 img 속성을 거치는데 그 전 구간에서 뒤바뀜이
   안 잡힌다). 그리고 **CRC 가 맞아야 한다** — 널리 복사되는 1×1 base64 중 IDAT CRC 가 깨진
   판이 있고, 그걸 쓰면 브라우저가 디코드를 거부해(InvalidStateError) 치수가 null 로 저장된다.
   `file(1)` 은 헤더만 보므로 그 상태를 통과시킨다(실측 2026-07-30). */
const FANART_PNG = fileURLToPath(new URL("./fixtures/fanart-2x3.png", import.meta.url));
const FANART_WEEK = "2033-03-07";
/* 극단 비율(20×2000 = 4만 화소). **픽셀 예산·한 변 상한 둘 다 통과하는 정당한 업로드**다.
   표시 상한(schedule.css 의 max-height)을 지우면 이 그림의 렌더 높이가 **2000px** 로 잡힌다
   (실측 — 폭이 20px 이라 `.sched-fanart-card` 의 `fit-content` 가 그 폭을 그대로 준다: 뷰포트
   800 의 2.5배다). 폭이 큰 쪽이 더 나쁘다 — 1200×20000 이면 420px 상한에서 7000px 이 된다. */
const TALL_PNG = fileURLToPath(new URL("./fixtures/fanart-20x2000.png", import.meta.url));

test("관리자가 올린 그림을 저장·발행하면 팬이 그걸 본다", async ({ browser, baseURL }) => {
  const admin = await contextAs(browser, baseURL!);
  const page = await admin.newPage();
  await page.goto(`/schedule?week=${FANART_WEEK}`);
  await expectSignedIn(page);

  // 빈 주는 발행할 수 없다(결정 22) — 항목을 하나 만들어 둔다. 결정 28 이후 조작은 패널 안이다.
  await openDay(page, 0);
  await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
  await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("팬아트 주");

  /* 파일을 고르면 업로드가 곧바로 나간다(별도 "올리기" 버튼이 없다) — 성공하면 미리보기가
   **실제 서빙 경로**로 뜬다. objectURL 이 아니라 그걸 쓰는 것이 이 화면의 계약이다. */
  await page.locator('[data-od-id="schedule-fanart-file"]').setInputFiles(FANART_PNG);
  const thumb = page.locator('[data-od-id="schedule-fanart-thumb"]');
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveAttribute("src", /^\/api\/fanart\/[0-9a-f-]{36}\.png$/);

  // 표기 칸은 **그림이 있을 때만** 열린다(그림 없이 표기만 있는 조합을 화면이 못 만든다).
  await page.locator('[data-od-id="schedule-fanart-credit"]').fill("e2e 그린 사람");

  const save = page.locator('[data-od-id="schedule-save"]');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toHaveText("저장됨");

  // 발행해야 공개 읽기가 그 주를 준다(ADR-0022).
  await page.locator('[data-od-id="schedule-publish-toggle"]').click();
  await page.locator('[data-od-id="schedule-publish-confirm-confirm"]').click();
  await expect(page.locator('[data-od-id="schedule-publish-chip"]')).toHaveText("공개 중");

  /* 팬이 보는 화면은 **다른 컨텍스트**로 연다 — 관리자에겐 편집기가 뜨므로 같은 세션으로는
     읽기 화면 자체를 못 본다(서버가 신원으로 뷰를 가른다). */
  const fanContext = await browser.newContext({ baseURL });
  const fan = await fanContext.newPage();
  await fan.goto(`/schedule?week=${FANART_WEEK}`);

  const fanart = fan.locator('[data-od-id="schedule-fanart"]');
  await expect(fanart).toBeVisible();
  await expect(fanart.getByText("e2e 그린 사람")).toBeVisible();

  const img = fanart.locator("img");
  /* 치수가 실려 그림이 뜨기 전에 자리를 예약한다 — 1×1 PNG 를 올렸으니 그 값이다. 관리자
     브라우저가 읽어 보낸 값이 컬럼을 거쳐 여기까지 오는지가 이 단언의 질문이다. 폭≠높이인
     그림을 쓰는 이유는 위 상수 주석에 있다(뒤바뀜을 잡는다). */
  await expect(img).toHaveAttribute("width", "2");
  await expect(img).toHaveAttribute("height", "3");
  /* 그림이 실제로 서빙되는지 — naturalWidth 가 0 이 아니면 브라우저가 바이트를 받아 디코드했다.
     src 만 보면 404 여도 통과한다(그게 dangling key 의 증상이다). */
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  /* ── 극단 비율을 표시가 제한한다(적대적 리뷰 4라운드) ────────────────────────────────
     같은 주의 그림을 20×2000 으로 **교체한다**(4만 화소 — 픽셀 예산·한 변 상한 둘 다 안이라
     업로드가 정당하게 통과한다). max-height 를 지우면 렌더 높이가 2000px 로 잡히고(실측), 폭이
     큰 그림이면 더 나쁘다(1200×20000 → 7000px) — 발행된 주를 여는 방문자가 그 아래를 못 본다.

     교체를 쓰는 이유가 둘이다: 발행된 주를 하나 더 만들지 않아 픽스처 오염이 안 늘고, "키를
     바꾸면 옛 객체를 치운다"는 서버 계약이 같은 흐름에서 한 번 더 돈다. */
  await page.locator('[data-od-id="schedule-fanart-file"]').setInputFiles(TALL_PNG);
  await expect(thumb).toHaveAttribute("src", /^\/api\/fanart\/[0-9a-f-]{36}\.png$/);
  await save.click();
  await expect(save).toHaveText("저장됨");

  await fan.reload();
  const tall = fan.locator('[data-od-id="schedule-fanart"] img');
  // 저장된 치수는 그대로다 — 제한은 데이터가 아니라 표시에 있다(그래야 레거시 행도 덮인다).
  await expect(tall).toHaveAttribute("height", "2000");
  await expect
    .poll(() => tall.evaluate((el: HTMLImageElement) => el.naturalHeight))
    .toBeGreaterThan(0);

  const box = (await tall.boundingBox())!;
  /* 720px 이 CSS 상한이다(min(720px, 80vh) — 이 뷰포트는 720 쪽이 작다). 상한이 없으면 여기가
     42000 근처로 잡힌다. 1px 여유는 소수점 레이아웃의 반올림 몫이다. */
  expect(box.height).toBeLessThanOrEqual(721);
  // 문서가 그 그림 때문에 비정상적으로 길어지지도 않는다 — 상한이 실제 레이아웃에 먹었다는 뜻.
  const docHeight = await fan.evaluate(() => document.documentElement.scrollHeight);
  expect(docHeight).toBeLessThan(4000);

  await fanContext.close();
  await admin.close();
});

/* ── 슬롯 하나, 두 상태(결정 36, 2026-08-01) ────────────────────────────────────
   화면 계약이라 라우트 테스트가 아니라 브라우저로 본다. 세 가지를 잰다:

   1. **두 상태가 서로를 대체한다** — 빈 드롭존과 그림이 동시에 안 선다. 슬롯 자체는 그대로다.
   2. **✕ 는 항상 DOM 에 있고 호버·키보드 포커스에서 드러난다.** `display:none` 으로 감추면
      키보드 포커스가 아예 안 가고 호버 없는 기기엔 없는 것과 같다 — 그 경계를 opacity 로
      재야 "감춘 것"과 "지운 것"이 갈린다.
   3. **파일을 떨구면 업로드가 난다.** `onDragOver` 의 `preventDefault()` 를 빠뜨리면 브라우저
      기본값이 "받지 않음"이라 drop 이 아예 안 나는데, 화면엔 아무 신호가 없다.

   다른 스펙이 안 읽는 먼 주를 쓰고 **저장하지 않는다** — 업로드는 R2 에만 닿고 이 주의 D1
   행은 안 만든다(공유 픽스처를 안 건드린다). */
const SLOT_WEEK = "2039-02-07";

test("관리자: 팬아트 슬롯이 빈 드롭존 ↔ 그림 + ✕ 로 갈아탄다", async ({ browser, baseURL }) => {
  const admin = await contextAs(browser, baseURL!);
  const page = await admin.newPage();
  await page.goto(`/schedule?week=${SLOT_WEEK}`);
  await expectSignedIn(page);

  const slot = page.locator('[data-od-id="schedule-fanart-slot"]');
  const thumb = page.locator('[data-od-id="schedule-fanart-thumb"]');
  const x = page.locator('[data-od-id="schedule-fanart-remove"]');
  const emptyText = slot.getByText("그림을 끌어 놓거나 눌러서 고릅니다");

  // 빈 상태 — 드롭존 문구가 있고 그림·✕ 는 **아예 없다**(감춘 게 아니라 없다).
  await expect(emptyText).toBeVisible();
  await expect(thumb).toHaveCount(0);
  await expect(x).toHaveCount(0);
  const emptyBox = (await slot.boundingBox())!;

  await page.locator('[data-od-id="schedule-fanart-file"]').setInputFiles(FANART_PNG);
  await expect(thumb).toBeVisible();
  // 채워지면 드롭존 문구가 사라진다 — 둘이 동시에 서면 "슬롯 하나"가 거짓이 된다.
  await expect(emptyText).toHaveCount(0);
  // 그런데 슬롯의 자리는 그대로다 — 그래야 아래 힌트·표기 칸이 안 튄다.
  const filledBox = (await slot.boundingBox())!;
  expect(filledBox.width).toBe(emptyBox.width);
  expect(filledBox.height).toBe(emptyBox.height);

  /* ✕ 는 DOM 에 **있고**(count 1) 평소엔 안 보인다. `toBeHidden()` 은 opacity 를 안 보므로
     (Playwright 의 visible 판정에 opacity 는 안 든다) computed style 을 직접 읽는다. */
  await expect(x).toHaveCount(1);
  const opacity = () => x.evaluate((el) => getComputedStyle(el).opacity);
  await expect.poll(opacity, { message: "평소엔 안 보인다" }).toBe("0");
  await slot.hover();
  await expect.poll(opacity, { message: "호버에서 드러난다" }).toBe("1");

  // 키보드로도 닿는다 — 호버가 없는 사람에게 이게 유일한 길이다.
  await page.mouse.move(0, 0);
  await expect.poll(opacity).toBe("0");
  await x.focus();
  await expect.poll(opacity, { message: "포커스에서 드러난다" }).toBe("1");

  // 내리면 빈 드롭존으로 되돌아온다.
  await x.click();
  await expect(thumb).toHaveCount(0);
  await expect(emptyText).toBeVisible();

  await admin.close();
});

test("관리자: 슬롯에 파일을 떨구면 업로드가 난다", async ({ browser, baseURL }) => {
  const admin = await contextAs(browser, baseURL!);
  const page = await admin.newPage();
  await page.goto(`/schedule?week=${SLOT_WEEK}`);
  await expectSignedIn(page);

  const slot = page.locator('[data-od-id="schedule-fanart-slot"]');

  /* **`dragover` 를 취소하는지부터 잰다.** 브라우저 기본값이 "받지 않음"이라 `preventDefault()`
     를 빠뜨리면 진짜 드래그에선 `drop` 이 아예 안 나는데 화면엔 아무 신호가 없다.

     그런데 아래 `dispatchEvent` 로는 그걸 못 잡는다 — 합성 이벤트는 브라우저 기본 동작을 안
     타서 `dragover` 를 취소하든 말든 `drop` 핸들러가 그대로 불린다(실측: `preventDefault()`
     를 지워도 이 스펙이 초록이었다). 그래서 **취소 자체를 값으로 읽는다**: `dispatchEvent` 는
     `preventDefault()` 가 불렸으면 false 를 돌려준다. */
  const prevented = await slot.evaluate(
    (el) => !el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true })),
  );
  expect(prevented, "dragover 를 취소해야 진짜 드래그에서 drop 이 난다").toBe(true);

  /* **자식 위를 지나는 `dragleave` 로는 강조가 안 꺼진다.** `dragleave` 는 안쪽 요소로 옮겨
     갈 때도 나므로, 거르지 않으면 드롭존 안의 아이콘 위를 지나는 순간 강조가 깜빡인다.
     `relatedTarget` 이 이 상자 안인지로 가른다.

     **이건 dom 단위가 구조적으로 못 본다** — happy-dom 의 합성 드래그 이벤트는 `relatedTarget`
     을 안 실어(실측: 핸들러가 받는 값이 `undefined`) 판정이 늘 "떠났다"로 접힌다. 진짜
     Chromium 이 필요한 자리라 여기 둔다. */
  /* **한 번의 `evaluate` 안에서 클래스를 읽으면 안 된다** — React 의 리렌더는 마이크로태스크라
     dispatch 직후엔 옛 className 이 잡힌다(실측: 켜졌는데도 `entered: false`). 왕복을 나누고
     프레임을 한 번 넘긴 뒤에 읽는다. */
  const settle = () =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const cls = () => slot.getAttribute("class");
  const fire = (type: string, childTarget: boolean) =>
    slot.evaluate(
      (el, [t, kid]) =>
        el.dispatchEvent(
          new DragEvent(t as string, {
            bubbles: true,
            cancelable: true,
            relatedTarget: kid ? el.querySelector(".sched-fanart__pick") : null,
          }),
        ),
      [type, childTarget] as const,
    );

  await fire("dragenter", false);
  await settle();
  expect(await cls(), "드래그가 들어오면 강조가 켜진다").toContain("is-dragging");

  await fire("dragleave", true);
  await settle();
  expect(await cls(), "자식 위를 지나는 dragleave 로는 안 꺼진다").toContain("is-dragging");

  await fire("dragleave", false);
  await settle();
  expect(await cls(), "상자를 떠나면 꺼진다").not.toContain("is-dragging");

  /* 그다음 실제 드롭 경로 — `DataTransfer` 를 페이지 안에서 만들고 바이트로 `File` 을 채운 뒤
     `drop` 이벤트에 실어 보낸다. `setInputFiles` 는 input 을 직접 채우므로 이 경로를 통째로
     안 탄다. */
  const bytes = [...readFileSync(FANART_PNG)];
  const dt = await page.evaluateHandle((data) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(data)], "dropped.png", { type: "image/png" }));
    return t;
  }, bytes);

  await slot.dispatchEvent("dragenter", { dataTransfer: dt });
  await slot.dispatchEvent("drop", { dataTransfer: dt });

  const thumb = page.locator('[data-od-id="schedule-fanart-thumb"]');
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveAttribute("src", /^\/api\/fanart\/[0-9a-f-]{36}\.png$/);

  await admin.close();
});

/* **잠긴 동안에도 `dragover` 를 취소한다**(codex 두 채널이 독립적으로 잡은 결함, 2026-08-01).

   `fanartLocked` 일 때 취소를 건너뛰면 브라우저 기본 동작이 살아나 **떨군 파일로 탭이 이동하고
   저장 안 된 편집이 통째로 날아간다** — 저장·업로드 중이 정확히 그 순간이다. 잠금이 뜻하는
   것은 "업로드를 안 낸다"이지 "브라우저에 넘긴다"가 아니다.

   **dom 단위의 잠금 테스트로는 이 축이 안 잡힌다** — 거기선 `drop` 을 직접 쏘므로 "dragover 를
   취소해야 drop 이 온다"는 브라우저 전제 자체를 안 탄다(리뷰 지적). 그래서 진짜 잠금 상태를
   만들어 여기서 잰다: 업로드 응답을 붙잡아 `uploading` 에 머물게 한 뒤 취소 여부를 읽는다. */
test("관리자: 업로드 중에도 드롭 기본 동작을 막는다 — 안 막으면 편집이 날아간다", async ({
  browser,
  baseURL,
}) => {
  const admin = await contextAs(browser, baseURL!);
  const page = await admin.newPage();

  // 업로드를 응답 없이 붙잡아 둔다 — 그동안 편집기는 `uploading` 이다.
  let release: (() => void) | null = null;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/fanart", async (route) => {
    await held;
    await route.abort();
  });

  await page.goto(`/schedule?week=${SLOT_WEEK}`);
  await expectSignedIn(page);
  await page.locator('[data-od-id="schedule-fanart-file"]').setInputFiles(FANART_PNG);
  // 잠긴 것을 먼저 못박는다 — 안 잠겼으면 아래가 무엇을 재는지 알 수 없다.
  await expect(page.locator('[data-od-id="schedule-fanart-file"]')).toBeDisabled();

  const slot = page.locator('[data-od-id="schedule-fanart-slot"]');
  const prevented = await slot.evaluate(
    (el) => !el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true })),
  );
  expect(prevented, "잠긴 동안에도 취소해야 브라우저가 파일로 이동하지 않는다").toBe(true);

  release!();
  await admin.close();
});

test("서빙: 키 형식이 아니거나 없는 객체는 404", async ({ request }) => {
  // 경로 순회. 키 검증이 이 한 자리에서 막으므로 R2 를 두드리지도 않는다.
  expect((await request.get("/api/fanart/..%2F..%2Fpackage.json")).status()).toBe(404);
  expect((await request.get("/api/fanart/not-a-key.png")).status()).toBe(404);
  // 형식은 맞지만 없는 객체.
  expect((await request.get("/api/fanart/0189d1f0-3a4b-7c8d-9e0f-1a2b3c4d5e6f.png")).status()).toBe(
    404,
  );
});
