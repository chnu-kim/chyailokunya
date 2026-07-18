/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// vitest.config 이 miniflare bindings 로 주입하는 테스트 전용 바인딩. wrangler.jsonc 엔 없어서
// 생성된 Cloudflare.Env(cloudflare-env.d.ts)에 병합해 둔다 — setup 의 applyD1Migrations 가
// env.TEST_MIGRATIONS 로 읽는다.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
