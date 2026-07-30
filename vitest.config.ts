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
          /* `.spec` 도 함께 뺀다 — workerd 프로젝트의 include 가 `*.{test,spec}.ts` 라 그것도
             지원되는 테스트 이름이기 때문이다.

             **지금은 없어도 동작한다**(실측: `.test.` 만 빼 둔 채 스펙 파일을 `.spec.ts` 로
             바꿔 돌려도 리포트에 안 실린다 — Vitest 가 프로젝트의 test include 에 매칭되는
             파일을 스스로 뺀다). 그래도 적는 이유는 그 자동 제외가 **우리가 통제하는 계약이
             아니어서**다. 만약 새면 테스트 본문이 프로덕션 소스로 계측되는데, 그 본문은
             정의상 100% 실행되므로 앱 코드는 한 줄도 안 덮였는데 래칫만 올라간다 — 게이트가
             스스로를 속이는 방향이라 도구 동작에 기대지 않는다(코드 리뷰 지적). */
          "src/**/*.{test,spec}.{ts,tsx}",
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

           수치가 낮은 자리(`src/app` 의 page/layout/컴포넌트)가 곧 위험은 아니다 — 거긴 e2e 가
           실제로 렌더해서 본다. 이 숫자는 **유닛이 보는 범위**만 말하고, 그래서 낮은 값이
           "여긴 e2e 에만 걸려 있다"를 정직하게 드러낸다. 층별로 무엇이 무엇을 보는지는 ADR-0029. */
        /* **값은 소수점 한 자리까지 적는다.** 정수로 내리면 실측 95.34 에 95 를 박는 셈이라
           0.34%p 만큼 후퇴가 통과한다 — 신뢰 경계에서 그건 "작은 미검증 분기 하나"가 통째로
           들어올 수 있다는 뜻이다(코드 리뷰 지적). 소수점 두 자리까지 가지 않는 건 반올림
           경계에서 게이트가 흔들리지 않게 하려는 것뿐이고, 남는 슬랙은 0.04%p 다. */
        thresholds: {
          statements: 78.6,
          branches: 72.6,
          /* **코드를 지우면 이 비율이 내려갈 수 있다 — 래칫을 내리는 것과 다르다.** 이 PR 이 한때
             79.3 이었는데, 리뷰 반영으로 **덮여 있던 함수 둘을 지우자**(치수를 서버가 주게 되어
             클라이언트 판독기가 불필요해졌다) 분모가 바뀌어 79.23 이 됐다. ADR-0029 가 처음 박은
             79.2 아래로는 내리지 않는다 — 그 값이 진짜 바닥이다. **같은 일이 코드를 층 사이로
             옮길 때도 생긴다**: HTTP 응답 파싱을 core(덮임)에서 app(단위 층 밖)으로 내리자
             statements·branches·lines 가 함께 내려갔다 — 레이어 계약을 지키는 대가이고, 이때도
             기준은 같다(ADR-0029 의 바닥 위에서만 조정한다). */
          functions: 79.4,
          lines: 80.0,

          /* **집계 임계치만으로는 신뢰 경계를 못 지킨다**(적대적 리뷰 지적, 2026-07-30). 저장소
             전체 한 숫자면 인증 코드가 0% 로 들어와도 다른 곳이 늘어 통과한다 — 실제로 이 설정을
             처음 넣던 시점이 정확히 그 상태였다(요청 진입점 셋이 통째로 0%). 그래서 요청이
             바깥에서 처음 닿는 자리 셋은 집계와 별개로 잠근다.

             **여기서는 100% 인 축을 100 으로 박는다.** 한때 "무관한 한 줄이 게이트를 깨면
             사람들이 임계치를 낮춘다"며 99 로 뒀는데, 그건 신뢰 경계에 여유를 주는 것이라
             앞뒤가 안 맞았다 — 게다가 같은 파일에서 functions 는 100 으로 박고 있었다. 이 셋에
             한해서는 **새 코드 한 줄이 안 덮이면 즉시 빨개지는 게 맞다.** 그게 부담이면 낮출
             것은 임계치가 아니라 그 코드를 여기 두는 선택이다. */
          "src/app/api/**": {
            statements: 97.6,
            branches: 89.5,
            functions: 93.3,
            lines: 100,
          },
          "src/features/auth/**": {
            statements: 95.3,
            branches: 86.1,
            functions: 100,
            lines: 96.8,
          },
          "src/middleware.ts": {
            statements: 96.8,
            branches: 94.4,
            functions: 100,
            lines: 100,
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
