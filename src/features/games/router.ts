/* 게임 보드 tRPC 라우터. 읽기(list)는 공개, 쓰기(add·remove)는 서버 인가(불변식 3). 입력은
   Zod 를 통과한 뒤에만 서비스로 간다. */

import { TRPCError } from "@trpc/server";
import { authorizedProcedure, publicProcedure, router } from "../trpc/init";
import { addGameInput, removeGameInput, updateGameInput } from "./schema";
import { addGame, listGames, removeGame, updateGame } from "./service";

export const gamesRouter = router({
  list: publicProcedure.query(({ ctx }) => listGames(ctx.db)),

  add: authorizedProcedure("game:write")
    .input(addGameInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await addGame(ctx.db, input);
      } catch (e) {
        // category_id UNIQUE: 한 카테고리 = 보드 1회. 사용자에게 친절한 충돌로 바꿔 준다.
        if (isUniqueViolation(e)) {
          throw new TRPCError({ code: "CONFLICT", message: "이미 보드에 있는 게임이에요." });
        }
        throw e;
      }
    }),

  /* 클리어 수정도 보드를 바꾸는 쓰기다 — game:write 로 add 와 같은 문을 쓴다(클리어만 고치는
     별도 권한을 새로 만들 근거가 없다). 없는 id 는 NOT_FOUND 로 올린다. */
  update: authorizedProcedure("game:write")
    .input(updateGameInput)
    .mutation(async ({ ctx, input }) => {
      const row = await updateGame(ctx.db, input);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "보드에 없는 게임이에요." });
      }
      return row;
    }),

  remove: authorizedProcedure("game:delete")
    .input(removeGameInput)
    .mutation(({ ctx, input }) => removeGame(ctx.db, input.id)),
});

// drizzle 은 D1 에러를 DrizzleQueryError 로 감싼다 — "UNIQUE constraint failed" 는 top
// message 가 아니라 .cause 에 있다. cause 체인을 끝까지 훑어 원인을 찾는다.
function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e; cur instanceof Error; cur = cur.cause) {
    if (/UNIQUE constraint failed/i.test(cur.message)) return true;
  }
  return false;
}
