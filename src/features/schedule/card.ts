/* 주간표를 "7일 카드" 모양으로 접는 순수 변환(이슈 #109 작업순서 2). week-card.tsx(프레젠테이션,
   작업순서 1)의 유일한 소비자지만, DOM·캡처 로직과 갈라 여기 두는 이유는 테스트다 — "그 주가
   어떤 모양으로 접히는가"는 DOM·브라우저 없이 단위 테스트로 못박을 수 있다.

   `core` 가 아니라 `features/schedule` 에 두는 이유: `WeekView`(features/schedule/service)를
   입력으로 받는데, core 는 db 계층 타입을 몰라야 한다(레이어 경계). */

import { formatMD, toIsoDate, WEEKDAY_LABELS, weekDates } from "@/core/calendar";

/* WeekView 전체가 아니라 카드가 실제로 쓰는 부분집합만 받는다(작업순서 3). 편집기(schedule-editor.tsx)
   가 다운로드 미리보기를 만들 때 서버 왕복 없이 **저장된 상태**(schedule-save 머신의 baseline,
   core 소유 WeekDraft)로도 이 함수를 불러야 하는데, WeekDraft.entries 는 core 타입(DraftEntry —
   scheduledDate·startTime·title 에 key·gameId 가 더 있다)이다. 이 함수를 WeekView 로 못박으면
   호출자가 그 타입 하나만 만들 수 있어, 편집기가 매번 가짜 WeekView 를 조립해야 한다 — 대신
   실제로 쓰는 필드만 담은 구조적 타입을 두면 WeekView 도 WeekDraft(+weekStartDate)도 별다른
   변환 없이 그대로 만족한다(TypeScript 구조적 타이핑, 여분 필드는 무시된다). */
export type WeekCardSource = {
  weekStartDate: string;
  note: string | null;
  entries: { scheduledDate: string; title: string }[];
  /* 하루의 속성(이슈 #117). 기본값인 날은 안 실려 오므로 날짜로 찾아 없으면 기본값으로 그린다 —
     "행이 없는 것 = 시각 미정 · 휴방 아님"(db/schema.ts). 여기서도 부분집합 구조 타입이라
     WeekView.days(ScheduleDay[])도 WeekDraft 쪽 조립본도 그대로 만족한다. */
  days: { scheduledDate: string; startTime: string | null; rest: boolean }[];
  /* 그 주에 걸어 둔 팬아트(ADR-0028). **치수 컬럼은 안 받는다** — 카드 안 그림은 CSS 로 크기가
     고정된 자리에 `object-fit: contain` 으로 앉으므로(schedule.css) 비율을 속성으로 줄 이유가
     없고, 캡처는 동기라 CLS 도 없다. 덤으로 반쪽 조합(한쪽만 있는 치수) 분기가 안 늘어난다.
     표기는 두 호출자가 기준이 다르다 — WeekView 는 `null`, WeekDraft 는 `""` 다. */
  fanartImageKey: string | null;
  fanartCredit: string | null;
};

/* 한 칸에 다 못 그리는 날의 상한. 실사용은 하루 1~2건(결정 8 의 예 — "오후 저챗 + 밤 게임")
   이지만 입력 상한(saveWeekInput 의 entries.max(60))은 이보다 훨씬 크다 — 몰아 넣힌 항목이
   카드를 찢거나 옆 칸을 밀면 안 되므로 넘는 만큼은 세어서만 보여준다("+N개"). 4 는 카드
   레이아웃(1200×630, 날짜 칸 8개 폭)에서 시각 배지 없는 제목 두 줄까지 버티는 수를 어림한
   값이라 렌더를 눈으로 보며 조정한다(픽셀로 유도하지 않는다) — 옛 Satori 카드의 실측을 그대로
   물려받았고, week-card.tsx 가 같은 1200×630·날짜 칸 폭을 그대로 이식했으니(작업순서 1) 값도
   같이 물려받는다. 이 DOM 렌더에서 다시 눈으로 확인해 바뀔 수 있다. */
const MAX_ENTRIES_PER_DAY = 4;

export type WeekCardEntry = { title: string };

export type WeekCardDay = {
  dow: string;
  date: string;
  /* 그날 방송 시작 시각(없으면 미정). 항목이 아니라 **하루**에 달린다(이슈 #117) — 카드도 요일
     옆에 한 번만 그린다. */
  time: string | null;
  /* 쉬기로 정한 날. "아직 미정"(항목 0 · rest false)과 다른 사실이라 카드가 달리 그린다 —
     빈 칸은 "아직 안 정함", 휴방은 "안 합니다"다. */
  rest: boolean;
  entries: WeekCardEntry[];
  /* 위 상한을 넘겨 안 그린 항목 수. 0 이면 칩을 안 그린다 — "+0개"는 있으나 마나가 아니라
     없는 게 맞다(빈 상태를 굳이 표기하지 않는 관례, schedule-read 의 "—"와 다른 결). */
  overflow: number;
};

/* 카드가 그릴 팬아트. 키가 없으면 이 값 자체가 null 이고, 카드는 팬아트 없는 모양(7열 격자)으로
   그린다 — 빈 사진지 자리를 남기지 않는다(이슈 #122 결정).

   **`WeekCardData` 안에 있어야 한다.** 캡처 캐시가 `${weekStartDate}:${JSON.stringify(card)}` 를
   키로 쓰므로(week-card-download.tsx 의 captureKey), 팬아트를 카드 밖 별도 prop 으로 넘기면
   **그림만 바꾼 뒤 다시 받을 때 옛 캡처가 그대로 나온다.** 카드 안에 담으면 무효화가 공짜다. */
export type WeekCardFanart = {
  /* R2 객체 키 한 조각. 화면이 `/api/fanart/${key}` 로 조립한다(ADR-0028 — 컬럼엔 URL 이 없다). */
  imageKey: string;
  credit: string | null;
};

export type WeekCardData = {
  rangeLabel: string;
  note: string | null;
  days: WeekCardDay[];
  fanart: WeekCardFanart | null;
};

/* source.entries 는 이미 정렬된 채로 온다고 가정한다 — 서버 호출자(WeekView)는 getWeekForEdit 의
   SQL 정렬(날짜 오름차순 · 하루 안 시각 있는 항목 먼저 · id 순)을, 클라이언트 호출자(WeekDraft)는
   entriesForDate 와 같은 규칙을 이미 태운 baseline 을 준다 — 여기서 다시 정렬하지 않고 날짜로만
   가른다. weekStartDate 를 별도 인자로 받지 않는 이유: source.weekStartDate 가 이미 그 주를
   유일하게 정하므로, 같은 값을 두 자리에 실어 어긋날 여지를 만들지 않는다.

   source.weekStartDate 는 호출자 인자를 검증 없이 그대로 echo 한 값이라 월요일이 아닐 수도
   있다 — 그래도 안전한 이유는 weekDates 자체가 내부에서 weekStartOf 를 한 번 더 태워 무슨 요일을
   넣든 그 주의 월요일부터 7일을 돌려주기 때문이다(calendar.ts 주석). 그래서 entries 를 가른 질의
   (서버의 weekBounds)와 여기의 days 가 같은 정규화를 거쳐 항상 같은 7일을 가리킨다. */
export function buildWeekCard(source: WeekCardSource): WeekCardData {
  const days = weekDates(toIsoDate(source.weekStartDate));
  const dayByDate = new Map(source.days.map((d) => [d.scheduledDate, d]));
  return {
    rangeLabel: `${formatMD(days[0]!)} – ${formatMD(days[6]!)}`,
    note: source.note,
    /* 표기는 **여기서 정규화한다** — 읽기 화면(WeekView)은 `null` 을, 편집기(WeekDraft)는 `""` 를
       주므로 그대로 넘기면 편집기 미리보기에만 빈 figcaption 이 생겨 사진지 아래가 벌어진다.
       두 화면이 같은 값을 다른 기준으로 얻는 자리라, 기준을 카드 조립부 한 곳에 둔다. */
    fanart: source.fanartImageKey
      ? { imageKey: source.fanartImageKey, credit: source.fanartCredit?.trim() || null }
      : null,
    days: days.map((date, i) => {
      const day = dayByDate.get(date);
      /* 휴방인 날은 항목을 **안 그린다**(이슈 #117 결정 5 — 표시에서 휴방이 이긴다). 두 테이블
         이라 DB CHECK 로는 공존을 못 막으므로 화면이 규칙을 세운다. 저장은 그대로 두므로 휴방을
         껐다 켜도 항목이 돌아온다 — 지우는 쪽을 택하면 그 실수가 복구 불가가 된다. */
      const dayEntries = day?.rest ? [] : source.entries.filter((e) => e.scheduledDate === date);
      return {
        dow: WEEKDAY_LABELS[i]!,
        date: formatMD(date),
        time: day?.rest ? null : (day?.startTime ?? null),
        rest: day?.rest ?? false,
        entries: dayEntries.slice(0, MAX_ENTRIES_PER_DAY).map((e) => ({ title: e.title })),
        overflow: Math.max(0, dayEntries.length - MAX_ENTRIES_PER_DAY),
      };
    }),
  };
}
