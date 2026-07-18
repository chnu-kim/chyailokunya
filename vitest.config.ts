import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/* 유닛 테스트를 실제 Workers 런타임(workerd)에서 돌린다 — "로컬 node 는 통과하는데 배포
   런타임에선 깨지는" 이탈을 없앤다. v0.18(Vitest 4)부터 defineWorkersConfig 는 사라지고,
   예전 poolOptions.workers 에 넣던 설정을 cloudflareTest() 플러그인에 그대로 넘긴다.

   Phase 3 에서 D1 을 붙였다:
   - miniflare.d1Databases:["DB"] → Miniflare 가 바인딩 이름으로 로컬 D1 을 준다(실제
     원격 database_id 가 아니라 테스트용 임시 저장소).
   - readD1Migrations 로 drizzle 마이그레이션을 Node(설정) 사이드에서 읽어 TEST_MIGRATIONS
     바인딩으로 워커에 넘기고, setupFiles(apply-migrations)가 각 테스트 파일 격리 저장소에
     스키마를 세운다. 시드 데이터는 넣지 않는다 — 테스트는 각자 픽스처로 결정성을 지킨다. */
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./drizzle");
  return {
    // 워커 풀 번들러는 tsconfig 의 paths 를 안 읽는다 — @/* 를 vite alias 로 직접 준다.
    // 이게 없으면 @/core·@/db 를 import 하는 모듈(schema·features·tRPC)이 테스트에서 못 찾는다.
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
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
      include: ["src/**/*.{test,spec}.ts"],
      setupFiles: ["./src/test/apply-migrations.ts"],
    },
  };
});
