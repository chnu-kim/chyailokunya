# ADR-0007: 단일 앱 + 기계 강제 레이어 경계

- 상태: Accepted
- 날짜: 2026-07-18

## 맥락

"AI 중심 유지보수 — 경계는 기계가 강제한다"가 원칙이다. 모노레포/멀티패키지는 지금
규모에 오버헤드지만, 경계 없는 단일 앱은 레이어가 뒤섞여 표류한다.

## 결정

**단일 Next 앱** 안에서 레이어를 두고, **dependency-cruiser** 로 의존 방향을 기계
강제한다. 의존은 아래로만 흐른다:

```
src/components/ui  →  src/features  →  src/db  →  src/core
```

- `core` — 순수 도메인(HTTP·DB·React 무관).
- `db` — Drizzle/D1. `core` 만 안다.
- `features` — 유즈케이스·tRPC 라우터. `db`·`core` 만 안다.
- `components/ui` — Radix/shadcn 프리미티브. `features` 를 쓰되 `db`·`core` 를 직접 안 건드린다.
- `app/` — 조립 지점. 어디든 쓸 수 있다.

위로 새는 import 는 CI 의 `boundaries` 단계에서 error 로 죽는다(실측 확인됨).

## 근거

- 패키지 매니저 없는 정적 사이트에서 온 프로젝트다 — 무게를 더하지 않되 규율은 코드로 남긴다.
- 추상화 레이어는 실제 두 번째 기능이 seam 을 드러낼 때 JIT 로([ADR-0010](./0010-verification-first-jit-abstraction.md)).
  경계는 그 seam 이 어디 생겨야 하는지를 미리 못박는다.

## 기각한 대안

- **멀티패키지 모노레포(pnpm workspace 등)** — 지금은 빌드·버전 관리 오버헤드가 이득을 넘는다.
- **경계 없는 단일 앱** — "왜 이게 저걸 import 하지" 가 리뷰에서만 잡힌다. 기계가 잡아야 한다.

## 결과

- (+) 레이어 위반이 사람 리뷰가 아니라 CI 에서 잡힌다.
- (+) AI 에이전트가 "이 코드가 어디 속하나"를 경로 규칙으로 안다.
- (−) 규칙이 실제 코드보다 앞서면 빈 레이어(자리표시자)가 생긴다 — 의도된 것이며 orphan 은
  warn 으로 둔다.
