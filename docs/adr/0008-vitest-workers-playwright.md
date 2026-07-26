# ADR-0008: 테스트는 Vitest(Workers pool) + Playwright

- 상태: Accepted (2026-07-26 DOM 프로젝트 확장 — 아래 「확장: DOM 테스트 프로젝트」)
- 날짜: 2026-07-18

## 맥락

"검증 가능성 우선"이 최우선 원칙이다. 배포 런타임은 workerd(Cloudflare Workers)이고,
프론트는 잦은 시각 변경을 감수한다. 단위 로직과 화면을 각각 다른 도구로 지킨다.

## 결정

- **단위/통합: Vitest + `@cloudflare/vitest-pool-workers`.** 테스트를 node 가 아니라
  **workerd 안**에서 돌려 "로컬 node 는 통과, 배포 런타임에선 깨짐"을 없앤다. D1 바인딩은
  Miniflare 로 재현한다.
- **e2e/시각회귀: Playwright.** Phase 2 의 3페이지 시각 스냅샷이 "검증된 베이스라인"이 된다.

## 근거

- pool-workers 는 배포 런타임과 같은 엔진에서 단위 테스트를 실행 — 런타임 이탈을 원천 차단.
- Playwright 시각 스냅샷은 잦은 디자인 변경에서 "의도한 변경 vs 회귀"를 가른다.
- v0.18(Vitest 4)부터 `defineWorkersConfig` 대신 `cloudflarePool`/`cloudflareTest` 플러그인
  API 를 쓴다 — vitest.config.ts 에 반영됨.

## 기각한 대안

- **Vitest node 환경만** — 배포 런타임과 달라 workerd 전용 버그를 못 잡는다.
- **Jest** — Vite/ESM/Workers pool 생태계에서 Vitest 가 앞선다.
- **Cypress** — Playwright 의 시각회귀·병렬·트레이스가 이 용도에 더 맞는다.

## 결과

- (+) 단위 테스트가 배포 런타임을 그대로 반영한다.
- (+) 시각 회귀가 CI 에서 자동 감지된다(Phase 2 이후).
- (−) Workers pool 은 첫 부팅·workerd 바이너리 비용이 있다. Playwright 는 CI 에서 브라우저
  설치 단계가 필요하다 — 별 job 으로 분리.

## 확장: DOM 테스트 프로젝트 (2026-07-26, #78)

### 맥락

XState 일원화(ADR-0026)를 준비하며 지금 안전망을 재봤다. 단위 393(당시 실측, 이 확장
시점 기준 434)개 중 클라이언트 전이를 보는 건 `core/games-composer`+`core/schedule-editor`
57개뿐이고, 나머지는 서버·도메인이라 **클라이언트가 깨져도 전부 초록이다.** 실질 안전망은
Playwright e2e 뿐이었다 — 그런데 `vitest.config.ts` 가 모든 단위를 workerd 풀에서 돌리고
`include` 도 `src/**/*.{test,spec}.ts` 라 **`.tsx` 는 애초에 대상이 아니었다.** workerd 풀은
DOM API 를 안 준다(Cloudflare Workers 런타임엔 없다).

### 결정

**Vitest `test.projects` 로 `workerd`(기존)와 `dom`(신규) 을 가른다.**

| 프로젝트  | 환경                                                  | 대상                                                          | 파일 규약                 |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------- |
| `workerd` | `@cloudflare/vitest-pool-workers`(Miniflare+D1)       | 서버·도메인·**머신**(`core/*.machine.ts`, 부수효과 없이 순수) | `src/**/*.{test,spec}.ts` |
| `dom`     | `environment: "happy-dom"` + `@testing-library/react` | 클라이언트 컴포넌트·머신↔컴포넌트 배선                        | `src/app/**/*.test.tsx`   |

머신 자체(`*.machine.ts`)는 **workerd** 프로젝트에 남는다 — 순수 상태차트라 DOM 이 필요
없고, 서버·도메인 로직과 같은 계약(배포 런타임에서 돈다)을 그대로 받는 게 이득이다.
`dom` 프로젝트가 맡는 건 **머신을 문 컴포넌트가 실제 DOM 이벤트에 옳게 반응하는가**다.

### 스파이크로 확인한 경계

문서화 전에 실제로 돌려 확인했다(AGENTS.md Phase 4 지뢰와 같은 규율 — 런타임 계약은
증명 후에 적는다). 결과와 근거는 ADR-0026 「검증 스파이크」절 참고. 요약:

- **happy-dom 으로 충분하다.** `<dialog>` close 이벤트·`activeElement`(포커스 복원 포함)·
  `inert`·`history.pushState`→`popstate` 넷 다 스펙대로 동작한다. jsdom 전환도, 이 계열을
  e2e 로 남기는 것도 불필요하다 — **8종 특성화 전부 `dom` 프로젝트가 맡는다.**
- **실제 import 그래프가 마운트된다.** `SuggestionInbox`·`GameBoard`(1051줄 전체)로
  확인했다 — tRPC·`next/link`·`core`/`features`·모듈 싱글턴 히스토리 컨트롤러가 전부
  걸림 없이 돈다.
- **tRPC 목의 정본 모양** — `vi.mock("@/features/trpc/client", () => ({ trpc: {...} }))` 로
  클라이언트 모듈 전체를 교체한다. vanilla `createTRPCClient`(ADR-0004)라 React
  컨텍스트/프로바이더가 없어 이 한 형태로 충분하다. 특성화 대상 중 tRPC 를 쓰는 4~8번이
  전부 이 모양을 공유한다.
- **`@testing-library/react` 자동 cleanup 은 `test.globals: true` 가 있어야 걸린다**(Vitest
  문서 명시). 이 저장소는 다른 설정과 같은 이유로 globals 를 안 켠다 — `dom` 프로젝트
  setupFiles 가 `afterEach(cleanup)` 을 **명시로** 등록한다. 안 하면 한 파일의 두 번째
  `it()` 부터 이전 렌더가 DOM 에 남아 조용히 깨진다(실측).
- **Next 라우트 announcer 트랩이 이 프로젝트에선 안 생긴다.** `getByRole("alert")` 가
  `#__next-route-announcer__` 를 먼저 잡는 문제(AGENTS.md 「팬 제안」절)는 e2e 가 앱 셸
  전체를 렌더하기 때문이다 — `dom` 프로젝트는 컴포넌트를 격리해서 마운트하므로 이 트랩이
  구조적으로 없다.

### 기각한 대안

- **jsdom** — happy-dom 이 스파이크의 네 계약을 전부 만족해 바꿀 이유가 없었다.
- **배선 테스트를 전부 e2e 에 남긴다** — D1 픽스처 하나를 공유하고 `fullyParallel` 이라
  상태 전이를 재는 e2e 가 서로 간섭한다(AGENTS.md 「e2e 스펙은 D1 픽스처 하나를 공유한다」).
  또 e2e 는 실제 서버까지 왕복해 느리다 — 초 단위 피드백이 안 된다.

### 결과

- (+) 클라이언트 배선이 초 단위로 잡힌다 — 지금까지 이 계열을 재는 유일한 도구가 e2e 뿐이었다.
- (+) 8종 특성화(#78 PR 3)가 이 프로젝트 위에서 도는 기준선이 된다 — 이후 XState 배선
  PR(#80~#85)마다 이 기준선이 회귀를 잡는다.
- (−) `@testing-library/react`+`@testing-library/jest-dom`+`happy-dom` 의존이 늘어난다.
- (−) 컴포넌트 테스트는 tRPC 를 목으로 교체하므로 서버 계약(Zod 스키마·인가) 자체는 안
  본다 — 그건 여전히 workerd 프로젝트(라우터 테스트)와 e2e 의 몫이다.
