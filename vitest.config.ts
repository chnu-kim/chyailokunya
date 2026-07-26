import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

/* 유닛 테스트가 두 프로젝트로 갈린다(#78, XState 일원화 리팩토링 착수 준비 — ADR-0008 확장).

   - **workerd** — 서버·도메인 로직. 실제 Workers 런타임에서 돌려 "로컬 node 는 통과하는데
     배포 런타임에선 깨지는" 이탈을 없앤다. D1 바인딩은 Miniflare 로 재현한다.
   - **dom** — 클라이언트 컴포넌트·머신 배선. happy-dom 환경(스파이크로 dialog close 이벤트·
     포커스 관측/복원·inert·popstate 를 확인했다)에서 @testing-library/react 로 돈다. 워커
     풀 번들러는 이 계열의 DOM API 를 안 준다 — 애초에 갈라야 하는 이유다.

   워커 풀 번들러는 tsconfig 의 paths(`@/*`)를 안 읽으므로 두 프로젝트 다 alias 를 직접
   준다(dom 프로젝트도 `@/core`·`@/features` 를 import 하는 컴포넌트를 그대로 테스트한다). */
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./drizzle");
  return {
    test: {
      projects: [
        {
          resolve: { alias },
          plugins: [
            cloudflareTest({
              miniflare: {
                compatibilityDate: "2026-07-14",
                compatibilityFlags: ["nodejs_compat"],
                d1Databases: ["DB"],
                bindings: { TEST_MIGRATIONS: migrations },
              },
            }),
          ],
          test: {
            name: "workerd",
            include: ["src/**/*.{test,spec}.ts"],
            setupFiles: ["./src/test/apply-migrations.ts"],
          },
        },
        {
          resolve: { alias },
          test: {
            name: "dom",
            environment: "happy-dom",
            include: ["src/app/**/*.test.tsx"],
            setupFiles: ["./src/test/dom-matchers.ts"],
          },
        },
      ],
    },
  };
});
