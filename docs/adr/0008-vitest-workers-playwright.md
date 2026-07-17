# ADR-0008: 테스트는 Vitest(Workers pool) + Playwright

- 상태: Accepted
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
