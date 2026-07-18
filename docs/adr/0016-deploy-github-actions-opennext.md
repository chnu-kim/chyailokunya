# ADR-0016: 배포는 GitHub Actions(OpenNext deploy) — Workers Builds 대체

- 상태: Accepted
- 날짜: 2026-07-18
- 대체: [ADR-0009](./0009-actions-gate-workers-builds.md) 의 "배포 = Workers Builds" 부분(게이트 부분은 유효)

## 맥락

ADR-0009 는 게이트를 GitHub Actions, 배포를 Cloudflare Workers Builds(대시보드 GitHub 연동)로
나눴다. 그런데 Phase 3(#5) 머지 시점까지 **워커가 계정에 아예 없었다** — Workers Builds 연동이
실제로 배포하지 않았다(`wrangler deployments list` → `Worker does not exist`, code 10007).
한편 배포 자격(`CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`)은 이미 GitHub Actions secret 으로
이식돼 있었고, 배포에 **D1 마이그레이션 선적용** 같은 절차를 코드로 게이트하고 싶었다(codex
리뷰가 "스키마 없는 채 배포되면 `/games` 가 500" 을 지적).

## 결정

배포를 **GitHub Actions 워크플로(`.github/workflows/deploy.yml`)** 로 한다.

- **트리거**: `workflow_run` — CI("게이트")가 **main 에서 성공**으로 끝난 뒤에만 배포한다. 실패·취소면 안 함.
- **순서**: `wrangler d1 migrations apply --remote`(멱등) → `npm run deploy`(OpenNext build + deploy).
  스키마를 코드보다 먼저 적용해 롤아웃 창의 500 을 구조적으로 없앤다.
- **자격**: Actions secret `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`(이식됨). 저장소엔 두지 않는다.
- 배포 대상은 CI 가 검증한 **정확한 커밋**(`workflow_run.head_sha`).

ADR-0009 의 **게이트 = GitHub Actions**([format · lint · typecheck · boundaries · unit · build] + e2e 스모크)는
그대로 유효하다. 바뀌는 건 배포 주체뿐이다.

## 근거

- Workers Builds 대시보드 연동이 이 저장소에서 실제로 배포하지 않았다 — 배포 정의를 **저장소 안
  워크플로로** 버전 관리하면 재현·감사·리뷰가 된다.
- 배포를 CI 성공에 `workflow_run` 으로 걸어 "게이트 후 배포"를 기계가 강제한다(ADR-0009 정신 유지).
- **마이그레이션을 배포 파이프라인에 넣어** codex 가 지적한 "스키마↔코드 순서" 리스크를 절차가
  아니라 워크플로로 막는다([ADR-0003](./0003-d1-drizzle.md) 의 D1 스키마가 배포와 함께 흐른다).

## 기각한 대안

- **Workers Builds 유지** — 대시보드 연동이 배포하지 않았고(워커 부재), 배포 절차(마이그레이션
  선적용)를 저장소 코드로 못 박기 어렵다.
- **`on: push: main` 에서 바로 배포** — CI 가 실패한 main 도 프로덕션으로 나갈 수 있다. `workflow_run`
  게이팅이 그걸 막는다.
- **wrangler-action 으로 순수 `wrangler deploy`** — OpenNext 는 자체 build(`opennextjs-cloudflare
build`)가 필요하다. `npm run deploy` 가 build+deploy 를 함께 한다.

## 결과

- (+) 게이트 → 마이그레이션 → 배포가 한 시스템(Actions)에서 순서대로. 배포 정의가 저장소에 산다.
- (+) 스키마 선적용이 자동 — `/games` 의 배포창 500 이 구조적으로 사라진다.
- (−) ADR-0009 가 피하려던 것 — CF 자격이 GitHub secret 에 산다. 배포 정의를 얻는 대신의 트레이드오프.
- (−) 관찰 지점이 Actions 로 모인다(Deploy 워크플로 로그에서 배포 성패를 본다).
