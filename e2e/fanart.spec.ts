import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import { E2E_FAN, signIn } from "./session";

/* 팬아트 업로드·서빙 라우트(ADR-0028). 파일 바이트가 오가는 경계라 tRPC 단위 테스트가 못 닿는다
   — 인가·CSRF·형식 판정·상한이 전부 HTTP 계층에 있고, R2 왕복까지 실제로 돌아야 계약이 증명된다.
   Miniflare 의 로컬 R2 위에서 돈다(D1 과 같은 구조).

   브라우저 대신 `context.request` 로 두드린다 — 이 라우트의 진짜 소비자는 화면의 fetch 이고
   (PR 2), 여기서 재려는 건 그 fetch 가 받게 될 서버 응답 자체다. */

const UPLOAD = "/api/fanart";

// 각 형식의 실제 앞머리 + 뒤에 아무 바이트. 판정은 앞머리만 보므로 이걸로 충분하다.
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

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

/* **크기 상한(413)은 여기서 안 잰다.** 재려면 5MB 본문을 실제로 전송해야 하는데, 그러면
   `next dev` 서버가 그 요청에 묶여 **무관한 스펙들이 줄줄이 타임아웃된다** — 실측으로 전체
   e2e 가 2.7분·5개 실패였다가, 그 테스트 하나를 빼니 1.2분·122개 전부 통과였다(실패하는
   스펙도 실행마다 달라지는 전형적인 자원 경합이다). Content-Length 만 크게 위조해 싸게 재는
   길도 막혀 있다: Playwright 가 실제 본문 길이로 덮어쓴다(실측 201).

   그래서 판정 자체를 순수 함수로 올려 경계값을 단위 테스트가 못박는다(core/fanart 의
   `isOverFanartLimit` — 상한 정확히·+1·헤더 부재·쓰레기 헤더). 이 파일이 증명하는 것은
   "라우트가 거절을 실제 상태 코드로 낸다"이고 그 계약은 아래 415·400 이 이미 보여 준다.
   상한만 유일하게 e2e 밖에 남는 것이 아니라, **같은 종류의 거절을 재는 경로가 이미 있다.** */

test("서빙: 키 형식이 아니거나 없는 객체는 404", async ({ request }) => {
  // 경로 순회. 키 검증이 이 한 자리에서 막으므로 R2 를 두드리지도 않는다.
  expect((await request.get("/api/fanart/..%2F..%2Fpackage.json")).status()).toBe(404);
  expect((await request.get("/api/fanart/not-a-key.png")).status()).toBe(404);
  // 형식은 맞지만 없는 객체.
  expect((await request.get("/api/fanart/0189d1f0-3a4b-7c8d-9e0f-1a2b3c4d5e6f.png")).status()).toBe(
    404,
  );
});
