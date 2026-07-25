/* 팬 제안 tRPC 라우터(ADR-0025). 인가가 두 층이다:

     create·mine  — 로그인만(authenticatedProcedure). 제안은 로그인의 기본 대가라 authority 를
                    안 건다(그 근거는 trpc/init.ts 의 authenticatedProcedure 주석).
     listPending·resolve — game:write. 제안을 읽고 처리하는 건 보드를 고칠 수 있는 사람의 일이고,
                    남의 제안 본문은 공개물이 아니다(부적절한 글이 방문자에게 닿으면 안 된다).

   **반영은 여기 없다.** 관리자가 제안을 보고 기존 게임 수정·추가 폼으로 반영하므로 games 쓰기는
   그대로 games 라우터 하나다 — 이 라우터는 제안의 생애(접수·조회·처리 표시)만 맡는다. */

import { TRPCError } from "@trpc/server";
import { authenticatedProcedure, authorizedProcedure, router } from "../trpc/init";
import { createSuggestionInput, resolveSuggestionInput } from "./schema";
import {
  countPendingSuggestions,
  createSuggestion,
  EmptySuggestion,
  listMySuggestions,
  listPendingSuggestions,
  OPEN_SUGGESTION_LIMIT,
  resolveSuggestion,
  SuggestionGameNotFound,
  TooManyOpenSuggestions,
} from "./service";

export const suggestionsRouter = router({
  create: authenticatedProcedure.input(createSuggestionInput).mutation(async ({ ctx, input }) => {
    try {
      return await createSuggestion(ctx.db, ctx.actor.userId, input);
    } catch (e) {
      /* 게임당 사람당 미처리 제안 하나(부분 UNIQUE 인덱스). 사용자가 손쓸 수 있는 상황이라
           — 먼저 낸 제안을 관리자가 처리하면 다시 낼 수 있다 — 그 사실까지 문구에 담는다. */
      if (isUniqueViolation(e)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "이 게임엔 이미 보낸 제안이 있습니다. 그 제안이 처리되면 다시 보낼 수 있습니다.",
        });
      }
      if (e instanceof SuggestionGameNotFound) {
        throw new TRPCError({ code: "NOT_FOUND", message: "보드에 없는 게임입니다." });
      }
      if (e instanceof EmptySuggestion) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "지금 값과 똑같습니다 — 고칠 값을 바꾸거나 한마디를 남겨 주십시오.",
        });
      }
      if (e instanceof TooManyOpenSuggestions) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `아직 처리 안 된 제안이 ${OPEN_SUGGESTION_LIMIT}개예요. 처리되면 더 보낼 수 있어요.`,
        });
      }
      throw e;
    }
  }),

  // 내가 낸 것만 본다 — 작성자 필터가 곧 그 경계다(service.listMySuggestions 주석).
  mine: authenticatedProcedure.query(({ ctx }) => listMySuggestions(ctx.db, ctx.actor.userId)),

  list: authorizedProcedure("game:write").query(({ ctx }) => listPendingSuggestions(ctx.db)),

  // 배지 갱신용. 서버 컴포넌트가 첫 페인트에 쓰는 값과 같은 함수라 두 수가 갈리지 않는다.
  pendingCount: authorizedProcedure("game:write").query(({ ctx }) =>
    countPendingSuggestions(ctx.db),
  ),

  /* 처리 표시. 반영이 성공한 뒤 클라이언트가 이어 부르는 자리이기도 하다 — 그 둘은 원자가
     아니고, 그래도 되는 이유는 실패했을 때 남는 상태가 "제안이 미처리로 남음"뿐이기 때문이다
     (관리자가 다시 보고 처리하면 끝이고, 중복 반영은 같은 값 저장이라 무해하다). 하나로 묶으면
     제안 처리가 games 쓰기 계약 안으로 들어와 ADR-0025 결정 2 가 지키려던 경계가 무너진다. */
  resolve: authorizedProcedure("game:write")
    .input(resolveSuggestionInput)
    .mutation(({ ctx, input }) => {
      // authorizedProcedure 통과 = 인가된 요청이지만 actor 타입은 nullable 이다(공개 읽기와 같은
      // 컨텍스트라서). 처리자를 기록해야 하므로 여기서 좁힌다.
      if (!ctx.actor) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "로그인이 필요합니다" });
      }
      return resolveSuggestion(ctx.db, { ...input, resolvedByUserId: ctx.actor.userId });
    }),
});

// drizzle 은 D1 에러를 DrizzleQueryError 로 감싼다 — 원인은 top message 가 아니라 .cause 에 있다
// (games/router.ts 와 같은 함정·같은 처방). 부분 UNIQUE 인덱스 위반도 같은 문구로 온다.
function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e; cur instanceof Error; cur = cur.cause) {
    if (/UNIQUE constraint failed/i.test(cur.message)) return true;
  }
  return false;
}
