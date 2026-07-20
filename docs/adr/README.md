# 아키텍처 결정 기록 (ADR)

이 디렉터리는 `chyailokunya` 의 굵직한 아키텍처 결정과 **그 "왜"** 를 남긴다.
코드는 _무엇을_ 하는지 보여주지만, _왜 이렇게_ 됐는지는 시간이 지나면 사라진다 —
ADR 이 그 맥락을 붙박는다. 규칙(불변식·경계·플레이북)의 정본은 루트 `AGENTS.md`,
결정의 근거는 여기다.

## 규칙

- 한 파일 = 한 결정. 번호는 증가만 하고 재사용하지 않는다.
- 결정을 **뒤집을 때 파일을 지우지 않는다.** 상태를 `Superseded by ADR-XXXX` 로 바꾸고
  새 ADR 을 쓴다. 역사는 append-only.
- 새 ADR 은 [`template.md`](./template.md) 를 복사해서 시작한다.

## 목록

0001–0013 은 2026-07-18 `/grill-me` 세션에서 확정된 마이그레이션의 뼈대 결정이다.
0014 부터는 각 Phase 설계에서 추가된다.

| #                                                            | 결정                                                                 | 상태                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| [0001](./0001-next-app-router.md)                            | 프레임워크 = Next.js (App Router)                                    | Accepted                                                   |
| [0002](./0002-cloudflare-workers-opennext.md)                | 호스팅 = Cloudflare Workers + OpenNext (Pages 기각)                  | Accepted                                                   |
| [0003](./0003-d1-drizzle.md)                                 | DB/ORM = Cloudflare D1 + Drizzle                                     | Accepted                                                   |
| [0004](./0004-trpc-zod.md)                                   | API = tRPC + Zod (타입 계약)                                         | Accepted                                                   |
| [0005](./0005-tailwind-v4-theme-tokens.md)                   | 스타일 = Tailwind v4 @theme + 기존 토큰 승격                         | Accepted                                                   |
| [0006](./0006-chzzk-oauth-jwt-session.md)                    | 인증 = 치지직 커스텀 OAuth → 자체 JWT 세션                           | Accepted                                                   |
| [0007](./0007-single-app-enforced-boundaries.md)             | 구조 = 단일 앱 + 기계 강제 레이어 경계                               | Accepted                                                   |
| [0008](./0008-vitest-workers-playwright.md)                  | 테스트 = Vitest(Workers pool) + Playwright                           | Accepted                                                   |
| [0009](./0009-actions-gate-workers-builds.md)                | CI 게이트 = GitHub Actions (배포는 0016 이 대체)                     | Accepted (게이트만)                                        |
| [0010](./0010-verification-first-jit-abstraction.md)         | 원칙 = 검증 가능성 우선 · JIT 추상화(YAGNI)                          | Accepted                                                   |
| [0011](./0011-keep-index-and-landing-separate.md)            | IA = index/landing 분리 유지 (병합 기각)                             | Accepted                                                   |
| [0012](./0012-role-based-writes-allowlist.md)                | 권한 = allowlist channelId 역할 기반 쓰기                            | Accepted                                                   |
| [0013](./0013-docs-adr-and-agents.md)                        | 문서 = ADR(왜) + AGENTS.md(플레이북)                                 | Accepted                                                   |
| [0014](./0014-v1-data-model-schema.md)                       | 데이터 모델 = users·oauth_accounts·users_roles·games (surrogate PK)  | Accepted (`games` 절은 0019, 삭제 되돌리기는 0020 이 대체) |
| [0015](./0015-chzzk-category-as-game-source.md)              | 게임 정보원 = 치지직 category API (IGDB/GRAC 기각)                   | Accepted                                                   |
| [0016](./0016-deploy-github-actions-opennext.md)             | 배포 = GitHub Actions(OpenNext) · Workers Builds 대체                | Accepted                                                   |
| [0017](./0017-self-session-eddsa-refresh-rotation.md)        | 세션 = 자체 EdDSA access + DB refresh 회전 (인증 라이브러리 미사용)  | Accepted                                                   |
| [0018](./0018-role-audit-and-elevation-guard.md)             | 역할 감사 로그 + 구조적 상승 가드 (관리 UI 없음)                     | Accepted                                                   |
| [0019](./0019-game-state-derived-from-dates.md)              | 게임 상태 = 날짜 두 개에서 유도 (status 컬럼 드롭)                   | Accepted                                                   |
| [0020](./0020-delete-confirm-dialog-replaces-undo-window.md) | 게임 삭제 = 확인 다이얼로그 (지연 커밋 되돌리기 폐기·하드 삭제 유지) | Accepted                                                   |
