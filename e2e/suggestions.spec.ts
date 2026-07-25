import { expect, test, type Page } from "@playwright/test";
import { E2E_FAN, expectSignedIn, signIn } from "./session";

/* 팬 수정 제안(ADR-0025). 이 기능의 계약은 **권한이 빈 사람이 무언가를 할 수 있다**는 것이라,
   admin 픽스처(user 1)로 재면 정확히 그 축을 못 본다 — 여기선 역할 행이 없는 user 2 로 잰다
   (e2e/fixtures/games.sql 의 팬 블록).

   ── 이 스펙은 게임 값을 안 바꾼다 ──────────────────────────────────────────────────
   e2e 는 D1 픽스처 하나를 공유하고 fullyParallel 이라 격리가 없다. 제안을 **반영해 저장**까지
   하면 그 게임의 클리어·날짜가 바뀌어 games.spec 의 카드 단언과 visual 스냅샷이 조용히 깨진다.
   그래서 여기선 반영 폼이 **제안 값으로 채워져 열리는 것까지만** 보고 저장은 안 한다 —
   "저장하면 게임이 바뀐다"는 평소의 update 경로 그대로라 games.spec 이 이미 덮고 있고
   (승인 전용 쓰기를 안 만든 게 결정 2 다), 제안 특유의 계약은 프리필과 목록에서 사라지는 것이다.

   같은 이유로 테스트마다 **다른 게임**에 제안을 만든다. 게임당 사람당 미처리 하나라는 제약이
   있어(부분 UNIQUE) 같은 게임을 쓰면 병렬 실행 순서에 따라 CONFLICT 가 난다. 제안함 목록의
   **개수는 단언하지 않는다** — 다른 테스트가 만든 줄이 같은 목록에 섞이기 때문이다. */

// 카드를 눌러 상세를 연다 — 카드 안의 유일한 버튼이 곧 카드 전체의 히트 영역이다(games.spec 과 같은 손잡이).
function openCard(page: Page, name: string) {
  return page.locator(".game").filter({ hasText: name }).getByRole("button").click();
}

/* 팬으로 그 게임에 제안 하나를 보낸다. 값을 반드시 하나 바꾼다 — 값도 그대로고 한마디도 없으면
   서버가 "아무 말도 안 하는 제안"으로 거절한다(core.isEmptyEditSuggestion). */
async function sendSuggestion(page: Page, game: string, note: string) {
  await openCard(page, game);
  await page.locator("[data-od-id^='game-suggest-']").click();
  await page.locator("[data-od-id='suggest-clear-cleared']").check();
  await page.locator("[data-od-id='suggest-note']").fill(note);
  await page.locator("[data-od-id='suggest-submit']").click();
  /* **보낸 뒤에도 폼은 열려 있다** — 제안은 보드를 안 바꾸므로 모달이 사라지는 것 말고는
     성공 신호가 없어서, 카드 안에서 결과를 말하고 사용자가 닫는다(suggest-dialog 주석). */
  await page.locator("[data-od-id='suggest-sent']").waitFor();
  await page.locator("[data-od-id='suggest-done']").click();
}

test("제안: 비로그인에겐 버튼 대신 로그인 안내가 뜬다", async ({ page }) => {
  await page.goto("/games");
  await openCard(page, "엘든 링");

  await expect(page.locator("[data-od-id='detail-signin-hint']")).toBeVisible();
  await expect(page.locator("[data-od-id^='game-suggest-']")).toHaveCount(0);
  // 관리자 조작도 당연히 없다 — 이 안내가 그 자리를 대신 채우는 게 아니라는 확인이다.
  await expect(page.locator("[data-od-id^='game-edit-']")).toHaveCount(0);
});

test("제안: 권한 없는 팬에게 제안 진입점이 열린다(관리자 조작은 그대로 없다)", async ({
  page,
  baseURL,
}) => {
  await signIn(page.context(), baseURL!, E2E_FAN);
  await page.goto("/games");
  await expectSignedIn(page);

  // 보드 전체에 걸리는 조작 — 팬은 추가 요청만, 제안함은 못 본다.
  await expect(page.locator("[data-od-id='suggest-add-open']")).toBeVisible();
  await expect(page.locator("[data-od-id='inbox-open']")).toHaveCount(0);

  await openCard(page, "엘든 링");
  await expect(page.locator("[data-od-id^='game-suggest-']")).toBeVisible();
  // 로그인했다고 쓰기가 열리는 게 아니다 — UI 도 서버와 같은 말을 해야 한다(불변식 3).
  await expect(page.locator("[data-od-id^='game-edit-']")).toHaveCount(0);
  await expect(page.locator("[data-od-id^='game-del-']")).toHaveCount(0);
  await expect(page.locator("[data-od-id='detail-signin-hint']")).toHaveCount(0);
});

test("제안: 팬이 보낸 제안이 접수된다", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!, E2E_FAN);
  await page.goto("/games");
  await expectSignedIn(page);

  await sendSuggestion(page, "마인크래프트", "7/20 방송에서 엔딩 봤어요");

  // 닫으면 모달이 사라지고 라이브 영역이 결과를 말한다. 보드 값은 그대로다 — 제안은 게임을 안 바꾼다.
  await expect(page.locator("[data-od-id='game-suggest']")).toHaveCount(0);
  await expect(page.locator("[role='status']")).toContainText("수정 제안을 보냈어요");
  await expect(
    page.locator(".game").filter({ hasText: "마인크래프트" }).getByText("클리어"),
  ).toHaveCount(0);
});

test("제안: 같은 게임에 두 번째 제안은 막힌다(처리될 때까지)", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!, E2E_FAN);
  await page.goto("/games");
  await expectSignedIn(page);

  /* 셀레스테는 픽스처에서 **이미 클리어**라 위 헬퍼의 체크가 no-op 이다 — 값은 하나도 안
     바뀌고 한마디만 실린다. 그것도 유효한 제안이라는 걸 이 자리가 겸해서 덮는다
     (값으로 표현 못 하는 제보의 길 — core.isEmptyEditSuggestion). */
  await sendSuggestion(page, "셀레스테", "첫 번째 제안");
  await expect(page.locator("[role='status']")).toContainText("수정 제안을 보냈어요");

  /* 두 번째. 첫 제안을 닫아도 **상세는 열린 채 남으므로**(제안 폼은 그 위에 겹쳐 떴다) 카드를
     다시 열지 않는다. 폼은 그대로 열리고 **서버가** 거절한다 — 화면이 먼저 막지 않는 건 그
     판정에 필요한 사실(내가 이미 보냈나)이 클라이언트에 없기 때문이다. */
  await page.locator("[data-od-id^='game-suggest-']").click();
  await page.locator("[data-od-id='suggest-note']").fill("두 번째 제안");
  await page.locator("[data-od-id='suggest-submit']").click();

  /* getByRole("alert") 로 잡으면 Next 의 라우트 announcer(빈 div, 같은 role)가 먼저 걸린다 —
     우리 문구 자리로 좁힌다. */
  await expect(page.locator("[data-od-id='game-suggest'] .err")).toContainText(
    "이미 보낸 제안이 있어요",
  );
  // 실패했으니 폼은 열린 채여야 한다 — 닫히면 사용자가 쓴 글이 사라진다.
  await expect(page.locator("[data-od-id='game-suggest']")).toBeVisible();
});

test("제안: 관리자 제안함이 현재→제안 차이를 보여주고, 반영이 그 값으로 폼을 연다", async ({
  page,
  baseURL,
}) => {
  const context = page.context();
  await signIn(context, baseURL!, E2E_FAN);
  await page.goto("/games");
  await expectSignedIn(page);
  await sendSuggestion(page, "스타듀 밸리", "여기 한마디");
  await expect(page.locator("[role='status']")).toContainText("수정 제안을 보냈어요");

  // 같은 브라우저로 신원만 바꾼다 — 쿠키를 비우고 관리자(user 1)로 다시 심는다.
  await context.clearCookies();
  await signIn(context, baseURL!);
  await page.goto("/games");
  await expectSignedIn(page);

  await page.locator("[data-od-id='inbox-open']").click();
  const row = page.locator(".inbox__item").filter({ hasText: "스타듀 밸리" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("쿠냐팬");
  await expect(row).toContainText("여기 한마디");
  /* 바뀌는 값만, 표기형으로. 팬이 클리어만 켰으므로 한 줄이어야 한다 — 안 바뀌는 줄까지
     그리면 관리자가 무엇을 봐야 하는지가 화면에서 사라진다(core.diffSuggestion). */
  await expect(row.locator(".inbox__change")).toHaveCount(1);
  await expect(row.locator(".inbox__from")).toHaveText("미완료");
  await expect(row.locator(".inbox__to")).toHaveText("완료");

  /* 반영 = 제안 값이 **채워진 채로** 기존 수정 폼이 열리는 것. 저장은 여기서 안 한다(위 주석) —
     이 단언이 이 기능의 핵심 계약이다: 관리자가 값을 손으로 옮겨 적지 않아도 된다. */
  await row.locator("[data-od-id^='suggestion-apply-']").click();
  await expect(page.locator("[data-od-id='game-editor']")).toBeVisible();
  await expect(page.locator("[data-od-id='editor-clear-cleared']")).toBeChecked();
  await expect(page.locator("[data-od-id='game-editor-game']")).toContainText("스타듀 밸리");
});

test("제안: 거절하면 제안함에서 사라진다", async ({ page, baseURL }) => {
  const context = page.context();
  await signIn(context, baseURL!, E2E_FAN);
  await page.goto("/games");
  await expectSignedIn(page);
  await sendSuggestion(page, "할로우 나이트", "거절될 제안");
  await expect(page.locator("[role='status']")).toContainText("수정 제안을 보냈어요");

  await context.clearCookies();
  await signIn(context, baseURL!);
  await page.goto("/games");
  await expectSignedIn(page);

  await page.locator("[data-od-id='inbox-open']").click();
  const row = page.locator(".inbox__item").filter({ hasText: "할로우 나이트" });
  await expect(row).toBeVisible();
  await row.locator("[data-od-id^='suggestion-reject-']").click();

  // 목록에서 빠진다. 개수는 안 센다 — 다른 테스트의 제안이 같은 목록에 섞인다(위 주석).
  await expect(row).toHaveCount(0);
});
