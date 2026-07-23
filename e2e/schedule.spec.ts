import { expect, test } from "@playwright/test";
import { expectSignedIn, signIn } from "./session";

/* 주간 일정(이슈 #56). 라우팅 대조는 routes.spec 이, 보드 날짜 유도·발행 경계는 tRPC 단위
   테스트가 증명한다 — 여기선 신원에 따라 서버가 다른 뷰를 주는지(공개 읽기 vs 편집기)와,
   편집기가 saveWeek 라우터의 진짜 프로덕션 소비자인지(저장 → 되읽기 왕복)를 스모크한다.
   그게 ADR-0010("테스트만 보증하는 API 는 안 남긴다")이 이 브랜치에서 닫히는 지점이다. */

test("비로그인: 미발행 현재 주는 준비 중 빈 상태, 편집기는 없다", async ({ page }) => {
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { level: 1, name: "주간 일정" })).toBeVisible();
  // 픽스처엔 발행된 주가 없어(schedule_weeks 0행) 공개 읽기는 null → 준비 중.
  await expect(page.locator('[data-od-id="schedule-empty"]')).toBeVisible();
  // 편집기는 쓰기 권한 뒤라 비로그인엔 안 뜬다(서버가 뷰 자체를 가른다).
  await expect(page.locator('[data-od-id="schedule-editor"]')).toHaveCount(0);
});

test("관리자: 편집기로 항목을 저장하고 되읽는다", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!);
  // 다른 스펙이 안 읽는 먼 미래 주. 초안·게임 없음이라 보드·현재 주에 영향 0(격리).
  await page.goto("/schedule?week=2027-01-15");
  await expectSignedIn(page);

  await expect(page.locator('[data-od-id="schedule-editor"]')).toBeVisible();
  await expect(page.locator(".sched-day")).toHaveCount(7);

  // 첫 날(월요일) 카드에 자유 항목을 더한다 → 제목 채우기 전엔 저장에 안 실려 dirty 가 아니다.
  await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
  const title = page.locator('[data-od-id^="schedule-entry-title-"]').first();
  await title.fill("e2e 저챗");

  const save = page.locator('[data-od-id="schedule-save"]');
  await expect(save).toBeEnabled();
  await save.click();
  // 저장이 서버까지 끝나면 dirty 가 풀려 버튼이 "저장됨"(비활성)으로 바뀐다.
  await expect(save).toHaveText("저장됨");

  // 되읽기: 새로고침해도 getWeekForEdit 왕복으로 항목이 남는다.
  await page.reload();
  await expect(page.locator('[data-od-id^="schedule-entry-title-"]').first()).toHaveValue(
    "e2e 저챗",
  );
});
