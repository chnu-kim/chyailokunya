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

test("관리자: 주를 이동하면 편집기가 새 주로 리셋된다(draft 이월 없음)", async ({
  page,
  baseURL,
}) => {
  await signIn(page.context(), baseURL!);
  // 미저장 이탈 confirm 은 수락한다(이동을 진행시켜 리셋을 관찰).
  page.on("dialog", (d) => d.accept());
  await page.goto("/schedule?week=2027-04-05");

  // 이 주 편집기에 공지를 넣어 dirty 로 만든다(저장은 안 한다).
  const note = page.locator('[data-od-id="schedule-note-input"]');
  await note.fill("이 공지는 이 주에만");

  // WeekNav "다음주"로 이동 — 미저장이라 confirm 이 뜨고, 수락되어 새 주로 간다.
  const before = page.url();
  await page.locator('.sched-nav__step[rel="next"]').click();
  await page.waitForFunction((u) => location.href !== u, before);

  // 새 주 편집기의 공지는 비어 있어야 한다 — key remount 로 draft·baseline 이 새 주에서
  // 다시 서기 때문이다(안 그러면 옛 주 공지가 이월돼 저장이 새 주를 덮어쓴다).
  await expect(page.locator('[data-od-id="schedule-note-input"]')).toHaveValue("");
});

test("관리자: 이관된 레거시 주는 항목이 있어도 발행이 꺼진 채 열린다", async ({
  page,
  baseURL,
}) => {
  await signIn(page.context(), baseURL!);
  /* 픽스처의 일정 항목엔 schedule_weeks 메타가 없다 — 마이그레이션 0007 이 옛 played_at 을
     이관해 놓은 과거 아카이브와 같은 모양이고, 보드는 그걸 초안이 아닌 주로 센다(ADR-0022). */
  await page.goto("/schedule?week=2026-03-01");
  await expect(page.locator('[data-od-id="schedule-editor"]')).toBeVisible();
  await expect(page.locator('[data-od-id^="schedule-entry-title-"]').first()).toHaveValue(
    "엘든 링",
  );

  /* 발행은 **꺼진 채** 열린다 — 이 주는 주간표로 공개된 적이 없으니 그게 사실이다.
     한때는 체크된 채 열었다: 발행을 끄고 저장하면 published_at NULL 인 메타가 생겨 그 주의
     과거 플레이 날짜가 보드에서 사라졌기 때문이다(손실 0 이 첫 편집에서 깨지는 경로). draft
     축이 그 결합을 끊어서(ADR-0022 갱신) 이제 꺼진 채 저장해도 날짜가 산다 — 화면이 서버의
     구현 사정을 흉내 낼 필요가 없어졌다. 저장 후 날짜가 실제로 사는지는 단위 테스트가 본다
     (여기서 저장하면 공유 픽스처가 오염돼 다른 스펙이 조용히 깨진다). */
  await expect(page.locator('[data-od-id="schedule-publish"]')).not.toBeChecked();
});

test("관리자: 항목 없는 새 주는 초안으로 열린다(발행 체크 안 됨 — 결정 13)", async ({
  page,
  baseURL,
}) => {
  await signIn(page.context(), baseURL!);
  // 픽스처가 안 건드리는 먼 미래 주 — 메타도 항목도 없는 브랜드-뉴 주.
  await page.goto("/schedule?week=2028-01-03");
  await expect(page.locator('[data-od-id="schedule-editor"]')).toBeVisible();
  // 항목이 하나도 없다(레거시가 아니다).
  await expect(page.locator('[data-od-id^="schedule-entry-title-"]')).toHaveCount(0);
  /* 발행은 **꺼진 채** 열려야 한다 — 다음 주를 처음 짜는 자리라 초안이 기본이고, 발행은 다
     되면 관리자가 켠다(결정 13). 레거시 주와 화면상 같은 단언이지만 서버가 쥔 상태는 다르다:
     항목 없는 이 주는 draft(보드에도 안 뜸)이고, 레거시 주는 확정 비공개(보드엔 뜸)다.
     그 차이는 화면에 안 나오므로 단위 테스트가 draft 축을 직접 본다. */
  await expect(page.locator('[data-od-id="schedule-publish"]')).not.toBeChecked();
});
