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
      /* 커버리지는 **항상 켜져 있다.** 별도 스크립트로 빼면 로컬 `npm test` 와 CI 게이트가
         갈려서, "로컬에서 게이트를 그대로 돌린다"(AGENTS.md)가 깨진다. 값은 싸다 — 계측을
         켜도 8.6s → 10.5s 다(실측).

         **provider 는 istanbul 이어야 한다.** 기본값 v8 은 `node:inspector` 의 Session 을
         쓰는데 workerd 엔 그게 없다 — 워커 풀 스펙 35개가 `ERR_METHOD_NOT_IMPLEMENTED` 로
         죽고 리포트가 dom 프로젝트만 담은 32% 로 나온다(실측). istanbul 은 소스를 계측해
         변환하므로 런타임 API 에 안 기댄다.

         **`all: true` 가 핵심이다.** 없으면 테스트가 한 번도 import 하지 않은 파일이 리포트에
         아예 안 실려 수치가 부풀려진다 — 이 저장소는 86.5% 로 보였지만 실제는 68.3% 였고,
         빠진 26개 파일에 OAuth 콜백 라우트가 들어 있었다. 커버리지의 값어치는 "덮인 곳"이
         아니라 "안 덮인 곳"을 세는 데 있으므로 안 덮인 파일이 빠지면 도구가 자기 목적을
         배반한다. */
      coverage: {
        // `--coverage` 플래그 없이도 켜진다 — 게이트를 옵트인으로 두면 아무도 안 켠다.
        enabled: true,
        // `as const` 가 없으면 리터럴이 `string` 으로 넓혀져 defineConfig 오버로드가 통째로
        // 안 맞는다 — 이 콜백이 Promise 를 반환해 추론이 한 단계 더 늦게 일어나기 때문이다.
        provider: "istanbul" as const,
        all: true,
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/*.test.{ts,tsx}",
          "src/**/*.d.ts",
          // 테스트 하네스와 픽스처 — 스스로가 검증 도구라 커버리지 대상이 아니다.
          "src/test/**",
          "src/app/games/test-fixtures.ts",
        ],
        reporter: ["text-summary", "json-summary", "html"],
        reportsDirectory: "./coverage",
        /* **래칫이다 — 목표가 아니라 바닥이다.** 지금 수치 바로 아래에 박아 두고, 테스트를
           늘릴 때마다 같이 올린다. 목표치(80% 등)를 미리 박으면 숫자를 채우려는 테스트가
           섞여 들어오는데, 이 저장소가 테스트에서 얻는 건 커버리지가 아니라 회귀 차단이다.

           수치가 낮은 자리(`src/app` 48.9%)가 곧 위험은 아니다 — page/layout/컴포넌트는
           e2e 가 실제로 렌더해서 본다. 이 숫자는 **유닛이 보는 범위**만 말하고, 그래서
           낮은 값이 "여긴 e2e 에만 걸려 있다"를 정직하게 드러낸다. 층별로 무엇이 무엇을
           보는지는 ADR-0029. */
        thresholds: {
          statements: 68,
          branches: 64,
          functions: 76,
          lines: 69,

          /* **집계 임계치만으로는 신뢰 경계를 못 지킨다**(적대적 리뷰 지적, 2026-07-30). 저장소
             전체 한 숫자면 인증 코드가 0% 로 들어와도 다른 곳이 늘어 통과한다 — 게이트가 초록인데
             가장 위험한 코드에 검증이 0 인 상태가 정확히 지금이다. 그래서 경로별로 따로 잠근다.

             **`src/app/api/**` 와 `src/middleware.ts` 는 여기 없다 — 지금 0% 라서다.** 0 을 박아
             두면 "잠갔다"는 착시만 생긴다(0 은 어떤 후퇴도 못 막는다). 그 둘은 테스트를 실제로
             짜는 PR 이 함께 잠근다 — 그때까지 이 게이트는 **신뢰 경계를 보호하지 않는다.** */
          "src/features/auth/**": {
            statements: 95,
            branches: 85,
            functions: 100,
            lines: 96,
          },
        },
      },
      projects: [
        {
          resolve: { alias },
          plugins: [
            cloudflareTest({
              miniflare: {
                compatibilityDate: "2026-07-14",
                compatibilityFlags: ["nodejs_compat"],
                d1Databases: ["DB"],
                // 팬아트 바이트(ADR-0028). D1 과 같은 결 — 이름만 주면 Miniflare 가 로컬
                // 저장소를 세운다. 테스트 간 정리는 D1 과 달리 각 스펙이 자기 키만 쓰고 지운다
                // (버킷 전체를 비우면 병렬 스펙끼리 서로의 객체를 지운다).
                r2Buckets: ["FANART"],
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
