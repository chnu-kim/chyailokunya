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
const isoDate = z.string().refine(isIsoDate, "YYYY-MM-DD 형식의 실재하는 날짜여야 해요");

/* 하루 중 시각 'HH:MM'(KST 라벨, 24시간). 빈 문자열은 null 로 접는다 — "시각 미정"의 표현이
   ""와 null 둘이 되면 정렬·표시 분기가 갈린다(games 날짜 입력과 같은 패턴). 시각은 선택이다
   (결정 8: 시각 미정 편성 허용). */
const startTime = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM (24시간) 형식이어야 해요")
    .nullable()
    .default(null),
);

/* 항목 하나. title 은 자유 제목(항목 종류 컬럼을 안 둔다 — 결정 9). gameId 는 게임에 이어
   붙이는 선택 연결(null = 게임 없는 자유 편성). scheduledDate 가 주에 속하는지는 아래 객체
   레벨 refine 이 본다(항목 단위론 주를 모른다). max(200) 은 게임 제목 상한과 같은 자리. */
const entryInput = z.object({
  scheduledDate: isoDate,
  startTime,
  title: z.string().trim().min(1).max(200),
  gameId: z.number().int().positive().nullable().default(null),
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
  })
  .superRefine((v, ctx) => {
    // weekStartDate 가 월요일인가 — weekStartOf 가 자기 자신이면 그 주의 시작이다.
    if (isIsoDate(v.weekStartDate) && weekStartOf(toIsoDate(v.weekStartDate)) !== v.weekStartDate) {
      ctx.addIssue({
        code: "custom",
        path: ["weekStartDate"],
        message: "주의 시작(월요일)이어야 해요",
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
          message: "그 주에 속한 날짜여야 해요",
        });
      }
    });
  });
export type SaveWeekInput = z.infer<typeof saveWeekInput>;

// 편집 화면이 한 주를 불러올 때. 월요일 검증은 저장과 같은 근거로 건다.
export const getWeekInput = z
  .object({ weekStartDate: isoDate })
  .refine(
    (v) =>
      !isIsoDate(v.weekStartDate) || weekStartOf(toIsoDate(v.weekStartDate)) === v.weekStartDate,
    {
      message: "주의 시작(월요일)이어야 해요",
      path: ["weekStartDate"],
    },
  );
export type GetWeekInput = z.infer<typeof getWeekInput>;
