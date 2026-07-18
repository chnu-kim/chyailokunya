# chyailokunya

버추얼 스트리머 **챠이로 쿠냐** 팬사이트. Next.js 풀스택(Cloudflare Workers).

> **컷오버 완료(2026-07-19).** `https://chyailokunya.com` 이 정본이고 이 저장소가 서빙한다.
> 열린 건 **apex 뿐이다** — `www` 는 DNS 에 없다(근거는 `wrangler.jsonc` 주석: metadataBase·
> `og:url`·`AUTH_URL` Origin 검증이 한 origin 에 고정돼 있다). 구 정적 사이트
> [`chnu-kim/chyaro-kunya`](https://github.com/chnu-kim/chyaro-kunya) 는 은퇴했다 —
> 소스 보존용으로만 남는다.

## 스택

Next.js (App Router) · [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) (Workers) ·
Cloudflare D1 + Drizzle · tRPC + Zod · Tailwind v4 · 치지직 커스텀 OAuth → **자체 발급 세션**
(EdDSA access 15분 + DB refresh 회전·재사용 감지, authorities 는 인가 순간 DB 조회).
Auth.js/next-auth 같은 인증 라이브러리는 쓰지 않는다
([ADR-0017](./docs/adr/0017-self-session-eddsa-refresh-rotation.md)).

각 선택의 근거는 [`docs/adr/`](./docs/adr/), 작업 규칙은 [`AGENTS.md`](./AGENTS.md).

## 개발

```bash
npm install                # 최초 1회 (npm 11 이면 approve-scripts 로 workerd 등 승인)
npm run db:migrate:local   # 최초 1회 — 로컬 D1 스키마. 없으면 /games 가 500 난다
npm run dev                # http://localhost:3000
npm run build              # 컴파일 + 타입체크 + 정적 생성
npm test                   # Vitest — workerd 안에서 단위 테스트
npm run e2e                # Playwright 동작 스모크 (dev 서버 자동 기동)
npm run preview            # workerd 로 배포 런타임 재현 (opennext build + preview)
```

`db:migrate:local` 과 `next dev` 는 `.wrangler/state` 를 공유한다 — 그래서 한 번 심으면 dev 가
그대로 읽는다. 게임 데이터까지 채우려면 `npm run db:seed -- --local` — 단 시드는 치지직
category API 로 `categoryId` 를 해결하므로 아래 "시크릿"을 먼저 채워야 한다.

3000 이 다른 프로젝트 dev 서버에 막혀 있으면 `PORT=3100 npm run e2e` — `playwright.config.ts` 가
env `PORT` 를 읽는다(기본 3000).

전체 게이트(`format · lint · typecheck · boundaries · unit · build`)와 명령어는
[`AGENTS.md`](./AGENTS.md#검증-빌드테스트린트가-대신-잡아준다) 참고.

## 시크릿

`cp .dev.vars.example .dev.vars` 로 시작하고 값을 채운다. **`.dev.vars` 는 커밋하지 않는다**(gitignore).

- 값의 출처는 1Password Environment **`chyailokunya-prod`**. 프로덕션엔 Cloudflare secret 으로 주입한다.
- 세션 서명 키쌍은 `npm run gen-jwt-keys` 로 만든다 — EdDSA JWK private/public 을 함께 출력한다.
  서명 키(`d` 포함)를 공개 키 자리에 넣지 않는다.
- 타입 정본은 [`src/cloudflare-secrets.d.ts`](./src/cloudflare-secrets.d.ts). `wrangler.jsonc` 에
  없는 런타임 시크릿이라 `cf-typegen` 이 만들어 주지 못한다.
- `AUTH_URL` 은 **origin 만** 적는다. 콜백 경로는 `/api/auth/callback/chzzk` 이고 치지직 콘솔
  등록값과 완전히 일치해야 한다 — 다르면 403.

## 배포

배포 경로는 GitHub Actions 하나뿐이다([ADR-0016](./docs/adr/0016-deploy-github-actions-opennext.md)).
main 에 푸시하면 CI 게이트가 돌고, 그게 초록으로 끝난 뒤 별도 `Deploy` 워크플로
(`.github/workflows/deploy.yml`)가 이 순서로 돈다:

1. `opennextjs-cloudflare build` — 산출물이 buildable 한지 먼저 본다. 여기서 깨지면 D1 을 안 건드린다.
2. `wrangler d1 migrations apply chyailokunya --remote` — 원격 D1 마이그레이션(멱등).
3. `opennextjs-cloudflare deploy` — 재빌드 없이 1번의 산출물을 업로드한다.

**로컬에서 `npm run deploy` 를 직접 돌리지 않는다.** CI 가 검증한 커밋만 나가야 하고, 손으로 올린
워커는 원격 D1 스키마와 어긋날 수 있다.

## 구조

```
src/core          순수 도메인 (HTTP·DB·React 무관)
src/db            Drizzle 스키마 · D1 클라이언트
src/features      유즈케이스 · tRPC 라우터
src/components/ui Radix/shadcn 프리미티브
src/middleware.ts 요청 진입점(세션 갱신) — 위치 고정, 레이어 밖이지만 규칙은 적용된다
src/app           라우트 · 레이아웃 · 조립
src/test          workerd 테스트 셋업 (D1 마이그레이션 적용 등)
docs/adr          아키텍처 결정 기록 (왜)
docs/reference    구 사이트 내부 noindex 페이지 frozen 스냅샷 (앱 라우트가 아니다)
```

의존은 아래로만 흐르고(`ui → features → db → core`) dependency-cruiser 가 CI 에서 강제한다.
