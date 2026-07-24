import { expect, test } from "@playwright/test";

/* 게임 보드는 D1 에서 서버가 읽어 렌더한다(Phase 3). 데이터는 globalSetup 이 심은 결정적
   픽스처 8장(날짜 조합 골고루, poster null, 기본 뷰포트 5열이라 두 행). 추가·수정·삭제 UI 는 쓰기 권한이 있어야 뜨므로
   여기선 읽기만 스모크한다 — 쓰기의 "서버 권위"는 tRPC 단위테스트가 증명한다(이슈 #5).

   상태 필터 스모크가 여기 있었다. status 컬럼과 함께 UI 에서 사라졌고, 그 자리를 날짜 표시
   검증이 대신한다 — 필터가 덮던 "행마다 다른 상태"를 이제 날짜 조합이 표현한다. */

const CARDS = ".game";

test("게임: D1 에서 읽어 렌더 · 날짜 표시", async ({ page }) => {
  await page.goto("/games");

  await expect(page.getByRole("heading", { level: 1, name: "플레이한 게임" })).toBeVisible();
  // 서버가 D1 에서 읽어온 픽스처 8장. 5열 뷰포트라 두 행이 되고, 그래야 시각 스냅샷이
  // 행 높이 균일화(.games 의 grid-auto-rows)를 실제로 본다 — 한 행이면 그 축이 안 잡힌다.
  await expect(page.locator(CARDS)).toHaveCount(8);
  await expect(page.getByRole("heading", { name: "엘든 링" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "마인크래프트" })).toBeVisible();

  // 플레이한 날만 있는 행 — 날짜 한 줄, 클리어 칩 없음.
  const elden = page.locator(CARDS).filter({ hasText: "엘든 링" });
  await expect(elden).toContainText("2026.03.01 플레이");
  await expect(elden.getByText("클리어")).toHaveCount(0);

  // 플레이 + 클리어 둘 다 있는 행 — 날짜 줄 옆에 클리어 칩.
  const little = page.locator(CARDS).filter({ hasText: "리틀 나이트메어" });
  await expect(little).toContainText("2026.04.11 플레이");
  await expect(little.getByText("클리어")).toBeVisible();

  // 플레이 일정이 없이 클리어만 아는 행 — 카드에 뜨는 날짜는 유도된 플레이 날짜뿐이라 일정이
  // 없으면 날짜 줄이 아예 없고, 클리어 사실은 칩이 홀로 맡는다. 클리어한 날(2026-05-02)은
  // 어디에도 안 나온다 — 정렬 축이 아닌 날짜를 카드에 실으면 순서가 어긋나 보이기 때문이다.
  // (줄 자체는 칩을 담아야 하므로 남는다 — 사라지는 건 날짜 텍스트다.)
  const hollow = page.locator(CARDS).filter({ hasText: "할로우 나이트" });
  await expect(hollow.locator(".game__date")).toHaveCount(0);
  await expect(hollow.getByText("클리어")).toBeVisible();
  await expect(hollow).not.toContainText("2026.05.02");

  // 날짜가 하나도 없는 행 — 날짜 줄 자체를 렌더하지 않는다.
  const manual = page.locator(CARDS).filter({ hasText: "직접 넣은 게임" });
  await expect(manual).toBeVisible();
  await expect(manual.locator('[data-od-id^="game-when-"]')).toHaveCount(0);

  // 정렬: 유도된 플레이 날짜(lastPlayed = MAX(scheduled_date)) 내림차순, 일정이 없어 null 인
  // 행은 뒤 그룹에서 created_at 내림차순. 할로우 나이트는 클리어한 날이 있어도 일정 항목이 없어
  // (lastPlayed null) 뒤 그룹이다 — 클리어 날짜는 정렬 축이 아니라는 규칙이 여기서 한 번 실행된다.
  await expect(page.locator(CARDS + " .game__name")).toHaveText([
    "마인크래프트",
    "리틀 나이트메어",
    "엘든 링",
    "레이튼 교수와 최후의 시간여행 모바일 HD 리마스터",
    "셀레스테",
    "스타듀 밸리",
    "직접 넣은 게임",
    "할로우 나이트",
  ]);
});
