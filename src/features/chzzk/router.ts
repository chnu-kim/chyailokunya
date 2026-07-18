/* 치지직 카테고리 검색 라우터. 컴포저(추가 UI)가 쓰는 검색을 1:1 로 감싼다(ADR-0015).
   game:write 인가 — client_credentials 를 공개 트래픽 경로에 노출하지 않는다. */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authorizedProcedure, router } from "../trpc/init";
import { searchCategories } from "./client";

export const chzzkRouter = router({
  categorySearch: authorizedProcedure("game:write")
    .input(z.object({ query: z.string().min(1), size: z.number().int().min(1).max(50).optional() }))
    .query(({ ctx, input }) => {
      // 라이브는 creds 있을 때만(Q2). 없으면 라우터가 명확히 실패하고 공개 읽기엔 영향 없다.
      if (!ctx.chzzk) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "치지직 자격 증명이 설정되지 않았어요(관리자 설정 필요).",
        });
      }
      return searchCategories(ctx.chzzk, input.query, input.size);
    }),
});
