/* 주간표를 "7일 카드" 모양으로 접는 순수 변환(이슈 #109 작업순서 2). week-card.tsx(프레젠테이션,
   작업순서 1)의 유일한 소비자지만, DOM·캡처 로직과 갈라 여기 두는 이유는 테스트다 — "그 주가
   어떤 모양으로 접히는가"는 DOM·브라우저 없이 단위 테스트로 못박을 수 있다.

   `core` 가 아니라 `features/schedule` 에 두는 이유: `WeekView`(features/schedule/service)를
   입력으로 받는데, core 는 db 계층 타입을 몰라야 한다(레이어 경계). */

import { formatMD, toIsoDate, WEEKDAY_LABELS, weekDates } from "@/core/calendar";
import type { WeekView } from "./service";

/* 한 칸에 다 못 그리는 날의 상한. 실사용은 하루 1~2건(결정 8 의 예 — "오후 저챗 + 밤 게임")
   이지만 입력 상한(saveWeekInput 의 entries.max(60))은 이보다 훨씬 크다 — 몰아 넣힌 항목이
   카드를 찢거나 옆 칸을 밀면 안 되므로 넘는 만큼은 세어서만 보여준다("+N개"). 4 는 카드
   레이아웃(1200×630, 날짜 칸 8개 폭)에서 시각 배지 없는 제목 두 줄까지 버티는 수를 어림한
   값이라 렌더를 눈으로 보며 조정한다(픽셀로 유도하지 않는다) — 옛 Satori 카드의 실측을 그대로
   물려받았고, week-card.tsx 가 같은 1200×630·날짜 칸 폭을 그대로 이식했으니(작업순서 1) 값도
   같이 물려받는다. 이 DOM 렌더에서 다시 눈으로 확인해 바뀔 수 있다. */
const MAX_ENTRIES_PER_DAY = 4;

export type WeekCardEntry = { time: string | null; title: string };

export type WeekCardDay = {
  dow: string;
  date: string;
  entries: WeekCardEntry[];
  /* 위 상한을 넘겨 안 그린 항목 수. 0 이면 칩을 안 그린다 — "+0개"는 있으나 마나가 아니라
     없는 게 맞다(빈 상태를 굳이 표기하지 않는 관례, schedule-read 의 "—"와 다른 결). */
  overflow: number;
};

export type WeekCardData = {
  rangeLabel: string;
  note: string | null;
  days: WeekCardDay[];
};

/* week.entries 는 이미 getWeekForEdit 의 SQL 정렬(날짜 오름차순 · 하루 안 시각 있는 항목 먼저 ·
   id 순)을 탄 채로 온다 — 여기서 다시 정렬하지 않고 날짜로만 가른다. weekStartDate 를 별도
   인자로 받지 않는 이유: WeekView.weekStartDate 가 이미 그 주를 유일하게 정하므로(getWeekForEdit
   이 그대로 되돌려 준다), 같은 값을 두 자리에 실어 어긋날 여지를 만들지 않는다.

   week.weekStartDate 는 getWeekForEdit 이 호출자 인자를 검증 없이 그대로 echo 한 값이라 월요일이
   아닐 수도 있다 — 그래도 안전한 이유는 weekDates 자체가 내부에서 weekStartOf 를 한 번 더 태워
   무슨 요일을 넣든 그 주의 월요일부터 7일을 돌려주기 때문이다(calendar.ts 주석). 그래서 entries
   를 가른 질의(getWeekForEdit 의 weekBounds)와 여기의 days 가 같은 정규화를 거쳐 항상 같은
   7일을 가리킨다. */
export function buildWeekCard(week: WeekView): WeekCardData {
  const days = weekDates(toIsoDate(week.weekStartDate));
  return {
    rangeLabel: `${formatMD(days[0]!)} – ${formatMD(days[6]!)}`,
    note: week.note,
    days: days.map((date, i) => {
      const dayEntries = week.entries.filter((e) => e.scheduledDate === date);
      return {
        dow: WEEKDAY_LABELS[i]!,
        date: formatMD(date),
        entries: dayEntries
          .slice(0, MAX_ENTRIES_PER_DAY)
          .map((e) => ({ time: e.startTime, title: e.title })),
        overflow: Math.max(0, dayEntries.length - MAX_ENTRIES_PER_DAY),
      };
    }),
  };
}
