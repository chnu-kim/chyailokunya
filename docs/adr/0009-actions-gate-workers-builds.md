# ADR-0009: CI 게이트는 GitHub Actions, 배포는 Cloudflare Workers Builds

- 상태: Accepted (게이트 부분만) · **배포 부분은 [ADR-0016](./0016-deploy-github-actions-opennext.md) 이 대체**
- 날짜: 2026-07-18

> **변경:** [ADR-0016](./0016-deploy-github-actions-opennext.md) 이 배포 주체를 Workers Builds 에서
> **GitHub Actions(OpenNext deploy)** 로 바꿨다 — 워커가 실제로 안 올라왔고, 배포에 D1 마이그레이션
> 선적용을 코드로 게이트하려. 이 ADR 의 **게이트 = GitHub Actions** 는 그대로 유효하다.

## 맥락

"검증 가능성 우선"을 코드로 붙박으려면 나쁜 머지를 막는 게이트가 필요하다. 배포는
Cloudflare Workers([ADR-0002](./0002-cloudflare-workers-opennext.md))로 나간다. 이 둘의
책임을 나눈다.

## 결정

- **게이트 = GitHub Actions.** PR·main 푸시에서 `format · lint · typecheck · boundaries ·
unit · build` 를 돌린다. 하나라도 실패하면 머지 불가.
- ~~**배포 = Cloudflare Workers Builds.** GitHub 연동(Phase 0)으로 main 이 갱신되면 Cloudflare
  가 `opennextjs-cloudflare build` 후 배포한다. GH Actions 는 배포하지 않는다.~~
  (**[ADR-0016](./0016-deploy-github-actions-opennext.md) 이 뒤집었다** — 배포도 GitHub Actions
  (`.github/workflows/deploy.yml`)가 한다.)

## 근거

- 게이트(검증)와 배포(실행)를 분리하면 각자 단순해진다. Actions 는 "초록이냐"만, Workers
  Builds 는 "올린다"만 책임진다.
- Workers Builds 는 Cloudflare secret·바인딩을 배포 환경에서 직접 쥔다 — 비밀을 GH 로
  넘길 필요가 없다.
- boundaries 단계가 레이어 위반([ADR-0007](./0007-single-app-enforced-boundaries.md))을
  실제로 error 로 실패시킨다(확인됨).

## 기각한 대안

- **GH Actions 에서 직접 `wrangler deploy`** — Cloudflare 자격증명·바인딩을 GH secret 으로
  복제해야 한다. Workers Builds 가 그 결합을 없앤다.
- **게이트 없이 배포만** — 검증 우선 원칙에 정면으로 어긋난다.

## 결과

- (+) 검증과 배포의 관심사가 분리된다. ~~비밀이 GH 로 새지 않는다.~~
  (**ADR-0016 이 뒤집었다** — 배포가 Actions 로 오면서 `CLOUDFLARE_API_TOKEN`·
  `CLOUDFLARE_ACCOUNT_ID` 가 GitHub secret 에 산다. 0016 이 그 트레이드오프를 명시한다.)
- (+) 로컬 npm 11 의 `allowScripts` 승인이 package.json 에 지속돼 `npm ci` 도 동일하게 재현.
- ~~(−) 두 시스템(Actions·Workers Builds)을 각각 관찰해야 한다. main 배포 실패는 PR 게이트가
  아니라 Workers Builds 로그에서 본다.~~
  (**[ADR-0016](./0016-deploy-github-actions-opennext.md) 이후 관찰 지점은 Actions 하나다** —
  main 배포 실패는 `Deploy` 워크플로 로그에서 본다.)
