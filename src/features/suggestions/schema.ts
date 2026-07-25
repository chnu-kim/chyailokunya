/* 팬 제안 입력의 Zod 계약(불변식 2 — 클라이언트는 신뢰하지 않는다). 제안은 로그인만 하면
   누구나 쓰는 경로라 이 경계가 특히 값어치를 한다: 관리자 폼과 달리 **적대적 입력이 정상 트래픽에
   섞여 온다**고 봐야 한다.

   날짜 규약은 games/schema.ts 의 dateInput 과 같은 모양을 쓴다(빈 문자열 → null · 실재 검증).
   그쪽에서 import 하지 않고 되풀이하는 건 schedule/schema.ts 가 이미 세운 관례다 — 각 feature 가
   자기 입력 경계를 쥐고, 공유하는 건 판정 함수(core)지 스키마 조각이 아니다. */

import { z } from "zod";
import { isIsoDate } from "@/core/calendar";
import { SUGGESTION_RESOLUTIONS } from "@/core/suggestions";
import { isClearedStateValid } from "@/core/games";

/* 'YYYY-MM-DD' 이면서 실재하는 날짜, 또는 null. 빈 문자열을 null 로 접는 이유는 games 와 같다:
   폼의 빈 <input type="date"> 가 "" 를 보내는데 "날짜 없음"의 표현이 둘이 되면 분기가 갈린다. */
const dateInput = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().refine(isIsoDate, "YYYY-MM-DD 형식의 실재하는 날짜여야 해요").nullable().default(null),
);

/* 한마디(선택). **상한 500 이 이 경계의 핵심이다** — 관리자 제안함이 이 글을 그대로 그리고,
   로그인만 하면 쓸 수 있는 자리라 상한이 없으면 초대형 문자열 하나가 제안함을 통째로 못 쓰게
   만든다. 빈 문자열은 null 로 접는다("없음"의 표현을 하나로). */
const noteInput = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().trim().min(1).max(500).nullable().default(null),
);

/* 제안이 말하는 목표 상태 셋. 늘 함께 실린다 — 부분 patch 가 아니라 스냅샷이라(core/suggestions
   주석) "안 보냄"과 "지움"을 가를 필요가 없다. cleared 만 default 를 두는 건 새 제안을 만드는
   연산이라 지울 이전 상태가 없기 때문이다(addGameInput 의 cleared 와 같은 논리). */
const proposedValues = {
  cleared: z.boolean().default(false),
  clearedDate: dateInput,
  playedDate: dateInput,
  note: noteInput,
};

export const createSuggestionInput = z
  .discriminatedUnion("kind", [
    // 보드에 있는 카드를 고쳐 달라. 대상은 surrogate 정수 PK 로 가리킨다.
    z.object({ kind: z.literal("edit"), gameId: z.number().int().positive(), ...proposedValues }),
    /* 없는 게임을 올려 달라. **치지직 검색을 안 열었으므로 자유 이름이다**(client_credentials 를
       공개 트래픽에 두지 않는다 — features/chzzk/router.ts). 상한 200 은 games.categoryValue 와
       같은 자리에 둔다: 관리자가 반영할 때 이 이름이 그대로 컴포저 검색어가 된다. */
    z.object({
      kind: z.literal("add"),
      title: z.string().trim().min(1).max(200),
      ...proposedValues,
    }),
  ])
  /* 안 깬 게임에 클리어 날짜가 붙는 모순을 입력 경계에서 막는다 — DB CHECK 와 이중이고 판정은
     games 폼과 **같은 core 함수**를 나눠 쓴다. 갈리면 제안으로는 저장되는데 반영하려는 순간
     게임 쪽 경계가 거절하는 조합이 생겨, 관리자가 손쓸 수 없는 제안이 제안함에 남는다. */
  .refine((v) => isClearedStateValid(v.cleared, v.clearedDate), {
    message: "클리어 표시를 해야 클리어한 날짜를 넣을 수 있어요",
    path: ["clearedDate"],
  });
export type CreateSuggestionInput = z.infer<typeof createSuggestionInput>;

/* 처리 입력. resolution 은 'accepted'|'rejected' 뿐이다 — 'pending' 은 처리의 결과가 아니라
   처리 전 상태라 여기 오면 안 되고, 되돌리기(처리 → 미처리)는 v1 에 요구가 없다. */
export const resolveSuggestionInput = z.object({
  id: z.number().int().positive(),
  resolution: z.enum(SUGGESTION_RESOLUTIONS),
});
export type ResolveSuggestionInput = z.infer<typeof resolveSuggestionInput>;
