/* 라우트 목록이 실제 페이지와 어긋나지 않는지 기계가 본다(이슈 #25).

   이 검사가 없으면 `src/app` 에 `page.tsx` 만 만들고 `features/routes.ts` 를 안 고쳐도
   게이트 6종이 전부 초록이고, **그 페이지에서 로그인한 사람만 조용히 `/` 로 떨어진다** —
   이슈 #25 가 고치려던 증상이 그대로 재발한다. AGENTS.md 에 규칙으로도 적었지만 규칙은
   사람의 기억에 걸리고, 이 저장소의 전제는 기계가 검증한다는 것이다.

   **왜 unit 이 아니라 e2e 인가.** 단위 테스트는 workerd 안에서 돌아 `fs` 가 없다 —
   `src/app` 아래 page.tsx 를 훑을 수가 없다. Playwright 스펙은 Node 라 가능하다. 브라우저를
   안 쓰는 유일한 스펙이지만, 파일시스템을 읽을 수 있는 유일한 자리라 여기 둔다. */

import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { KNOWN_PAGE_PATHS } from "@/features/routes";

// 스펙은 ESM 으로 돈다 — `__dirname` 은 여기서 ReferenceError 다(실측).
const APP_DIR = fileURLToPath(new URL("../src/app", import.meta.url));

/* `src/app` 을 훑어 page.tsx 가 있는 디렉터리를 라우트 경로로 되돌린다. api 라우트(route.ts)는
   페이지가 아니라 세지 않는다 — 복귀 대상이 되면 로그인 직후 로그아웃되거나 루프가 돈다. */
function discoverPageRoutes(dir: string = APP_DIR): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...discoverPageRoutes(join(dir, entry.name)));
    } else if (entry.name === "page.tsx") {
      const rel = relative(APP_DIR, dir);
      /* 라우트 그룹 `(name)` 은 URL 에 안 실리므로 지운다. 동적 세그먼트 `[id]` 는 일부러
         그대로 둔다 — 허용목록은 고정 문자열 대조라 동적 경로를 표현할 수 없다. 그런 페이지가
         생기면 이 테스트가 낯선 이름으로 실패해서, 목록에 넣기 전에 무엇을 허용할지 먼저
         정하게 만든다(조용히 통과시키는 것보다 낫다). */
      const segments = rel.split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
      found.push("/" + segments.join("/"));
    }
  }
  return found;
}

test("features/routes.ts 의 목록이 src/app 의 실제 페이지와 일치한다", () => {
  const actual = discoverPageRoutes().sort();
  /* 양방향으로 못박는다. 빠지면(페이지 추가 후 목록 미갱신) 그 페이지에서 로그인한 사람이
     `/` 로 떨어지고, 남으면(페이지 삭제 후 목록 미갱신) 없는 곳으로 복귀시켜 404 가 난다. */
  expect(actual).toEqual([...KNOWN_PAGE_PATHS].sort());
});
