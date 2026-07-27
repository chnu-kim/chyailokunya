import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectSignedIn, signIn } from "./session";

/* 주간 일정(이슈 #56). 라우팅 대조는 routes.spec 이, 보드 날짜 유도·발행 경계는 tRPC 단위
   테스트가 증명한다 — 여기선 신원에 따라 서버가 다른 뷰를 주는지(공개 읽기 vs 편집기)와,
   편집기가 saveWeek 라우터의 진짜 프로덕션 소비자인지(저장 → 되읽기 왕복)를 스모크한다.
   그게 ADR-0010("테스트만 보증하는 API 는 안 남긴다")이 이 브랜치에서 닫히는 지점이다. */

/* 발행 체크박스가 없어졌다(2026-07-28, 이슈 #56 결정 14 개정) — 저장 뒤 칩을 눌러 확인창을
   거쳐야 발행된다. 이미 저장된 상태에서만 호출한다(편집기의 "발행하기" 버튼은 dirty 하면
   비활성이라, 이 헬퍼를 저장 직후에만 부르는 게 실제 사용자 순서와 같다). */
async function publishNow(page: Page): Promise<void> {
  await page.locator('[data-od-id="schedule-publish-toggle"]').click();
  await page.locator('[data-od-id="schedule-publish-confirm-confirm"]').click();
  await expect(page.locator('[data-od-id="schedule-publish-chip"]')).toHaveText("공개 중");
}

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

/* PNG 다운로드 카드는 baseline(저장된 값)으로 그린다 — 폼에 미저장 변경이 남아 있으면 미리보기가
   그 변경을 안 보여주는데, 신호가 없으면 "지금 받으면 뭐가 나가지"가 된다(이슈 #109 작업순서 3,
   적대적 리뷰가 잡은 자리). 이 스펙은 그 신호가 실제로 뜨고 저장하면 걷히는지를 본다. */
test("관리자: 발행된 주에 미저장 변경이 있으면 다운로드 카드에 힌트가 뜬다", async ({
  page,
  baseURL,
}) => {
  await signIn(page.context(), baseURL!);
  // 다른 스펙이 안 읽는 먼 미래 주.
  await page.goto("/schedule?week=2030-05-06");

  await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
  const title = page.locator('[data-od-id^="schedule-entry-title-"]').first();
  await title.fill("e2e 발행 항목");
  await page.locator('[data-od-id="schedule-save"]').click();
  await expect(page.locator('[data-od-id="schedule-save"]')).toHaveText("저장됨");
  await publishNow(page);

  // 발행된 채 저장 직후라 카드가 있고, 아직 미저장 변경이 없으니 힌트도 없다.
  const stale = page.locator('[data-od-id="week-card-download-stale"]');
  await expect(page.locator('[data-od-id="week-card"]')).toBeVisible();
  await expect(stale).toHaveCount(0);

  // 저장 없이 제목만 고치면 힌트가 뜬다.
  await title.fill("e2e 발행 항목 수정");
  await expect(stale).toBeVisible();

  // 다시 저장하면 baseline 이 갈아 끼워져 힌트가 걷힌다.
  await page.locator('[data-od-id="schedule-save"]').click();
  await expect(page.locator('[data-od-id="schedule-save"]')).toHaveText("저장됨");
  await expect(stale).toHaveCount(0);
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
     (여기서 저장하면 공유 픽스처가 오염돼 다른 스펙이 조용히 깨진다).

     이 주는 항목은 있지만 메타 행이 없어(레거시 이관) revision 이 null 이다 — "발행하기" 가
     비활성이고, 그 이유(저장된 적 없음)를 짚는 안내가 뜬다(schedule-editor.tsx 의 canPublish
     세 갈래 힌트 중 세 번째). */
  await expect(page.locator('[data-od-id="schedule-publish-chip"]')).toHaveText("비공개");
  await expect(page.locator('[data-od-id="schedule-publish-toggle"]')).toBeDisabled();
  await expect(page.locator('[data-od-id="schedule-publish-status"]')).toContainText(
    "저장된 적이 없습니다",
  );
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
     그 차이는 화면에 안 나오므로 단위 테스트가 draft 축을 직접 본다. 여기선 "항목이 없어서
     발행 못 한다"는 다른 이유의 안내가 뜨는지만 본다(위 레거시 주 테스트와 짝 — 같은 비활성
     버튼이 서로 다른 이유로 막힌다). */
  await expect(page.locator('[data-od-id="schedule-publish-chip"]')).toHaveText("비공개");
  await expect(page.locator('[data-od-id="schedule-publish-toggle"]')).toBeDisabled();
  await expect(page.locator('[data-od-id="schedule-publish-status"]')).toContainText(
    "항목이 있어야",
  );
});

/* 공개 읽기의 PNG 다운로드 회귀(적대적 리뷰 지적, PR #112). WeekCardDownload 의 submit 머신
   run 은 마운트 시점에 얼어붙는데(submit.machine.ts), 읽기 화면은 편집기와 달리 이 컴포넌트를
   key 로 리마운트시키지 않는다 — WeekNav 클라이언트 네비로 주를 넘기면 같은 컴포넌트 인스턴스가
   새 props 만 받는다. weekStartDate 를 그 run 클로저에서 직접 읽으면(고쳐지기 전 코드) 캡처된
   그림은 새 주인데 파일명만 첫 주에 고정된다 — 그래서 submit 이벤트의 values 로 실어 보내게
   고쳤고, 이 스펙이 실제 브라우저 네비게이션으로 그 수정을 못박는다(dom 단위 테스트는
   rerender() 로 같은 걸 더 빠르게 재현한다, week-card-download.test.tsx). */
test("공개 읽기: WeekNav 로 주를 넘겨도(리마운트 없이) 다운로드 파일명이 새 주를 따라간다", async ({
  page,
  baseURL,
  browser,
}) => {
  await signIn(page.context(), baseURL!);
  // 인접한 두 주 — 다른 스펙이 안 읽는 자리.
  await page.goto("/schedule?week=2031-06-02");
  await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
  await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("A 주 항목");
  await page.locator('[data-od-id="schedule-save"]').click();
  await expect(page.locator('[data-od-id="schedule-save"]')).toHaveText("저장됨");
  await publishNow(page);

  await page.goto("/schedule?week=2031-06-09");
  await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
  await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("B 주 항목");
  await page.locator('[data-od-id="schedule-save"]').click();
  await expect(page.locator('[data-od-id="schedule-save"]')).toHaveText("저장됨");
  await publishNow(page);

  // 비로그인 컨텍스트로 공개 읽기 화면에서 실제 WeekNav 클라이언트 네비게이션(리마운트 없음)을 탄다.
  // baseURL 을 명시한다 — browser.newContext() 는 이 프로젝트에서 실측으로 config 의 baseURL 을
  // 이어받는 걸 확인했지만(fixture 로 만든 page 와 달리 보장이 문서화돼 있지 않다), 상대 경로
  // goto 가 이 컨텍스트에서도 반드시 서게 명시적으로 못박는다(codex review 지적).
  const anon = await browser.newContext({ baseURL });
  const pub = await anon.newPage();
  await pub.goto("/schedule?week=2031-06-02");
  await expect(pub.locator('[data-od-id="week-card"]')).toBeVisible();

  await pub.locator('.sched-nav__step[rel="next"]').click();
  await expect(pub).toHaveURL(/week=2031-06-09/);
  await expect(pub.locator('[data-od-id="week-card"]')).toContainText("B 주 항목");

  const [download] = await Promise.all([
    pub.waitForEvent("download"),
    pub.locator('[data-od-id="week-card-download-btn"]').click(),
  ]);
  expect(download.suggestedFilename()).toBe("챠이로쿠냐_주간일정_2031-06-09.png");

  await anon.close();
});

/* 이슈 #109 작업순서 4. card 가 null(미발행)이면 버튼이 비활성이고 이유가 뜬다는 계약
   (week-card-download.tsx)을 실제 편집기 화면에서 못박는다 — dom 단위 테스트(week-card-download.test.tsx)
   는 이 분기를 직접 렌더해서 보지만, 여기선 "새로 만든 주가 초안으로 열린다"(결정 13, 위
   "항목 없는 새 주" 스펙과 같은 전제)는 실제 서버 응답 위에서 본다. */
test("관리자: 초안 주는 다운로드 버튼이 비활성이고 발행 안내가 뜬다", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!);
  // 픽스처가 안 건드리는 먼 미래 주 — 메타도 항목도 없는 브랜드-뉴 주(=초안).
  await page.goto("/schedule?week=2028-11-06");
  await expect(page.locator('[data-od-id="schedule-editor"]')).toBeVisible();

  await expect(page.locator('[data-od-id="week-card-download-btn"]')).toBeDisabled();
  await expect(page.locator('[data-od-id="week-card-download"]')).toContainText(
    "발행된 주만 카드로 내려받을 수 있습니다.",
  );
  // card 가 null 이면 미리보기 자체를 안 그린다(week-card-download.tsx 의 이른 반환).
  await expect(page.locator('[data-od-id="week-card"]')).toHaveCount(0);
});

/* 이슈 #109 작업순서 4. 상태 코드·content-type 만 보던 옛 Satori 라우트와 달리, 클라이언트
   캡처는 Playwright 가 실제 다운로드 파일 바이트까지 잴 수 있다(이슈 본문 "기술 메모"). PNG
   시그니처 + IHDR 청크(offset 16 폭·20 높이, big-endian)를 직접 읽어 외부 이미지 라이브러리
   없이도 유효성과 치수를 함께 증명한다 — 치수가 1200×630 의 정확히 2배(2400×1260)인 것은
   PIXEL_RATIO 를 devicePixelRatio 대신 2 로 고정한 결정(week-card-download.tsx)의 관찰 가능한
   결과다. */
test("관리자: 발행된 주에서 받은 PNG 는 유효하고 2400×1260 이다", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!);
  // 다른 스펙이 안 읽는 먼 미래 주.
  await page.goto("/schedule?week=2032-02-02");
  await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
  await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("PNG 검증 항목");
  await page.locator('[data-od-id="schedule-save"]').click();
  await expect(page.locator('[data-od-id="schedule-save"]')).toHaveText("저장됨");
  await publishNow(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-od-id="week-card-download-btn"]').click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const buf = readFileSync(path!);

  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  expect(buf.readUInt32BE(16)).toBe(2400); // 폭
  expect(buf.readUInt32BE(20)).toBe(1260); // 높이
});

/* 발행/저장 분리(이슈 #56 결정 14 개정, 2026-07-28). 비공개 전환은 저장과 달리 dirty 여도
   막히지 않는다(schedule-save.machine.ts 의 canUnpublish 주석 — 급히 내려야 하는데 마침 다른
   걸 고치던 중이라 막히면 안전이 아니라 방해다). 이 스펙이 그 비대칭을 실제 화면에서 증명한다. */
test("관리자: 발행을 취소하면 공개만 꺼지고 항목은 남는다 — 미저장 변경 중에도 가능하다", async ({
  page,
  baseURL,
}) => {
  await signIn(page.context(), baseURL!);
  // 다른 스펙이 안 읽는 먼 미래 주.
  await page.goto("/schedule?week=2033-05-02");
  await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
  await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("발행 취소 확인용");
  await page.locator('[data-od-id="schedule-save"]').click();
  await expect(page.locator('[data-od-id="schedule-save"]')).toHaveText("저장됨");
  await publishNow(page);

  // 발행된 채로 다른 걸 고치는 중(dirty)이어도 비공개 전환 버튼은 활성이다.
  await page.locator('[data-od-id="schedule-note-input"]').fill("아직 저장 안 한 공지");
  await expect(page.locator('[data-od-id="schedule-publish-toggle"]')).toBeEnabled();
  await page.locator('[data-od-id="schedule-publish-toggle"]').click();
  await expect(page.getByRole("heading", { name: "비공개로 전환하시겠습니까?" })).toBeVisible();
  await page.locator('[data-od-id="schedule-publish-confirm-confirm"]').click();
  await expect(page.locator('[data-od-id="schedule-publish-chip"]')).toHaveText("비공개");

  // 항목은 그대로 남는다 — 발행 취소가 entries·note 를 안 건드린다(publishWeek 계약).
  await expect(page.locator('[data-od-id^="schedule-entry-title-"]').first()).toHaveValue(
    "발행 취소 확인용",
  );
});

/* firstBlankTitleEntry 가드(core/schedule-editor.ts, Plan 에이전트 리뷰 2026-07-28) — 제목이
   빈 항목을 그냥 두면 draftEntryInputs 가 조용히 걸러 버려 저장 "성공" 뒤 그 줄이 신호 없이
   사라진다. 저장 자체가 막히고 요일을 짚은 안내가 뜨는지를 실제 화면에서 본다. */
test("관리자: 제목이 빈 항목이 있으면 저장이 막히고 요일을 짚은 안내가 뜬다", async ({
  page,
  baseURL,
}) => {
  await signIn(page.context(), baseURL!);
  // 다른 스펙이 안 읽는 먼 미래 주 — 2033-09-05 는 월요일.
  await page.goto("/schedule?week=2033-09-05");
  /* 항목 하나만 빈 채로 두면 dirty 자체가 안 선다 — draftEntryInputs 가 빈 제목 항목을
     dirty 비교에서도 걸러내므로(isWeekDirty 가 그 함수를 그대로 쓴다), 저장 버튼이 계속
     비활성이라 이 가드를 만날 수조차 없다. 그래서 **하나는 채우고 하나는 비운다** — 채운
     쪽이 dirty 를 세워 저장 버튼을 활성화하고, 빈 쪽이 이 가드에 걸린다. */
  await page.locator('[data-od-id="schedule-day-add-2033-09-05"]').click();
  await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("채워진 항목");
  await page.locator('[data-od-id="schedule-day-add-2033-09-05"]').click();

  const save = page.locator('[data-od-id="schedule-save"]');
  await expect(save).toBeEnabled();
  await save.click();
  const err = page.locator('[data-od-id="schedule-save-error"]');
  await expect(err).toContainText("월요일");
  await expect(err).toContainText("제목이 없습니다");
  // 서버로 안 나갔다 — 버튼이 여전히 "저장"이다("저장됨"으로 안 바뀐다).
  await expect(save).toHaveText("저장");

  // 두 번째 항목의 제목을 채우면 막던 이유가 없어져 정상 저장된다.
  await page.locator('[data-od-id^="schedule-entry-title-"]').nth(1).fill("이제 채웠다");
  await save.click();
  await expect(save).toHaveText("저장됨");
});

/* 게임 인라인 검색·추가(이슈 #56 결정 11·19, 2026-07-28 구현). 로컬 매치(보드에 이미 있는
   게임)와 치지직 신규 추가 두 경로를 모두 본다. 치지직 검색은 가로챈다(games-composer.spec.ts
   와 같은 근거 — .dev.vars.e2e 엔 치지직 자격증명이 없다). */
test("관리자: 게임 검색 — 보드에 있는 게임은 로컬에서 즉시 잇는다", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!);
  // 픽스처의 "엘든 링"은 다른 스펙도 참조하지만 읽기만 하므로 안전하다(games.sql).
  await page.goto("/schedule?week=2033-11-07");
  await page.locator('[data-od-id="schedule-day-add-2033-11-07"]').click();

  const trigger = page.locator('[data-od-id^="schedule-entry-game-trigger-"]').first();
  await expect(trigger).toHaveText("게임 연결");
  await trigger.click();

  // 로컬 매치는 검색어가 있어야 뜬다(빈 채로 보드 전체를 나열하지 않는다, schedule-game-search.tsx).
  await page.locator('[data-od-id$="-input"][role="combobox"]').fill("엘든");
  const localItem = page.locator(".sched-picker__result", { hasText: "엘든 링" });
  await localItem.click();

  await expect(trigger).toHaveText("엘든 링");
  // 제목이 비어 있었으니 게임명으로 채워진다(옛 select 와 같은 규칙).
  await expect(page.locator('[data-od-id^="schedule-entry-title-"]').first()).toHaveValue(
    "엘든 링",
  );

  // 연결 해제도 이 패널에서 한다.
  await trigger.click();
  await page.locator('[data-od-id$="-unlink"]').click();
  await expect(trigger).toHaveText("게임 연결");
});

test("관리자: 게임 검색 — 로컬에 없으면 치지직에서 찾아 새로 추가하고 즉시 잇는다", async ({
  page,
  baseURL,
}) => {
  await page.route("**/api/trpc/chzzk.categorySearch*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          data: [
            {
              categoryType: "GAME",
              categoryId: "c-e2e-newgame",
              categoryValue: "e2e 신규 게임",
              posterImageUrl: null,
            },
          ],
        },
      }),
    }),
  );
  await signIn(page.context(), baseURL!);
  // 다른 스펙이 안 읽는 먼 미래 주.
  await page.goto("/schedule?week=2034-01-02");
  await page.locator('[data-od-id="schedule-day-add-2034-01-02"]').click();

  const trigger = page.locator('[data-od-id^="schedule-entry-game-trigger-"]').first();
  await trigger.click();
  const input = page.locator('[data-od-id$="-input"][role="combobox"]');
  await input.fill("e2e 신규");

  // 치지직 결과는 확인 없이 바로 추가된다(결정 19 — 정본 카테고리라 되돌릴 이유가 약하다).
  await page.locator(".sched-picker__result", { hasText: "e2e 신규 게임" }).click();
  await expect(trigger).toHaveText("e2e 신규 게임");

  /* 이 항목 자체는 미저장이라 새로고침하면 사라지지만, games.add 는 playedDate:null 로 게임
     행만 즉시 만들었으므로(결정 19) **게임은 서버에 남아 있어야 한다** — 새로고침 뒤 새
     항목을 열어 로컬 매치로(치지직 모킹 없이) 다시 찾아지는지로 그 영속을 확인한다. */
  await page.reload();
  await page.locator('[data-od-id="schedule-day-add-2034-01-02"]').click();
  const trigger2 = page.locator('[data-od-id^="schedule-entry-game-trigger-"]').first();
  await trigger2.click();
  await page.locator('[data-od-id$="-input"][role="combobox"]').fill("e2e 신규");
  await expect(page.locator(".sched-picker__result", { hasText: "e2e 신규 게임" })).toBeVisible();
});

/* og:url canonical(적대적 리뷰 지적). 발행 여부와 무관하게 metadata 는 항상 나가므로 로그인·
   발행 없이 확인한다 — 다른 스펙과 겹치지 않는 완전히 새 주를 쓴다. */
test("og:url — week 이 명시된 공유는 그 주로 못박고, 맨 /schedule 은 안 박는다", async ({
  baseURL,
  request,
}) => {
  const withWeek = await (await request.get(`${baseURL}/schedule?week=2029-08-06`)).text();
  expect(withWeek).toContain(
    'property="og:url" content="https://chyailokunya.com/schedule?week=2029-08-06"',
  );

  // exact-match 이므로 이 줄이 통과하면 그 자체로 og:url 에 ?week= 가 안 붙었다는 뜻이다 —
  // 페이지 본문의 WeekNav(지난주·다음주 링크)는 원래도 "/schedule?week=" 를 담고 있어
  // 페이지 전체에서 그 부분 문자열의 부재를 따로 재면 오탐이다.
  const bare = await (await request.get(`${baseURL}/schedule`)).text();
  expect(bare).toContain('property="og:url" content="https://chyailokunya.com/schedule"');
});
