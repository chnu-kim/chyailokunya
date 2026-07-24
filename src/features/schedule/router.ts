/* 일정 tRPC 라우터(이슈 #56 결정 12·14). 읽기·쓰기 모두 schedule:write 인가 뒤다 — 이 라우터는
   **편집자용**이라 미발행 초안까지 다룬다(공개 읽기 페이지는 발행된 주만, 작업순서 5 에서 별도).
   입력은 Zod 를 통과한 뒤에만 서비스로 간다(불변식 2·3). */

import { TRPCError } from "@trpc/server";
import { authorizedProcedure, router } from "../trpc/init";
import { getWeekInput, saveWeekInput } from "./schema";
import { getWeekForEdit, saveWeek, WeekRevisionConflict } from "./service";

export const scheduleRouter = router({
  // 편집 화면이 한 주를 불러온다 — 발행 여부와 무관하게(초안 편집). 읽기지만 초안이 새지 않게
  // 쓰기 권한자에게만 연다.
  getWeek: authorizedProcedure("schedule:write")
    .input(getWeekInput)
    .query(({ ctx, input }) => getWeekForEdit(ctx.db, input.weekStartDate)),

  // 주 단위 일괄 저장(전체 교체). 항목의 gameId 가 없는 게임을 가리키면 FK 로 배치가 통째로
  // 롤백된다 — 친절한 BAD_REQUEST 로 바꿔 준다(games.add 의 UNIQUE→CONFLICT 와 같은 결).
  saveWeek: authorizedProcedure("schedule:write")
    .input(saveWeekInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await saveWeek(ctx.db, input);
      } catch (e) {
        /* 불러온 뒤 누군가 이 주를 먼저 저장했다. 전체 교체라 그대로 진행하면 그 사람의 항목이
           통째로 사라지므로 덮어쓰지 않고 거절한다 — 편집기가 이 코드를 받아 안내한다. */
        if (e instanceof WeekRevisionConflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "다른 곳에서 이 주를 먼저 저장했어요.",
          });
        }
        if (isForeignKeyViolation(e)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "보드에 없는 게임을 가리켰어요." });
        }
        throw e;
      }
    }),
});

// drizzle 은 D1 에러를 DrizzleQueryError 로 감싼다 — "FOREIGN KEY constraint failed" 는 top
// message 가 아니라 .cause 에 있다. cause 체인을 끝까지 훑는다(games 라우터의 UNIQUE 판정과 동형).
function isForeignKeyViolation(e: unknown): boolean {
  for (let cur: unknown = e; cur instanceof Error; cur = cur.cause) {
    if (/FOREIGN KEY constraint failed/i.test(cur.message)) return true;
  }
  return false;
}
