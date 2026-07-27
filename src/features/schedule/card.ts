/* 주간표를 "7일 카드" 모양으로 접는 순수 변환(이슈 #56 작업순서 7). PNG 라우트
   (`src/app/api/og/schedule/route.tsx`)의 유일한 소비자지만, Satori JSX·폰트 페치와 갈라 여기
   둔 이유는 테스트다 — 렌더는 workerd 밖에서 눈으로 확인할 수밖에 없어도(스파이크 때부터
   그랬다), "그 주가 어떤 모양으로 접히는가"는 DB·HTTP 없이 단위 테스트로 못박을 수 있다.

   `core` 가 아니라 `features/schedule` 에 두는 이유: `WeekView`(features/schedule/service)를
   입력으로 받는데, core 는 db 계층 타입을 몰라야 한다(레이어 경계). */

import { formatMD, WEEKDAY_LABELS, weekDates, type IsoDate } from "@/core/calendar";
import type { WeekView } from "./service";

/* 한 칸에 다 못 그리는 날의 상한. 실사용은 하루 1~2건(결정 8 의 예 — "오후 저챗 + 밤 게임")
   이지만 입력 상한(saveWeekInput 의 entries.max(60))은 이보다 훨씬 크다 — 몰아 넣힌 항목이
   카드를 찢거나 옆 칸을 밀면 안 되므로 넘는 만큼은 세어서만 보여준다("+N개"). 4 는 스파이크
   레이아웃(카드 높이 630, 날짜 칸 8개 폭)에서 시각 배지 없는 제목 두 줄까지 버티는 수를 어림한
   값이라 렌더를 눈으로 보며 조정한다(픽셀로 유도하지 않는다 — 폰트 메트릭이 Satori 실측에만
   있다). */
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

export type WeekCard = {
  rangeLabel: string;
  note: string | null;
  days: WeekCardDay[];
};

/* week.entries 는 이미 getWeekForEdit 의 SQL 정렬(날짜 오름차순 · 하루 안 시각 있는 항목 먼저 ·
   id 순)을 탄 채로 온다 — 여기서 다시 정렬하지 않고 날짜로만 가른다. */
export function buildWeekCard(weekStartDate: IsoDate, week: WeekView): WeekCard {
  const days = weekDates(weekStartDate);
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
