/* 앱 루트 라우터. AppRouter 타입이 클라이언트로 흘러 end-to-end 타입을 만든다(ADR-0004). */

import { router } from "./trpc/init";
import { roleRouter } from "./auth/router";
import { chzzkRouter } from "./chzzk/router";
import { gamesRouter } from "./games/router";
import { scheduleRouter } from "./schedule/router";

export const appRouter = router({
  games: gamesRouter,
  chzzk: chzzkRouter,
  role: roleRouter,
  schedule: scheduleRouter,
});

export type AppRouter = typeof appRouter;
