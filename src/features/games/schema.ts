/* 쓰기 입력의 Zod 계약(ADR-0004·불변식 2). 클라이언트는 신뢰하지 않는다 — 모든 쓰기가 이
   경계를 통과한 뒤 인가·저장으로 간다. 컴포저 폼도 이 스키마를 재사용할 수 있다. */

import { z } from "zod";
import { STATUS_KEYS } from "@/core/games";

/* 추가 입력 = 치지직 category 스냅샷 4필드 + 우리 도메인(status·날짜). categoryType 은
   GAME 리터럴로 못박아 보드 불변식을 입력 경계에서 강제한다(DB CHECK 와 이중). poster·
   날짜는 nullable, status 는 기본 'played'. 날짜는 epoch ms(과거 가능)라 int.

   이 스키마가 category 4필드 정규화(trim·empty→null·GAME 필터·상한)의 유일한 정본이다.
   예전엔 core/games.ts::toGameSnapshot 이 같은 정규화를 별도로 했지만 프로덕션 호출자가
   없었다(실 트래픽은 전부 여기를 지난다) — 삭제했다. features/chzzk/client.ts::toCategory
   는 다른 경계다: 치지직 검색 응답(신뢰 안 되는 외부 JSON)을 타입으로 좁히는 파싱이고,
   저장 시 정규화는 여전히 여기서만 한다. */
export const addGameInput = z.object({
  // trim 후 non-empty — 공백만·패딩 값(' abc ')이 빈 카드로 저장되거나 'abc'/' abc ' 로
  // category_id UNIQUE 를 우회하는 걸 입력 경계에서 막는다.
  // .max(64) — 치지직 categoryId 실측(짧은 숫자·슬러그)보다 훨씬 넉넉한 여유 상한. list 가
  // 공개·무페이지네이션이라 상한 없이는 초대형 행으로 응답 크기를 부풀릴 수 있다.
  categoryId: z.string().trim().min(1).max(64),
  categoryType: z.literal("GAME"),
  // .max(200) — 치지직 categoryValue(게임 제목) 실측 대비 여유. 이유는 categoryId 와 동일.
  categoryValue: z.string().trim().min(1).max(200),
  // 빈 문자열은 저장 전에 null 로 접는다(preprocess) — "포스터 없음"의 유일한 표현은 null
  // 이어야 카드 렌더의 이니셜 폴백 분기(poster 유무)가 하나로 맞는다. .max(2048) 은 URL
  // 길이 상한, https 스킴 강제는 별개 이유: game-board 가 이 값을 그대로 <img src> 로
  // 렌더하므로 javascript:/data: 등 비-http(s) 스킴이 들어오면 XSS 로 이어진다.
  posterImageUrl: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .regex(/^https:\/\//, "https URL 이어야 해요")
      .nullable()
      .default(null),
  ),
  status: z.enum(STATUS_KEYS).default("played"),
  playedAt: z.number().int().nullable().default(null),
  clearedAt: z.number().int().nullable().default(null),
});
export type AddGameInput = z.infer<typeof addGameInput>;

// 삭제 입력 = surrogate 정수 PK.
export const removeGameInput = z.object({ id: z.number().int().positive() });
export type RemoveGameInput = z.infer<typeof removeGameInput>;
