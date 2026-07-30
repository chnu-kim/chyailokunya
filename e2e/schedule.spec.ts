import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

/* 미리보기는 **편집 중인 값**을 그리고, 미저장이면 다운로드가 잠긴다(2026-07-31).

   전엔 카드가 baseline(저장된 값)이라 화면과 받아지는 파일이 서로 다를 수 있었고 그 차이를
   문장으로 경고만 했다. 이제 카드가 draft 를 그리는 대신 **미저장이면 못 받는다** — 그래서
   "보이는 것 = 받는 것"이 항상 참이다(잠기지 않은 순간의 draft 는 정의상 baseline 과 같다).

   이 스펙은 그 왕복을 통째로 본다: 타이핑이 카드에 즉시 반영되고 · 그 순간 버튼이 잠기고
   이유가 뜨며 · 저장하면 둘 다 풀린다. */
test("관리자: 미리보기가 타이핑을 따라오고, 미저장이면 다운로드가 잠긴다", async ({
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

  const card = page.locator('[data-od-id="week-card"]');
  const blocked = page.locator('[data-od-id="week-card-download-blocked"]');
  const button = page.locator('[data-od-id="week-card-download-btn"]');

  // 발행된 채 저장 직후 — 막힌 이유가 없으니 받을 수 있다.
  await expect(card).toContainText("e2e 발행 항목");
  await expect(blocked).toHaveCount(0);
  await expect(button).toBeEnabled();

  /* 저장 없이 제목만 고치면 **카드가 즉시 따라오고** 버튼이 잠긴다. 카드 내용을 함께 재는 게
     핵심이다 — 잠금만 보면 카드가 옛 값에 멈춰 있어도 통과한다(고치기 전 동작이 정확히 그랬다). */
  await title.fill("e2e 발행 항목 수정");
  await expect(card).toContainText("e2e 발행 항목 수정");
  await expect(blocked).toHaveText(
    "저장하지 않은 변경이 있습니다. 저장하면 이 카드를 받을 수 있습니다.",
  );
  await expect(button).toBeDisabled();

  // 다시 저장하면 둘 다 풀린다.
  await page.locator('[data-od-id="schedule-save"]').click();
  await expect(page.locator('[data-od-id="schedule-save"]')).toHaveText("저장됨");
  await expect(blocked).toHaveCount(0);
  await expect(button).toBeEnabled();
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
  /* 안내 문구가 "항목이나 휴방이 있어야"로 바뀌었다(이슈 #117 결정 9) — 전부 휴방인 주도
     발행할 수 있게 되면서 "빈 주"의 정의가 넓어졌기 때문이다. */
  await expect(page.locator('[data-od-id="schedule-publish-status"]')).toContainText(
    "항목이나 휴방이 있어야",
  );
});

test("관리자: 휴방만 정한 주도 발행할 수 있다(이슈 #117 결정 9)", async ({ page, baseURL }) => {
  /* 옛 규칙(항목 0 = 빈 주)이면 화면은 7일이 정해진 주를 보여주는데 발행 버튼만 잠긴다 —
     이 저장소가 반복해 밟은 "게이트는 초록인데 라이브에서 막힌다" 모양이다. 서버·머신·화면
     세 자리의 가드가 같은 규칙을 쓰는지 여기서 한 번에 본다. */
  await signIn(page.context(), baseURL!);
  await page.goto("/schedule?week=2036-06-02");
  await expect(page.locator('[data-od-id="schedule-editor"]')).toBeVisible();

  await page.locator('[data-od-id="schedule-day-rest-2036-06-02"]').check();
  await page.locator('[data-od-id="schedule-save"]').click();
  await expect(page.locator('[data-od-id="schedule-save"]')).toBeDisabled();

  // 항목이 0개인데도 발행이 열린다.
  await expect(page.locator('[data-od-id="schedule-publish-toggle"]')).toBeEnabled();
  await page.locator('[data-od-id="schedule-publish-toggle"]').click();
  await page.locator('[data-od-id="schedule-publish-confirm-confirm"]').click();
  await expect(page.locator('[data-od-id="schedule-publish-chip"]')).toHaveText("공개 중");
});

/* 카드 원본 크기 보기(2026-07-31).

   미리보기는 열 폭에 맞춰 축소되므로(창 1300 에서 배율 0.633) 글자 수준 확인은 이 창이 맡는다.
   여기서 재는 것 셋:

   1. **열리면 카드가 1200px 원본이다** — 축소돼 뜨면 이 창의 존재 이유가 없다.
   2. **닫힌 dialog 는 CSS 로도 숨는다**(적대적 리뷰 지적). 브라우저 기본은
      `dialog:not([open]) { display: none }` 인데 author 가 무조건 `display: flex` 를 걸면 그걸
      이겨 닫힌 창이 화면에 남는다. 지금 구현은 열렸을 때만 마운트해 그 상태를 안 만들지만
      **그건 JS 규약이고 CSS 는 그걸 모른다** — 그래서 규칙 자체를 직접 잰다: 빈 dialog 를
      만들어 붙였다 떼며 computed display 를 본다(dom 단위는 CSS 캐스케이드를 이 수준으로
      계산하지 않아 이 축을 못 본다).
   3. 닫으면 카드가 다시 하나다 — 사본이 남으면 od-id 가 둘이 되어 다른 스펙이 깨진다. */
test("관리자: 카드를 원본 크기로 열고 닫는다", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!);
  await page.setViewportSize({ width: 1400, height: 950 });
  // 다른 스펙이 안 읽는 먼 미래 주. 저장을 안 하므로 공유 픽스처를 안 건드린다.
  await page.goto("/schedule?week=2038-03-01");
  await expect(page.locator('[data-od-id="schedule-editor"]')).toBeVisible();

  /* **닫힌 dialog 의 CSS 계약** — 열기 전에 먼저 잰다. `display: flex` 를 `[open]` 밖에 두면
     이 값이 "flex" 가 되어 빨개진다(그게 이 단언의 이빨이다). */
  const closedDisplay = await page.evaluate(() => {
    const d = document.createElement("dialog");
    d.className = "sched-zoom";
    /* `append` 가 아니라 `appendChild` 다 — 이 파일은 Node 타입 환경에서 타입체크되는데
       `append` 는 이름이 겹쳐 tsc 가 lib.dom 아닌 선언을 잡는다(실측: "Argument of type
       'HTMLDialogElement' is not assignable to 'string | ReadableStream | Response'"). */
    document.body.appendChild(d);
    const display = window.getComputedStyle(d).display;
    d.remove();
    return display;
  });
  expect(closedDisplay).toBe("none");

  await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
  await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("확대 확인용");

  await page.locator('[data-od-id="week-card-download-zoom"]').click();
  const dialog = page.locator('[data-od-id="week-card-zoom"]');
  await expect(dialog).toBeVisible();

  // 원본 크기 — 미리보기의 축소본이 아니다.
  const zoomedWidth = await dialog.locator(".week-card").evaluate((el) => el.clientWidth);
  expect(zoomedWidth).toBe(1200);
  /* 사본은 이름을 안 단다 — 같은 od-id 가 둘이면 Playwright strict 로케이터가 무관한 단언에서
     깨진다(week-card.tsx 의 `identified`). 그 계약이 실제 브라우저에서도 서는지 여기서 본다. */
  await expect(page.locator('[data-od-id="week-card"]')).toHaveCount(1);

  await page.locator('[data-od-id="week-card-zoom-close"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-od-id="week-card"]')).toHaveCount(1);
});

/* 휴방 잠금의 흐림 계약(codex 리뷰 P2 둘, 2026-07-31).

   `opacity` 는 조상과 자손이 **곱해지고**, 조상에 걸면 합성 그룹이 생겨 **자손이 되돌릴 수
   없다.** 첫 판은 잠긴 덩어리에 0.5 를 걸었는데 그래서 두 가지가 한꺼번에 걸렸다 — 안쪽
   `:disabled` 0.5 와 곱해져 25% 대 50% 로 세기가 갈렸고, 그 방식으론 **삭제 버튼 하나만 또렷하게
   남기는 것이 불가능**했다. 삭제는 휴방인 날에도 살아 있어야 하는 유일한 조작이라(빈 제목이
   저장을 막는 막다른 골목을 푸는 길) 흐리면 거짓말이 된다.

   그래서 흐림은 잠긴 컨트롤 각자가 맡는다. 이 스펙이 재는 것은 셋이다:
   잠긴 것끼리 **같은 세기** · 삭제는 **또렷** · 잠긴 이유도 **또렷**.

   **이건 e2e 가 아니면 못 본다** — dom 단위(happy-dom)는 CSS 캐스케이드를 이 수준으로 계산하지
   않고, 조상 곱셈은 computed style 하나만 봐선 드러나지도 않는다. 저장을 안 하므로 이 스펙은
   공유 픽스처를 안 건드린다. */
test("관리자: 휴방인 날 잠긴 것은 같은 세기로 흐리고 삭제는 또렷하다", async ({
  page,
  baseURL,
}) => {
  await signIn(page.context(), baseURL!);
  // 다른 스펙이 안 쓰는 주. 저장하지 않으므로 상태도 안 남는다.
  await page.goto("/schedule?week=2037-06-01");
  await expect(page.locator('[data-od-id="schedule-editor"]')).toBeVisible();

  await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
  await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("마인크래프트 하기");
  await page.locator('[data-od-id^="schedule-day-rest-"]').first().check();
  await expect(page.locator('[data-od-id^="schedule-day-rest-note-"]').first()).toBeVisible();

  const effective = await page.evaluate(() => {
    const read = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      let o = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        o *= Number(getComputedStyle(n).opacity);
      }
      return Math.round(o * 1000) / 1000;
    };
    return {
      title: read('[data-od-id^="schedule-entry-title-"]'),
      poster: read('[data-od-id^="schedule-entry-game-trigger-"]'),
      del: read('[data-od-id^="schedule-entry-del-"]'),
      add: read('[data-od-id^="schedule-day-add-"]'),
      note: read('[data-od-id^="schedule-day-rest-note-"]'),
    };
  });

  // 잠긴 것끼리는 같은 세기여야 한다 — 고정값(0.5)이 아니라 서로 같은지를 재는 이유: 디자인이
  // 흐림 정도를 바꿔도 이 계약("한 겹")은 그대로 유효해야 한다.
  expect(effective.title).toBe(effective.add);
  expect(effective.poster).toBe(effective.add);
  // 잠긴 것이 실제로 흐려지긴 해야 한다 — 위 셋이 전부 1.0 이어도 서로 같기는 하다.
  expect(effective.add).toBeLessThan(1);
  // 삭제는 유일하게 살아 있는 조작이라 또렷하다. 흐리면 "여기도 잠겼다"는 거짓말이 된다.
  expect(effective.del).toBe(1);
  // 잠긴 이유도 또렷해야 한다 — 그게 안 읽히면 잠금이 표시로서 성립하지 않는다.
  expect(effective.note).toBe(1);
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

/* 이슈 #109 작업순서 4 — **계약이 바뀌었다**(2026-07-31). 전엔 미발행이면 카드를 아예 안
   그렸고("card 가 null 이면 이른 반환") 그 사실이 곧 "발행된 주만 받을 수 있다"는 안내였다.
   미리보기가 draft 를 그리게 되면서 편집기의 카드는 **항상 있고**, 못 받는 이유는 값으로
   따로 전달된다.

   그래서 여기서 새로 재는 것: 미발행 주에서도 **미리보기는 뜨고**(새 주를 짜는 내내가 그
   상태다 — 안 뜨면 이 창을 옆에 둔 값어치가 없다) 버튼만 잠기며 그 이유가 화면에 있다. */
test("관리자: 초안 주도 미리보기는 뜨고, 다운로드만 잠긴 채 이유를 말한다", async ({
  page,
  baseURL,
}) => {
  await signIn(page.context(), baseURL!);
  // 픽스처가 안 건드리는 먼 미래 주 — 메타도 항목도 없는 브랜드-뉴 주(=초안).
  await page.goto("/schedule?week=2028-11-06");
  await expect(page.locator('[data-od-id="schedule-editor"]')).toBeVisible();

  // **미리보기는 뜬다.** 이 단언이 옛 계약("미발행이면 카드 자체가 없다")을 정확히 뒤집는다.
  await expect(page.locator('[data-od-id="week-card"]')).toBeVisible();

  await expect(page.locator('[data-od-id="week-card-download-btn"]')).toBeDisabled();
  await expect(page.locator('[data-od-id="week-card-download-blocked"]')).toHaveText(
    "발행된 주만 카드로 내려받을 수 있습니다.",
  );

  /* **사유의 순서를 못박는다.** 이 주는 미발행이면서 동시에 미저장이 될 수 있는데(무언가
     고치는 순간), 그때 "저장하면 받을 수 있습니다"라고 말하면 거짓이다 — 발행하지 않는 한
     저장해도 못 받는다. 발행이 먼저다. */
  await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
  await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("초안 항목");
  await expect(page.locator('[data-od-id="week-card-download-blocked"]')).toHaveText(
    "발행된 주만 카드로 내려받을 수 있습니다.",
  );
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
  // 7열 모양도 같은 결함이 있었다(500자 공지에서 목록이 356→104px 로 눌려 항목이 잘렸다).
  await page.locator('[data-od-id="schedule-note-input"]').fill("공".repeat(500));
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

  /* **시그니처와 치수만으로는 빈 그림을 못 가른다**(이슈 #122) — 전 픽스셀 알파 0 인 PNG 도
     여기까지 그대로 통과한다. 실제로 그런 상태로 살아 있었다(캡처 복제본에 걸린
     `position: fixed`가 SVG 안에서 카드를 화면 밖으로 밀었다, week-card-download.tsx).
     그래서 종이 색이 실제로 칠해졌는지 한 점을 찍는다: 카드 왼쪽 위 여백은 --thumb-paper 다. */
  await expectListNotSquashed(page);

  const paper = await samplePng(page, buf, { x: 24 * 2, y: 24 * 2 });
  expect(paper[3]).toBe(255); // 불투명 — 빈 캡처면 여기서 0 이다
  for (const [i, want] of [244, 238, 233].entries()) {
    expect(Math.abs(paper[i]! - want)).toBeLessThanOrEqual(6);
  }
});

/* 긴 공지가 일정 목록을 누르지 않는지 — 두 모양이 같은 규칙(공지 두 줄 상한)을 쓴다.

   **줄 수는 computed line-height 로 나눈다.** 상수로 나눴다가 헛발을 짚었다: 카드 공지는
   페이지 본문의 `line-height: 1.6` 을 물려받아 한 줄이 35.2px 인데, 스크래치 목업은 그 값을
   안 물려받아 28px 이었다 — 목업 수치를 그대로 옮기면 두 줄(70px)을 세 줄로 읽는다. 본문
   높이 406 에서 공지 두 줄(70)과 그 위 여백(22)을 빼면 목록은 314px 이 남는다. */
async function expectListNotSquashed(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const root = document.querySelector('[data-od-id="week-card"]') as HTMLElement;
    const note = root.querySelector(".week-card__note") as HTMLElement;
    const days = root.querySelector(".week-card__days") as HTMLElement;
    const first = root.querySelector(".week-card__day") as HTMLElement;
    const entries = first.querySelector(".week-card__entries") as HTMLElement;
    const lh = parseFloat(getComputedStyle(note).lineHeight);
    return {
      noteLines: Math.round(note.offsetHeight / lh),
      noteOverflowsX: note.scrollWidth > note.clientWidth + 1,
      daysH: days.offsetHeight,
      entriesClipped: entries.scrollHeight > entries.clientHeight + 1,
    };
  });
  expect(m.noteLines).toBeLessThanOrEqual(2);
  expect(m.noteOverflowsX).toBe(false);
  expect(m.daysH).toBeGreaterThanOrEqual(300);
  expect(m.entriesClipped).toBe(false);
}

/* 받은 PNG 의 한 점을 읽는다. 압축된 PNG 를 Node 에서 직접 풀려면 필터 해제까지 손으로 해야
   하고 이미지 라이브러리는 이 저장소의 직접 의존이 아니라, 이미 열려 있는 브라우저에 맡긴다. */
async function samplePng(page: Page, buf: Buffer, at: { x: number; y: number }): Promise<number[]> {
  return page.evaluate(
    async ({ base64, at }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(at.x, at.y, 1, 1).data];
    },
    { base64: buf.toString("base64"), at },
  );
}

/* 이슈 #122. **이 스펙이 없으면 "팬아트가 카드에 실렸다"를 어느 층도 못 본다** — 위 스펙의 매직
   바이트·2400×1260 은 그림이 하나도 인라인되지 않은 카드도 그대로 통과한다(html-to-image 는
   fetch 실패를 빈 src 로 삼킨다 — 그 성질이 이 이슈가 열린 이유였다, ADR-0028). 이 저장소가 같은
   자리에서 두 번 데었다: 옛 Satori 카드의 "…" 두부와 CRC 깨진 팬아트 픽스처(ADR-0030) 둘 다
   게이트 전부 초록이었다.

   그래서 **받은 파일의 픽셀을 직접 찍는다.** 단색 픽스처를 올려 그 색이 팬아트 자리에 있는지
   보고, 같은 프레임에서 목록 자리는 그 색이 **아닌지**도 본다(그림이 카드를 덮어 버린 경우를
   가른다 — 색 하나만 보면 통째로 초록인 PNG 도 통과한다).

   좌표는 하드코딩하지 않고 화면에서 잰다: 미리보기는 CSS transform 으로 축소돼 있으므로
   `getBoundingClientRect` 가 아니라 **레이아웃 오프셋**(offsetLeft/offsetTop)을 카드까지 더해
   올린 뒤 PIXEL_RATIO(2)를 곱한다. 사진지가 1.1° 기울어 있지만 회전 중심 근처를 찍으므로
   변위가 1px 미만이다(사진지 중심에서 그림 중심까지 약 13px — 실측 0.25px). */
const SOLID_FANART = fileURLToPath(new URL("./fixtures/fanart-solid-600x800.png", import.meta.url));
// 픽스처의 단색. 손으로 인코딩한 600×800 truecolor PNG(CRC 검증·브라우저 디코드 확인).
const SOLID_RGB = [0, 176, 132];
const PIXEL_RATIO = 2; // week-card-download.tsx 가 못박은 값

test("관리자: 발행된 주에 팬아트가 있으면 받은 PNG 안에 그 그림이 있다", async ({
  page,
  baseURL,
}) => {
  await signIn(page.context(), baseURL!);
  // 다른 스펙이 안 읽는 먼 미래 주(D1 픽스처를 공유하므로 — AGENTS).
  await page.goto("/schedule?week=2033-01-10");
  await page.locator('[data-od-id^="schedule-day-add-"]').first().click();
  await page.locator('[data-od-id^="schedule-entry-title-"]').first().fill("팬아트 카드 항목");

  /* 공지도 **저장 상한(500자)까지** 채운다 — 줄 수 제한이 없으면 긴 공지가 본문 높이를 먹어
     일정 목록을 누른다(실측: 팬아트 모양은 200자에서 이미 항목이 잘리고 500자면 목록 높이가
     0 이 됐다 — GitHub codex 리뷰 P2). 아래 단언이 그 자리를 잡는다. */
  await page.locator('[data-od-id="schedule-note-input"]').fill("공".repeat(500));
  await page.locator('[data-od-id="schedule-fanart-file"]').setInputFiles(SOLID_FANART);
  await expect(page.locator('[data-od-id="schedule-fanart-thumb"]')).toBeVisible();
  /* 표기를 **저장 상한(100자)까지** 채운다 — 짧은 표기로만 재면 사진지가 카드를 밀어내는
     경로를 통째로 못 본다(GitHub codex 리뷰 P2, 실측: 15자에서 이미 본문을 넘었다). 아래
     containment 단언이 그 자리를 잡는다. */
  await page.locator('[data-od-id="schedule-fanart-credit"]').fill("그림 · @" + "가".repeat(93));

  await page.locator('[data-od-id="schedule-save"]').click();
  await expect(page.locator('[data-od-id="schedule-save"]')).toHaveText("저장됨");
  await publishNow(page);

  // 카드가 팬아트 모양으로 서고 표기까지 실린다(그림이 실제로 로드된 뒤에 찍는다).
  const card = page.locator('[data-od-id="week-card"]');
  await expect(card).toHaveClass(/week-card--art/);
  await expect(card).toContainText("그림 · @가");
  await expect(card.locator(".week-card__art-img")).toBeVisible();

  /* **긴 표기가 사진지를 카드 밖으로 밀지 않는다.** 표기는 두 줄로 잠기고(CSS) 그림 상한이 그
     두 줄을 미리 빼 둔 값이라, 사진지 높이가 본문을 절대 안 넘는다 — 넘으면 카드가
     `overflow: hidden` 으로 잘려 **깨진 그림이 그대로 다운로드된다.** 회전 때문에 rect 가
     아니라 레이아웃 높이로 잰다. */
  const fit = await page.evaluate(() => {
    const root = document.querySelector('[data-od-id="week-card"]') as HTMLElement;
    const fig = root.querySelector(".week-card__art") as HTMLElement;
    const body = root.querySelector(".week-card__body") as HTMLElement;
    const cap = root.querySelector(".week-card__art-credit") as HTMLElement;
    return {
      figH: fig.offsetHeight,
      bodyH: body.offsetHeight,
      capLines: Math.round(cap.offsetHeight / 26),
      capOverflowsX: cap.scrollWidth > cap.clientWidth + 1,
      figClipsContent: fig.scrollHeight > fig.clientHeight + 1,
    };
  });
  expect(fit.figH).toBeLessThanOrEqual(fit.bodyH);
  expect(fit.capLines).toBeLessThanOrEqual(2);
  expect(fit.capOverflowsX).toBe(false);
  expect(fit.figClipsContent).toBe(false);
  await expectListNotSquashed(page);

  // 찍을 두 점(카드 좌표계) — 그림 중앙과 목록 첫 행 중앙.
  const points = await page.evaluate(() => {
    const cardEl = document.querySelector('[data-od-id="week-card"]') as HTMLElement;
    const offsetIn = (el: HTMLElement) => {
      let x = 0;
      let y = 0;
      for (let n: HTMLElement | null = el; n && n !== cardEl; n = n.offsetParent as HTMLElement) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      return { x, y };
    };
    const center = (el: HTMLElement) => {
      const o = offsetIn(el);
      return { x: Math.round(o.x + el.offsetWidth / 2), y: Math.round(o.y + el.offsetHeight / 2) };
    };
    return {
      art: center(cardEl.querySelector(".week-card__art-img") as HTMLElement),
      row: center(cardEl.querySelector(".week-card__day") as HTMLElement),
    };
  });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-od-id="week-card-download-btn"]').click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const buf = readFileSync(path!);
  expect(buf.readUInt32BE(16)).toBe(1200 * PIXEL_RATIO);

  const art = await samplePng(page, buf, {
    x: points.art.x * PIXEL_RATIO,
    y: points.art.y * PIXEL_RATIO,
  });
  const row = await samplePng(page, buf, {
    x: points.row.x * PIXEL_RATIO,
    y: points.row.y * PIXEL_RATIO,
  });

  /* 색 관리가 채널을 한두 단위 흔들 수 있어 허용 오차를 둔다 — 그림이 없을 때 그 자리는 종이
     흰색(255,255,255)이라 이 오차로는 절대 안 맞는다(채널당 최소 79 차이). */
  for (const [i, want] of SOLID_RGB.entries()) {
    expect(Math.abs(art[i]! - want)).toBeLessThanOrEqual(6);
  }
  // 목록 자리는 그 색이 아니다 — 그림이 카드를 덮은 경우를 가른다.
  expect(Math.abs(row[0]! - SOLID_RGB[0]!) > 6 || Math.abs(row[1]! - SOLID_RGB[1]!) > 6).toBe(true);
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
  /* **연결된 게임명은 이제 버튼의 접근 가능한 이름으로만 있다**(2026-07-31). 이 버튼은 44×44
     아이콘이 됐고 안에는 표지(또는 돋보기)만 들어간다 — 이름을 글자로 담던 시절엔 행의 3분의
     1을 먹었고, 그 이름은 바로 옆 제목 칸이 대개 같은 값으로 이미 말하고 있었다. `toHaveText`
     로 재면 표지 폴백의 이니셜 한 글자("엘")를 읽게 되므로 aria-label 로 잰다 — 스크린리더가
     실제로 듣는 값이라 계약으로서도 이쪽이 맞다. */
  await expect(trigger).toHaveAttribute("aria-label", "게임 연결");
  await trigger.click();

  // 로컬 매치는 검색어가 있어야 뜬다(빈 채로 보드 전체를 나열하지 않는다, schedule-game-search.tsx).
  await page.locator('[data-od-id$="-input"][role="combobox"]').fill("엘든");
  const localItem = page.locator(".sched-picker__result", { hasText: "엘든 링" });
  await localItem.click();

  await expect(trigger).toHaveAttribute("aria-label", "게임 연결: 엘든 링");
  // 제목이 비어 있었으니 게임명으로 채워진다(옛 select 와 같은 규칙).
  await expect(page.locator('[data-od-id^="schedule-entry-title-"]').first()).toHaveValue(
    "엘든 링",
  );

  // 연결 해제도 이 패널에서 한다.
  await trigger.click();
  await page.locator('[data-od-id$="-unlink"]').click();
  await expect(trigger).toHaveAttribute("aria-label", "게임 연결");
});

/* 적대적 리뷰 지적(2026-07-28, PR #114 2라운드) — 로컬 부분 일치("엘든"을 찾는데 로컬엔
   "엘든 링"만 있음)만으로 치지직 검색을 막으면, 실제로 다른 게임("엘든 링 확장팩")을 찾는
   사용자는 영영 치지직 검색도 직접 추가도 못 여는 막다른 골목에 갇힌다
   (schedule-game-search.tsx 의 hasExactLocalMatch 주석). 정확히 같은 이름일 때만 막아야
   한다는 걸 실제 화면에서 못박는다. */
test("관리자: 게임 검색 — 로컬 부분 일치가 있어도 치지직 검색이 막히지 않는다", async ({
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
              categoryId: "c-e2e-partial",
              categoryValue: "엘든 링 확장팩",
              posterImageUrl: null,
            },
          ],
        },
      }),
    }),
  );
  await signIn(page.context(), baseURL!);
  // 다른 스펙이 안 읽는 먼 미래 주.
  await page.goto("/schedule?week=2034-02-06");
  await page.locator('[data-od-id="schedule-day-add-2034-02-06"]').click();

  const trigger = page.locator('[data-od-id^="schedule-entry-game-trigger-"]').first();
  await trigger.click();
  // "엘든"은 로컬의 "엘든 링"과 부분 일치일 뿐 정확히 같은 이름이 아니므로, 로컬 매치와
  // 치지직 검색 결과가 함께 뜬다.
  await page.locator('[data-od-id$="-input"][role="combobox"]').fill("엘든");
  await expect(page.locator(".sched-picker__result", { hasText: "엘든 링" })).toBeVisible();
  await expect(page.locator(".sched-picker__result", { hasText: "엘든 링 확장팩" })).toBeVisible();
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
  // 이름은 버튼 글자가 아니라 접근 가능한 이름에 있다(위 로컬 매치 스펙의 같은 자리 주석 참고).
  await expect(trigger).toHaveAttribute("aria-label", "게임 연결: e2e 신규 게임");

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
