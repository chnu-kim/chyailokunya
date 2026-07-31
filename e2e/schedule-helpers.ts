/* 일정 편집기의 하루 칸 아코디언(이슈 #56 결정 28, 2026-07-31)을 e2e 에서 다루는 공유 헬퍼.

   항목 조작(게임 트리거·제목·삭제)과 ＋ 버튼이 펼친 패널 안에 있다 — 접힌 상태에선
   `schedule-entry-*`·`schedule-day-add-` 가 DOM 에 없다. 이 조작들을 바로 클릭하던 e2e
   25곳 이상이 이 헬퍼를 앞세운다(schedule·games·fanart·visual·narrow-body 스펙).

   **시각·휴방은 이제 이 헬퍼가 필요 없다**(결정 32, 2026-08-01) — 머리 줄로 올라가 접힌
   채로도 DOM 에 있고 조작된다. 그 계약을 재는 자리는 `narrow-body.spec.ts`(펴기 전에 44 를
   잰다)와 `schedule-editor.rest-lock.test.tsx`(펴지 않고 휴방을 켠다)다. 여기 앞세워도
   틀리지는 않지만, **접힌 채 조작된다는 사실을 스펙이 안 재게 되므로** 새로 쓰는 스펙에서
   시각·휴방 앞에 이 헬퍼를 두지 않는다.

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
