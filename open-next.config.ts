import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 기본 설정으로 시작한다. incremental cache(R2)·tag cache(D1/DO)·queue 오버라이드는
// 실제로 ISR/재검증이 필요한 기능이 생길 때 JIT 로 붙인다 — Phase 1 은 정적 셸이라
// 캐시 백엔드가 없어도 배포가 성립한다.
export default defineCloudflareConfig();
