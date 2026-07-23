/* 달력 계산 — 순수 도메인(HTTP·DB·React 무관). 일정 정본(schedule_entries)이 "달력의 하루"를
   text 'YYYY-MM-DD' 로 들고 있으므로(ADR-0019·AGENTS.md 명명 규약), 주를 가르고 옮기는 계산을
   여기 한 곳에 모은다. 이슈 #56 작업순서 2.

   ── 표면은 전부 문자열이다. Temporal 은 이 파일 안에서만 산다 ──────────────────────
   경계가 전부 문자열이기 때문이다: D1 은 TEXT, Zod 입력도 문자열, 주 지정 쿼리(`?week=`)도,
   Satori 에 넘길 PNG 텍스트도 문자열이다. 표면을 PlainDate 로 두면 그 경계마다 from/toString
   왕복이 생기고, 왕복하는 코드가 늘어날수록 "어디서 존이 끼어들었나"를 다시 사람이 추적하게
   된다. 반대로 문자열 in/out 이면 **Date 로 굴러가던 변환 자리를 이 모듈이 독점**한다 —
   호출자에게 남는 선택지가 없어 오용할 자리 자체가 사라진다. 결정 7 이 노린 "구조적으로 막힘"은
   타입을 노출해서가 아니라 변환을 독점해서 성립한다.

   Temporal 을 굳이 쓰는 이유는 그 독점 구간의 정확도다. Date 는 'YYYY-MM-DD' 를 UTC 로 파싱해
   놓고 getDay()·toISOString() 은 로컬 존으로 답해, 주의 시작을 구하는 것 같은 계산이 실행 머신의
   존에 따라 하루씩 밀린다. PlainDate 엔 존이 아예 없어 그 밀림이 표현 불가능하다.

   ── 클래스 API 를 쓴다(fns 아님) ──────────────────────────────────────────────────
   `temporal-polyfill/fns/*` 서브패스가 트리셰이킹으로 더 작지만(실측 gzip 7.9KB vs 19.4KB),
   PlainDate 만 import 하면 캘린더 레코드가 안 걸려 런타임에 죽는다(실측). 11.5KB 는 Workers
   무료 한도 여유(0.88MiB, 이슈 #56 스파이크 실측)의 1.3% 라 그 함정을 살 값이 아니다.

   ── 지금은 주(week)까지만 있다 ────────────────────────────────────────────────────
   월간 캘린더 격자는 첫 소비자(작업순서 5 의 `/calendar`)와 같이 태어난다. 6주 고정이냐
   가변이냐가 그 페이지 레이아웃에 달려 있어, 지금 만들면 형태를 추측하는 셈이고 그건
   "테스트만 보증하는 API 는 남기지 않는다"는 이 저장소 관례(ADR-0010·core/games.ts)에 어긋난다. */

import { Temporal } from "temporal-polyfill";

/* 달력의 하루. 브랜드를 씌워 아무 문자열이나 흘러들지 못하게 한다 — 이 타입을 만드는 통로는
   isIsoDate/toIsoDate 와 이 파일의 계산 함수뿐이라, 검증을 건너뛴 값이 달력 계산에 들어오려면
   호출자가 캐스팅을 손으로 적어야 한다(즉 리뷰에 보인다). */
export type IsoDate = string & { readonly __isoDate: true };

/* 한국은 DST 가 없어 고정 +9 지만, 오프셋을 상수로 박지 않고 존 ID 를 쓴다 — 오프셋 산술은
   "왜 9인가"가 코드 밖에 남고, 존 ID 는 그 답을 이름으로 들고 다닌다. */
const KST = "Asia/Seoul";

/* Temporal 은 'YYYY-MM-DD' 말고도 '+002026-07-20'·'2026-07-20T00:00' 같은 확장 표기를 받는다.
   DB·URL·Zod 를 오가는 값의 형태를 하나로 못박아야 정렬(사전순 = 시간순)과 비교가 성립하므로
   먼저 형식을 좁힌 뒤 실재 여부를 Temporal 에 묻는다. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* 형식이 맞고 실재하는 날짜인가. 2026-02-31·2026-13-01 처럼 형식만 맞는 값은 걸러낸다 —
   overflow:'reject' 가 없으면 Temporal 도 Date 처럼 조용히 말일로 붙여 버린다. */
export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== "string" || !ISO_DATE_RE.test(v)) return false;
  try {
    Temporal.PlainDate.from(v, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}

/* 검증된 문자열을 IsoDate 로 승격한다. 실패하면 던진다 — 날짜가 아닌 값이 달력 계산까지
   흘러가면 어디서 틀어졌는지 알 수 없는 결과가 나오므로, 경계에서 멈추는 편이 싸다.
   "틀리면 오늘로" 같은 폴백은 두지 않는다: 그 폴백은 버그를 정상 화면으로 위장한다. */
export function toIsoDate(v: string): IsoDate {
  if (!isIsoDate(v)) throw new TypeError(`YYYY-MM-DD 형식의 실재하는 날짜가 아니다: ${v}`);
  return v;
}

/* 지금 KST 로 며칠인가. 서버(Workers·UTC)와 브라우저(사용자 존)가 같은 답을 내야 하므로
   실행 환경의 로컬 존을 절대 쓰지 않는다 — 이 사이트의 "오늘"은 방송을 보는 사람의 하루,
   즉 KST 다. */
export function todayKST(): IsoDate {
  return Temporal.Now.plainDateISO(KST).toString() as IsoDate;
}

/* 그 날짜가 속한 주의 월요일. 주는 저장하지 않고 날짜에서 유도한다(결정 2) — 항목에 week_id 를
   두면 날짜와 어긋난 행이 저장 가능해지기 때문이고, 그 유도를 하는 곳이 여기다.
   ISO 8601 의 dayOfWeek 는 월=1‥일=7 이라 (dayOfWeek - 1)일을 빼면 월요일이 나온다. */
export function weekStartOf(date: IsoDate): IsoDate {
  const d = Temporal.PlainDate.from(date);
  return d.subtract({ days: d.dayOfWeek - 1 }).toString() as IsoDate;
}

/* 그 날짜가 속한 주의 7일(월→일). 인자로 주의 시작을 요구하지 않는다 — 요구하면 호출자가
   weekStartOf 를 먼저 부르는 규칙을 매번 기억해야 하고, 잊으면 화요일부터 7일 같은 조용히
   틀린 주가 나온다. 아무 날짜나 받아 안에서 주를 가른다. */
export function weekDates(date: IsoDate): IsoDate[] {
  const start = Temporal.PlainDate.from(weekStartOf(date));
  return Array.from({ length: 7 }, (_, i) => start.add({ days: i }).toString() as IsoDate);
}

/* 주 이동(음수면 이전 주). 날짜에 7*n 일을 더하는 것과 결과가 같지만 이름이 의도를 말한다 —
   호출자는 "다음 주"를 원하지 "7일 뒤"를 원하는 게 아니다. */
export function addWeeks(date: IsoDate, weeks: number): IsoDate {
  return Temporal.PlainDate.from(date).add({ weeks }).toString() as IsoDate;
}

/* 요일 라벨. weekDates 의 반환 순서와 **같은 사실**이라 같은 파일에 둔다 — 떨어뜨려 두면
   주의 시작을 일요일로 바꾸는 날 한쪽만 고쳐도 게이트가 전부 초록이고, 화면에서 요일과
   날짜가 하루씩 밀린 채로 나간다. */
export const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;
