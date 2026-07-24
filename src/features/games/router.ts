/* 게임 보드 tRPC 라우터. 읽기(list)는 공개, 쓰기(add·remove)는 서버 인가(불변식 3). 입력은
   Zod 를 통과한 뒤에만 서비스로 간다. */

import { TRPCError } from "@trpc/server";
import { authorizedProcedure, publicProcedure, router } from "../trpc/init";
import { addGameInput, playDatesInput, removeGameInput, updateGameInput } from "./schema";
import {
  addGame,
  listGames,
  MultiDayScheduleLocked,
  playEntriesOf,
  PlayDateChangedElsewhere,
  removeGame,
  updateGame,
} from "./service";

export const gamesRouter = router({
  list: publicProcedure.query(({ ctx }) => listGames(ctx.db)),

  /* 편집용 플레이 날짜. **공개가 아니다** — 발행 경계를 안 걸고 읽으므로(초안 주의 항목도
     센다) 공개로 열면 미완성 주간표의 날짜가 새어나가 결정 13 을 우회한다. list 에 실지 않고
     별도 프로시저로 둔 이유가 그것이고, 그래서 쓰기와 같은 game:write 를 요구한다 — 이 값을
     쓰는 자리가 "고칠 수 있나"를 판정하는 폼뿐이라 권한이 곧 용도와 맞는다. */
  playDates: authorizedProcedure("game:write")
    .input(playDatesInput)
    .query(async ({ ctx, input }) => {
      const entries = await playEntriesOf(ctx.db, input.id);
      return entries.map((e) => e.scheduledDate);
    }),

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
      let row;
      try {
        row = await updateGame(ctx.db, input);
      } catch (e) {
        /* 여러 날 편성된 게임의 날짜를 바꾸려 했다. 폼이 이미 잠갔으므로 정상 경로에선 안 오고,
           와도 사용자가 손쓸 곳은 /schedule 이라 그리로 가리킨다. */
        if (e instanceof MultiDayScheduleLocked) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "여러 날 편성된 게임이라 여기선 날짜를 못 고쳐요 — 일정에서 고쳐 주세요.",
          });
        }
        /* 폼이 열린 뒤 일정이 딴 데서 바뀌었다. **저장되지 않았다고 단정할 수 있다** — 서버가
           쓰기 전에 막았다. 그냥 재시도하면 같은 stale 값이라 또 걸리므로 새로고침을 시킨다
           (schedule 편집기의 CONFLICT 문구와 같은 처방). */
        if (e instanceof PlayDateChangedElsewhere) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "다른 곳에서 이 게임의 플레이 날짜를 먼저 바꿨어요. 저장하지 않았어요 — 새로고침해서 다시 시도해 주세요.",
          });
        }
        throw e;
      }
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
