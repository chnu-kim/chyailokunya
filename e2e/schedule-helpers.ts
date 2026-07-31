/* 일정 편집기의 하루 칸 아코디언(이슈 #56 결정 28, 2026-07-31)을 e2e 에서 다루는 공유 헬퍼.

   시각 입력·휴방 체크박스·항목(게임 트리거·제목·삭제)·＋ 버튼이 전부 펼친 패널 안으로
   내려갔다 — 접힌 상태에선 `schedule-day-time-`·`schedule-day-rest-`·`schedule-entry-*`·
   `schedule-day-add-` 가 DOM 에 없다. 이 조작들을 바로 클릭하던 e2e 25곳 이상이 이 헬퍼를
   앞세운다(schedule·games·fanart·visual·narrow-body 스펙).

   한 번에 하나만 열리므로(single accordion) 이미 다른 날이 열려 있어도 이 헬퍼가 그 날을
   접고 대상 날을 편다 — 순서를 신경 쓸 필요가 없다. */

import type { Locator, Page } from "@playwright/test";

/* `date` 는 'YYYY-MM-DD'(schedule-day-toggle-<date> 를 정확히 짚는다), 숫자는 그 주의
   요일 인덱스(0=월)다 — 날짜를 계산하기 귀찮은 "첫 날"류 호출(기존 `.first()` 자리)엔
   인덱스가 더 짧다. 이미 펼쳐진 날을 다시 열려 하면 아무 일도 안 한다(닫히지 않는다) —
   호출자가 "이 날이 열려 있다"만 보장받으면 되지, 토글의 부수효과까지 알 필요는 없다. */
export async function openDay(page: Page, dayOrIndex: string | number): Promise<void> {
  const toggle: Locator =
    typeof dayOrIndex === "number"
      ? page.locator('[data-od-id^="schedule-day-toggle-"]').nth(dayOrIndex)
      : page.locator(`[data-od-id="schedule-day-toggle-${dayOrIndex}"]`);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}
