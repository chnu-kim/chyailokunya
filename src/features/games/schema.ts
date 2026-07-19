/* 쓰기 입력의 Zod 계약(ADR-0004·불변식 2). 클라이언트는 신뢰하지 않는다 — 모든 쓰기가 이
   경계를 통과한 뒤 인가·저장으로 간다. 컴포저 폼도 이 스키마를 재사용할 수 있다. */

import { z } from "zod";
import { isDateOrderValid, isDateString } from "@/core/games";

/* 날짜 입력 = 'YYYY-MM-DD' 이면서 **실재하는** 날짜. 형식만 보면 2026-02-31 이 통과해
   저장된 뒤 표시 경계에서야 굴러간다(3/3) — 실재 검증까지 core 가 한다. 빈 문자열은
   null 로 접는다: 폼의 빈 <input type="date"> 가 "" 를 보내는데, "날짜 없음"의 표현이
   ""와 null 두 가지가 되면 정렬(null 은 뒤로)·표시 분기가 갈린다. posterImageUrl 과
   같은 preprocess 패턴이다. 미래 날짜는 허용한다 — 발매 예정작을 미리 올릴 수 있다. */
const dateInput = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .refine(isDateString, "YYYY-MM-DD 형식의 실재하는 날짜여야 해요")
    .nullable()
    .default(null),
);

// 두 날짜의 순서는 필드 하나로는 볼 수 없다 — 객체 레벨 refine 이 제자리다.
const withDateOrder = <T extends z.ZodType<{ playedAt: string | null; clearedAt: string | null }>>(
  schema: T,
) =>
  schema.refine(
    (v) => isDateOrderValid(v.playedAt, v.clearedAt),
    // path 를 clearedAt 에 준다 — 폼이 어느 입력 아래에 오류를 띄울지 알아야 한다.
    { message: "클리어 날짜는 플레이 날짜보다 빠를 수 없어요", path: ["clearedAt"] },
  );

/* 추가 입력 = 치지직 category 스냅샷 4필드 + 우리 도메인 날짜 둘. categoryType 은 GAME
   리터럴로 못박아 보드 불변식을 입력 경계에서 강제한다(DB CHECK 와 이중). categoryId·
   poster·날짜는 nullable이다 — categoryId 가 null 인 건 검색에 없어 손으로 넣은 게임이다.
   날짜는 epoch 정수가 아니라 text 'YYYY-MM-DD' 다(core/games.ts 의 근거: epoch 로 두면
   저장·표시 양쪽에서 타임존이 개입해 KST 자정 근처의 하루가 밀린다). status 컬럼은
   드롭됐으니 여기에도 없다 — "클리어했나"는 clearedAt 유무로 유도한다.

   이 스키마가 category 4필드 정규화(trim·empty→null·GAME 필터·상한)의 유일한 정본이다.
   예전엔 core/games.ts::toGameSnapshot 이 같은 정규화를 별도로 했지만 프로덕션 호출자가
   없었다(실 트래픽은 전부 여기를 지난다) — 삭제했다. features/chzzk/client.ts::toCategory
   는 다른 경계다: 치지직 검색 응답(신뢰 안 되는 외부 JSON)을 타입으로 좁히는 파싱이고,
   저장 시 정규화는 여전히 여기서만 한다. */
export const addGameInput = withDateOrder(
  z.object({
    /* trim 후 non-empty — 공백만·패딩 값(' abc ')이 빈 카드로 저장되거나 'abc'/' abc ' 로
       category_id UNIQUE 를 우회하는 걸 입력 경계에서 막는다.

       .max(200) — 한때 64였는데 **프로덕션에서 실제로 터졌다.** 치지직 categoryId 는 짧은
       숫자가 아니라 영문 원제를 그대로 옮긴 슬러그다: 운영에 있던 레이튼 HD 두 편이 42·43자라
       "64면 넉넉하다"고 봤지만, 「레이튼 미스터리 저니」처럼 원제가 긴 게임은 그냥 넘어간다
       (games.add 가 BAD_REQUEST/too_big 으로 죽었다 — 사용자는 멀쩡한 게임을 못 올렸다).
       제목에서 나오는 값이니 상한도 제목과 같은 자리에 둔다 — 아래 categoryValue 와 같은 200.
       상한 자체는 남긴다: list 가 공개·무페이지네이션이라 위조 클라이언트가 초대형 행으로
       응답 크기를 부풀릴 수 있다.

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
    // 수동 입력 게임은 사용자가 친 제목이 그대로 여기 온다.
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
    playedAt: dateInput,
    clearedAt: dateInput,
  }),
);
export type AddGameInput = z.infer<typeof addGameInput>;

/* 수정 입력 — 날짜만 고친다. 제목·포스터·categoryId 는 치지직 스냅샷(또는 최초 수동 입력)
   이라 여기서 못 바꾼다: 스냅샷을 사후 편집할 수 있게 하면 categoryId 와 표시명이 갈라져
   "이 카드가 어느 게임인가"가 흐려진다. 날짜는 둘 다 명시적으로 보낸다(부분 patch 아님) —
   optional 로 두면 "안 보냄"과 "null 로 지움"이 구분되지 않는다. */
export const updateGameInput = withDateOrder(
  z.object({
    id: z.number().int().positive(),
    playedAt: dateInput,
    clearedAt: dateInput,
  }),
);
export type UpdateGameInput = z.infer<typeof updateGameInput>;

// 삭제 입력 = surrogate 정수 PK.
export const removeGameInput = z.object({ id: z.number().int().positive() });
export type RemoveGameInput = z.infer<typeof removeGameInput>;
