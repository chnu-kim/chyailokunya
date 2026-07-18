/* 프론트 tRPC 클라이언트(vanilla, ADR-0004). react-query 를 새로 들이지 않는다(YAGNI) — 컴포저·
   삭제는 useState/useTransition 로 충분하다. AppRouter 타입만 coupling 해 end-to-end 타입을
   얻는다. 공개 읽기(games.list)는 서버 컴포넌트가 직접 부르므로 이 클라이언트는 쓰기(add·remove)·
   카테고리 검색에만 쓴다. 쿠키(access·refresh)는 same-origin 요청에 자동 첨부된다. */

import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "@/features/router";

export const trpc = createTRPCClient<AppRouter>({
  links: [httpLink({ url: "/api/trpc" })],
});
