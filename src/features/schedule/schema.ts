/* 일정 쓰기 입력의 Zod 계약(ADR-0004·불변식 2, 이슈 #56 결정 12·14). 클라이언트는 신뢰하지
   않는다 — 모든 쓰기가 이 경계를 통과한 뒤 인가·저장으로 간다.

   쓰기는 **주 단위 일괄 저장 하나**다(결정 14): 한 주의 원하는 상태(항목 전체 + 메타)를 통째로
   보내면 서버가 그 주를 전체 교체한다 — 항목별 add/update/delete 를 클라이언트가 추적하지 않는다.

   전체 교체라 **경합의 피해 반경이 크다**(먼저 저장한 사람의 항목이 통째로 지워진다). 그래서
   "마지막 저장이 이긴다"로 두지 않고 낙관적 동시성을 건다 — 불러온 시점의 revision 을 함께
   받아 어긋나면 CONFLICT 로 거절한다(service.saveWeek·아래 revision 필드). */

import { z } from "zod";
import { isIsoDate, toIsoDate, weekStartOf } from "@/core/calendar";

// 'YYYY-MM-DD' 이면서 실재하는 날짜(core/calendar 가 정본 — Temporal 판정이라 확장 표기를 거절).
const isoDate = z.string().refine(isIsoDate, "YYYY-MM-DD 형식의 실재하는 날짜여야 합니다");

/* 하루 중 시각 'HH:MM'(KST 라벨, 24시간). 빈 문자열은 null 로 접는다 — "시각 미정"의 표현이
   ""와 null 둘이 되면 정렬·표시 분기가 갈린다(games 날짜 입력과 같은 패턴). 시각은 선택이다
   (미정 편성 허용 — 몇 시인지 아직 안 정한 정상 상태다). */
const startTime = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM (24시간) 형식이어야 합니다")
    .nullable()
    .default(null),
);

/* 그 주에 걸어 둘 팬아트 주소(이슈 #117). **https 만 받는다** — 외부 주소를 그대로 <img src>
   에 넣는 자리라 스킴을 좁혀 둔다(`javascript:` 는 img 에서 실행되진 않지만, 받아 둘 이유가
   없는 값을 저장까지 하고 나면 다음에 그 값을 다른 자리에 쓰는 코드가 생겼을 때 방어가 하나도
   없다). http 도 막는다: 사이트가 https 라 혼합 콘텐츠로 어차피 안 뜬다.

   빈 문자열은 null 로 접는다(note·startTime 과 같은 정규화) — "" 와 null 이 둘 다 "없음"을
   뜻하면 표시 분기가 갈린다. 길이 상한 2048 은 흔한 URL 상한이고, 위조 클라이언트가 거대한
   문자열을 주 메타에 밀어 넣는 걸 막는다. */
const fanartImageUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .trim()
    .max(2048)
    .refine((v) => {
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    }, "https:// 로 시작하는 주소여야 합니다")
    .nullable()
    .default(null),
);

/* 항목 하나. title 은 자유 제목(항목 종류 컬럼을 안 둔다 — 결정 9). gameId 는 게임에 이어
   붙이는 선택 연결(null = 게임 없는 자유 편성). scheduledDate 가 주에 속하는지는 아래 객체
   레벨 refine 이 본다(항목 단위론 주를 모른다). max(200) 은 게임 제목 상한과 같은 자리.

   **시각은 여기 없다 — 하루의 속성이다**(이슈 #117, 결정 8 을 뒤집었다). 아래 dayInput 참조. */
const entryInput = z.object({
  scheduledDate: isoDate,
  title: z.string().trim().min(1).max(200),
  gameId: z.number().int().positive().nullable().default(null),
});

/* 하루의 속성 — 방송 시작 시각과 휴방(이슈 #117). 클라이언트는 7일을 다 보내도 되고 일부만
   보내도 된다: 서버가 **기본값인 날(시각 없음 · 휴방 아님)은 행으로 안 만든다**(saveWeek).
   그래야 "행이 없는 것 = 기본값"이라는 스키마 불변이 유지된다(db/schema.ts). */
const dayInput = z.object({
  scheduledDate: isoDate,
  startTime,
  rest: z.boolean().default(false),
});

/* 주 단위 일괄 저장. weekStartDate 는 그 주의 월요일이어야 하고(주는 날짜에서 유도하므로
   임의의 날을 주 키로 받으면 항목과 어긋난다 — 결정 2), 모든 항목은 그 주 7일 안에 들어야 한다.
   note 는 공지 한 줄(선택), published 는 발행 여부(결정 13 — 미발행은 og 카드로 안 나간다).
   entries 상한(60)은 위조 클라이언트가 초대형 배치로 배치 실행을 부풀리는 걸 막는다(한 주 실사용
   은 7~20). */
export const saveWeekInput = z
  .object({
    weekStartDate: isoDate,
    /* 불러온 시점의 주 revision(= 메타의 last_updated_at, 메타가 없었으면 null). **선택이 아니라
       필수다** — 생략을 허용하면 "검사 없이 덮어쓰기"가 조용한 기본값이 되고, 그건 전체 교체에서
       남의 한 주를 통째로 지우는 경로다(service.saveWeek 의 낙관적 동시성 주석). 새 주를 처음
       저장하는 정당한 경우는 null 로 명시한다. */
    revision: z.number().int().nullable(),
    note: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(500).nullable().default(null),
    ),
    published: z.boolean().default(false),
    entries: z.array(entryInput).max(60),
    /* 하루 속성. 한 주는 7일이라 상한이 7 이고, 같은 날이 두 번 오면 어느 쪽이 이길지가
       입력 순서에 달리므로 아래 refine 이 중복을 거절한다(UNIQUE 제약이 최종 방어선이지만
       거기까지 가면 저장이 통째로 실패한다 — 경계에서 먼저 거른다). */
    days: z.array(dayInput).max(7).default([]),
    fanartImageUrl,
    /* 작가 표기. 이름만 받는다(링크가 아니다 — db/schema.ts 주석). 그림 없이 표기만 오는
       조합은 아래 refine 이 막는다(DB CHECK 와 같은 규칙, 경계에서 먼저 거른다). */
    fanartCredit: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(100).nullable().default(null),
    ),
  })
  .superRefine((v, ctx) => {
    // weekStartDate 가 월요일인가 — weekStartOf 가 자기 자신이면 그 주의 시작이다.
    if (isIsoDate(v.weekStartDate) && weekStartOf(toIsoDate(v.weekStartDate)) !== v.weekStartDate) {
      ctx.addIssue({
        code: "custom",
        path: ["weekStartDate"],
        message: "주의 시작(월요일)이어야 합니다",
      });
    }
    // 각 항목이 그 주에 속하는가 — 안 그러면 캘린더·주간표의 "이 주" 뷰와 저장이 어긋난다.
    v.entries.forEach((e, i) => {
      if (
        isIsoDate(e.scheduledDate) &&
        weekStartOf(toIsoDate(e.scheduledDate)) !== v.weekStartDate
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", i, "scheduledDate"],
          message: "그 주에 속한 날짜여야 합니다",
        });
      }
    });
    // 하루 속성도 같은 두 규칙을 받는다 — 그 주에 속할 것, 그리고 날짜가 겹치지 않을 것.
    const seen = new Set<string>();
    v.days.forEach((d, i) => {
      if (
        isIsoDate(d.scheduledDate) &&
        weekStartOf(toIsoDate(d.scheduledDate)) !== v.weekStartDate
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["days", i, "scheduledDate"],
          message: "그 주에 속한 날짜여야 합니다",
        });
      }
      if (seen.has(d.scheduledDate)) {
        ctx.addIssue({
          code: "custom",
          path: ["days", i, "scheduledDate"],
          message: "같은 날짜가 두 번 올 수 없습니다",
        });
      }
      seen.add(d.scheduledDate);
    });
    /* 작가 표기만 있고 그림이 없으면 화면에 아무것도 안 뜨는데 값만 남는다(DB CHECK 와 같은
       규칙 — 제약이 최종 방어선이지만 거기까지 가면 저장이 통째로 실패한다). */
    if (v.fanartCredit !== null && v.fanartImageUrl === null) {
      ctx.addIssue({
        code: "custom",
        path: ["fanartCredit"],
        message: "그림 주소 없이 작가 표기만 넣을 수 없습니다",
      });
    }
  });
export type SaveWeekInput = z.infer<typeof saveWeekInput>;

// 편집 화면이 한 주를 불러올 때. 월요일 검증은 저장과 같은 근거로 건다.
export const getWeekInput = z
  .object({ weekStartDate: isoDate })
  .refine(
    (v) =>
      !isIsoDate(v.weekStartDate) || weekStartOf(toIsoDate(v.weekStartDate)) === v.weekStartDate,
    {
      message: "주의 시작(월요일)이어야 합니다",
      path: ["weekStartDate"],
    },
  );
export type GetWeekInput = z.infer<typeof getWeekInput>;

/* 발행·비공개 전환 전용(이슈 #56 결정 14 개정, ADR-0024 2026-07-28 추가) — entries·note 는 안
   건드린다. saveWeek 이 저장할 때마다 schedule_weeks 행을 청구(claim)해 두므로, 편집기가 이
   뮤테이션을 부를 수 있는 시점(dirty 가 아니고 항목이 있는 주)엔 그 행이 항상 있다 — 그래서
   revision 은 saveWeekInput 과 달리 null 을 안 받는다(처음 저장하는 주는 발행 버튼 자체가
   비활성이라 이 경로를 안 탄다). */
export const publishWeekInput = z
  .object({
    weekStartDate: isoDate,
    revision: z.number().int(),
    published: z.boolean(),
  })
  .refine(
    (v) =>
      !isIsoDate(v.weekStartDate) || weekStartOf(toIsoDate(v.weekStartDate)) === v.weekStartDate,
    {
      message: "주의 시작(월요일)이어야 합니다",
      path: ["weekStartDate"],
    },
  );
export type PublishWeekInput = z.infer<typeof publishWeekInput>;
