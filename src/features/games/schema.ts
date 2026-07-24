/* 쓰기 입력의 Zod 계약(ADR-0004·불변식 2). 클라이언트는 신뢰하지 않는다 — 모든 쓰기가 이
   경계를 통과한 뒤 인가·저장으로 간다. 컴포저 폼도 이 스키마를 재사용할 수 있다. */

import { z } from "zod";
import { isIsoDate } from "@/core/calendar";
import { isClearedStateValid } from "@/core/games";

/* 날짜 입력 = 'YYYY-MM-DD' 이면서 **실재하는** 날짜. 형식만 보면 2026-02-31 이 통과해
   저장된 뒤 표시 경계에서야 굴러간다(3/3) — 실재 검증까지 core 가 한다. 빈 문자열은
   null 로 접는다: 폼의 빈 <input type="date"> 가 "" 를 보내는데, "날짜 없음"의 표현이
   ""와 null 두 가지가 되면 표시·검증 분기가 갈린다. posterImageUrl 과 같은 preprocess 패턴.
   미래 날짜는 허용한다 — 발매 예정작을 미리 올릴 수 있다. */
const dateInput = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().refine(isIsoDate, "YYYY-MM-DD 형식의 실재하는 날짜여야 해요").nullable().default(null),
);

/* 추가 입력 = 치지직 category 스냅샷 4필드. 우리 도메인 날짜는 여기 없다 — 플레이 날짜의
   정본은 일정(schedule_entries)이고(이슈 #56 결정 3), 클리어는 추가 뒤 편집으로 붙인다.
   그래서 새 게임은 항상 "안 깬 채, 일정 없음"으로 시작한다(games.cleared 기본 false).
   categoryType 은 GAME 리터럴로 못박아 보드 불변식을 입력 경계에서 강제한다(DB CHECK 와 이중).
   categoryId·poster 는 nullable — categoryId 가 null 인 건 검색에 없어 손으로 넣은 게임이다.

   이 스키마가 category 4필드 정규화(trim·empty→null·GAME 필터·상한)의 유일한 정본이다.
   features/chzzk/client.ts::toCategory 는 다른 경계다: 치지직 검색 응답(신뢰 안 되는 외부
   JSON)을 타입으로 좁히는 파싱이고, 저장 시 정규화는 여전히 여기서만 한다. */
export const addGameInput = z.object({
  /* trim 후 non-empty — 공백만·패딩 값(' abc ')이 빈 카드로 저장되거나 'abc'/' abc ' 로
     category_id UNIQUE 를 우회하는 걸 입력 경계에서 막는다.

     .max(200) — 한때 64였는데 **프로덕션에서 실제로 터졌다.** 치지직 categoryId 는 짧은
     숫자가 아니라 영문 원제를 그대로 옮긴 슬러그다: 「레이튼 미스터리 저니」처럼 원제가 긴
     게임은 64 를 그냥 넘어가 games.add 가 BAD_REQUEST/too_big 으로 죽었다(사용자가 멀쩡한
     게임을 못 올렸다). 제목에서 나오는 값이니 상한도 제목과 같은 자리(200)에 둔다. 상한 자체는
     남긴다: list 가 공개·무페이지네이션이라 위조 클라이언트가 초대형 행으로 응답을 부풀릴 수 있다.

     nullable — 검색에 없어 손으로 넣은 게임엔 치지직 키가 없다. 빈 문자열은 null 로 접는다:
     ''가 그대로 저장되면 두 번째 수동 입력이 UNIQUE 로 충돌한다(NULL 만 중복이 허용된다). */
  categoryId: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().min(1).max(200).nullable().default(null),
    )
    .describe("치지직 categoryId. 수동 입력 게임은 null"),
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
});
export type AddGameInput = z.infer<typeof addGameInput>;

/* 수정 입력 — 클리어 상태만 고친다. 제목·포스터·categoryId 는 치지직 스냅샷(또는 최초 수동
   입력)이라 여기서 못 바꾼다: 스냅샷을 사후 편집할 수 있게 하면 categoryId 와 표시명이 갈라져
   "이 카드가 어느 게임인가"가 흐려진다. 플레이 날짜도 여기 없다 — 일정 정본으로 옮겨갔다.
   cleared·clearedDate 는 둘 다 명시적으로 보낸다(부분 patch 아님) — optional 로 두면
   "안 보냄"과 "지움"이 구분되지 않는다.

   cleared 가 false 인데 clearedDate 가 있으면 거절한다(DB CHECK 의 Zod 짝, core.isClearedStateValid).
   "깼는데 날짜 모름"(cleared=true·date=null)은 통과한다 — 그 표현을 살리는 게 플래그를 날짜와
   독립으로 둔 이유다. */
export const updateGameInput = z
  .object({
    id: z.number().int().positive(),
    cleared: z.boolean(),
    clearedDate: dateInput,
  })
  .refine((v) => isClearedStateValid(v.cleared, v.clearedDate), {
    // path 를 clearedDate 에 준다 — 폼이 어느 입력 아래에 오류를 띄울지 알아야 한다.
    message: "클리어 표시를 해야 클리어한 날짜를 넣을 수 있어요",
    path: ["clearedDate"],
  });
export type UpdateGameInput = z.infer<typeof updateGameInput>;

// 삭제 입력 = surrogate 정수 PK.
export const removeGameInput = z.object({ id: z.number().int().positive() });
export type RemoveGameInput = z.infer<typeof removeGameInput>;
