import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// 유닛 테스트를 실제 Workers 런타임(workerd)에서 돌린다 — "로컬 node 는 통과하는데
// 배포 런타임에선 깨지는" 이탈을 없앤다. v0.18(Vitest 4)부터 defineWorkersConfig 는
// 사라지고, 예전 poolOptions.workers 에 넣던 설정을 cloudflareTest() 플러그인에 그대로
// 넘긴다. Phase 3 에서 D1 바인딩이 붙으면 여기 miniflare.d1Databases 를 추가한다.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-07-14",
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    include: ["src/**/*.{test,spec}.ts"],
  },
});
