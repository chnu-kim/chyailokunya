/* 쓰기 입력의 Zod 계약(ADR-0004·불변식 2). 클라이언트는 신뢰하지 않는다 — 모든 쓰기가 이
   경계를 통과한 뒤 인가·저장으로 간다. 컴포저 폼도 이 스키마를 재사용할 수 있다. */

import { z } from "zod";
import { STATUS_KEYS } from "@/core/games";

/* 추가 입력 = 치지직 category 스냅샷 4필드 + 우리 도메인(status·날짜). categoryType 은
   GAME 리터럴로 못박아 보드 불변식을 입력 경계에서 강제한다(DB CHECK 와 이중). poster·
   날짜는 nullable, status 는 기본 'played'. 날짜는 epoch ms(과거 가능)라 int. */
export const addGameInput = z.object({
  // trim 후 non-empty — 공백만·패딩 값(' abc ')이 빈 카드로 저장되거나 'abc'/' abc ' 로
  // category_id UNIQUE 를 우회하는 걸 입력 경계에서 막는다(core toGameSnapshot 와 같은 정규화).
  categoryId: z.string().trim().min(1),
  categoryType: z.literal("GAME"),
  categoryValue: z.string().trim().min(1),
  posterImageUrl: z.string().trim().min(1).nullable().default(null),
  status: z.enum(STATUS_KEYS).default("played"),
  playedAt: z.number().int().nullable().default(null),
  clearedAt: z.number().int().nullable().default(null),
});
export type AddGameInput = z.infer<typeof addGameInput>;

// 삭제 입력 = surrogate 정수 PK.
export const removeGameInput = z.object({ id: z.number().int().positive() });
export type RemoveGameInput = z.infer<typeof removeGameInput>;
