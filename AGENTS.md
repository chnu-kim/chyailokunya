# AGENTS.md

`chyailokunya` 에서 작업하는 코딩 에이전트를 위한 플레이북. **이 파일이 규칙의 정본이고**
`CLAUDE.md` 가 이걸 import 한다. 규칙이 바뀌면 여기만 고친다.

결정의 **"왜"** 는 [`docs/adr/`](./docs/adr/) 에 있다. 규칙(불변식·경계·플레이북)은 여기,
근거는 ADR — 둘을 섞지 않는다([ADR-0013](./docs/adr/0013-docs-adr-and-agents.md)).

## 이 저장소가 무엇인가

버추얼 스트리머 **챠이로 쿠냐** 팬사이트. 정적 사이트(`chnu-kim/chyaro-kunya`)를
**Next.js 풀스택(Cloudflare Workers)** 으로 옮기는 마이그레이션의 결과물이다.

- 배포: Cloudflare Workers. **`https://chyailokunya.com` 라이브**(2026-07-19 apex 연결).
  **서빙하는 origin 은 이 apex 하나뿐이다** — `wrangler.jsonc` 의 `routes` 에 custom_domain
  `chyailokunya.com` 만 있다. **`www` 는 열지 않았다(의도된 설계).** 앱이 절대 URL 을 한 origin
  에 고정하기 때문이다: layout 의 metadataBase·og:image/og:url, 그리고 `AUTH_URL` Origin 검증
  ([ADR-0017](./docs/adr/0017-self-session-eddsa-refresh-rotation.md)). 그래서 `www.` 링크는
  라우트가 없어 죽고, 설령 열더라도 두 origin 이 세션 쿠키·Origin 검증을 갈라 인증까지 물린다 —
  문서·공유 링크엔 apex 만 쓴다. 필요해지면 리다이렉트 규칙으로 apex 에 모은다(근거 주석은
  `wrangler.jsonc` 의 routes 위). 구 정적 사이트(`chnu-kim/chyaro-kunya`)는 **은퇴했다** —
  정본은 `chyailokunya.com` 이다.
- 스택 요약: Next.js App Router · OpenNext(Workers) · D1+Drizzle · tRPC+Zod · Tailwind v4 ·
  치지직 커스텀 OAuth → **자체 발급 세션**(EdDSA access 15분 + DB refresh 회전·재사용 감지,
  authorities 는 세션에 안 싣고 인가 순간 DB 조회 —
  [ADR-0017](./docs/adr/0017-self-session-eddsa-refresh-rotation.md)).
  각 선택의 근거는 [ADR-0001~0018](./docs/adr/).
- **v1 정박점:** 공용 게임 보드 + 역할 기반 쓰기. 읽기는 공개, 쓰기는 전원 치지직 로그인 위에
  **`users_roles` M:N grant + authority 검사**다 — 역할 행이 없으면 member(빈 권한)라 로그인만으로는
  못 쓰고, 상승 역할 `admin`/`superadmin` 이 `game:write`·`game:delete`(superadmin 은 `role:manage`
  까지)를 갖는다. 최초 superadmin 은 `SUPERADMIN_CHANNEL_ID` 부트스트랩으로만 생긴다
  ([ADR-0012](./docs/adr/0012-role-based-writes-allowlist.md)·[ADR-0014](./docs/adr/0014-v1-data-model-schema.md)·[ADR-0018](./docs/adr/0018-role-audit-and-elevation-guard.md)).
  **로그인한 팬에게도 할 수 있는 일이 하나 있다 — 게임 수정·추가 제안**이다
  ([ADR-0025](./docs/adr/0025-fan-suggestions.md)). 제안은 authority 가 아니라 **로그인만**
  요구하고(`authenticatedProcedure`), member 역할 행을 만들지 않는다 — 모든 로그인 사용자가
  가지는 권한은 "로그인했나"와 같은 말이라 저장할 것이 없다. 제안은 게임을 **안 바꾼다**:
  관리자가 제안함에서 보고 기존 수정·추가 폼으로 반영하므로 games 쓰기 경로는 그대로 하나다.

## 검증 (빌드·테스트·린트가 대신 잡아준다)

정적 사이트 시절과 달리 이제 **기계가 검증한다.** 로컬에서 게이트를 그대로 돌릴 수 있다:

```bash
npm run dev            # 로컬 개발 (http://localhost:3000)
npm run build          # next build (컴파일 + 타입체크 + 정적 생성)
npm test               # Vitest — workerd 안에서 단위 테스트
npm run typecheck      # tsc --noEmit (strict)
npm run lint           # eslint (flat config)
npm run boundaries     # dependency-cruiser 레이어 경계
npm run format:check   # prettier
npm run e2e            # Playwright 동작 스모크 (dev 서버 자동 기동, --project=smoke)
npm run e2e:visual     # 시각 스냅샷 회귀 (로컬 dev 베이스라인)
npm run e2e:visual:update  # 시각 베이스라인 재생성

npm run preview        # opennextjs-cloudflare build + workerd 로 배포 런타임 재현
npm run cf-typegen     # wrangler.jsonc 변경 후 cloudflare-env.d.ts 재생성

npm run gen-jwt-keys   # 세션 서명용 EdDSA JWK 쌍 생성(ADR-0017)
npm run db:generate    # 스키마 변경 → drizzle 마이그레이션 생성
npm run db:migrate:local     # 로컬 D1 에 마이그레이션 적용
npm run db:migrate:remote    # 원격 D1 에 적용(배포 워크플로가 자동으로도 돌린다)
npm run db:seed        # 게임 시드(`-- --remote` 로 원격)
```

3000 이 남의 dev 서버로 막혀 있으면 `PORT=3100 npm run e2e` — playwright.config 가 env PORT
를 읽는다(기본 3000, CI 는 그대로). 단 **남의 dev 서버를 재사용하면 로그인 상태 테스트는
깨진다** — 그 서버는 e2e 세션 키를 안 읽었다(아래 지뢰). 실패 메시지가 그렇게 말해 준다.

로그인 상태가 필요한 스펙은 `e2e/session.ts` 의 `signIn(context, baseURL)` 로 세션을 심고
`expectSignedIn(page)` 로 세션이 섰는지 먼저 못박는다(안 하면 비로그인으로 조용히 통과한다).
치지직 OAuth 를 태우지 않고 access 쿠키를 직접 서명하지만 진짜 서버 경로가 돈다 —
근거와 함정은 [ADR-0021](./docs/adr/0021-e2e-session-fixture-signed-access-cookie.md).

CI(`.github/workflows/ci.yml`)가 PR·main 에서 `format · lint · typecheck · boundaries · unit ·
drizzle-kit check · build · **배포 빌드(opennextjs-cloudflare)**` 게이트와 **e2e 스모크**(별도
job)를 돌린다. 배포 빌드가 게이트에 있는 이유는 아래 Phase 4 지뢰를 보라 — `next build` 만으론
배포 실패를 못 잡는다. **시각 스냅샷은 CI 에 없다** —
베이스라인이 OS 별 파일이라(`-darwin`/`-linux`) macOS 에서 만든 게 리눅스 CI 와 안 맞기
때문이다. `npm run e2e`(=`--project=smoke`)는 크로스플랫폼 동작 검증만 하고, 시각 회귀
(`--project=visual`)는 로컬 dev 회귀 + 사람의 육안 패리티 판단용이다. 배포는 CI 게이트가 아니라
**별도 GitHub Actions `Deploy` 워크플로**(`.github/workflows/deploy.yml`)가 CI 성공 후 main 에서 맡는다
— 원격 D1 마이그레이션 적용 → OpenNext 배포([ADR-0009](./docs/adr/0009-actions-gate-workers-builds.md)
게이트 + [ADR-0016](./docs/adr/0016-deploy-github-actions-opennext.md) 배포).

## 아키텍처 맵

단일 Next 앱. 의존은 **아래로만** 흐르고 dependency-cruiser 가 기계 강제한다
([ADR-0007](./docs/adr/0007-single-app-enforced-boundaries.md)):

```
src/components/ui  →  src/features  →  src/db  →  src/core
                          (app/ 는 조립 지점 — 어디든 쓸 수 있다)
```

| 레이어              | 책임                                  | 의존 가능                |
| ------------------- | ------------------------------------- | ------------------------ |
| `src/core`          | 순수 도메인 로직. HTTP·DB·React 무관. | (없음)                   |
| `src/db`            | Drizzle 스키마·D1 클라이언트.         | `core`                   |
| `src/features`      | 유즈케이스·tRPC 라우터·서비스.        | `db`, `core`             |
| `src/components/ui` | Radix/shadcn 프리미티브.              | `features`               |
| `src/middleware.ts` | 요청 진입점(세션 갱신). 위치 고정.    | `db`, `core`, `features` |
| `src/app`           | 라우트·레이아웃·조립.                 | 전부                     |

위로 새는 import 는 `npm run boundaries` 가 error 로 죽인다. 경로 규칙이 "이 코드가 어디
속하나"의 정본이다. `src/middleware.ts` 는 위치가 루트로 고정돼 레이어 디렉터리 밖에 있지만
규칙은 따로 명시해 뒀다(`middleware-below-ui`) — 매 요청 도는 코드라 컴포넌트·app 을 끌어오면
안 된다.

## 스타일 구성 (Phase 2 이식)

색·타입 토큰의 정본은 `src/app/globals.css`(`:root`/`[data-theme]` 변수 + `@theme`/`@theme
inline`). 그 위 스크랩북 크롬·페이지 CSS 는 손으로 튜닝한 값과 "왜 이 값인가" 주석이 촘촘해
유틸리티로 다시 쓰지 않고 **평범한 전역 CSS 로 이식했다**:

- `src/app/chrome.css` — nav·푸터·테마 토글·버튼·칩·테이프·클립·폴라로이드 등 공유 크롬. layout 이 import.
- `src/app/{home,landing/landing,games/games}.css` — 페이지 전용, 해당 page 가 import.

이 CSS 는 **unlayered**(cascade layer 밖)라 Tailwind 유틸리티(`@layer utilities`)를 이긴다 —
클래스 기반 크롬이 유틸리티에 조용히 안 덮인다. 토큰은 `var(--token)` 으로 직접 읽는다(불변식 6 의
"유틸리티로만"은 **새 유틸리티 클래스**를 짤 때의 규칙이고, 이식한 CSS 는 var() 로 토큰을 읽는다 —
어느 쪽이든 핵심은 생 hex 를 새로 안 쓰는 것). 크롬을 고칠 땐 유틸리티로 재작성하지 말고
`chrome.css`/페이지 CSS 를 고친다.

## Feature 추가 플레이북

1. **도메인부터.** 순수 로직은 `src/core` 에. 여기서 단위 테스트(`*.test.ts`)로 못박는다 —
   workerd 안에서 돈다.
2. **데이터는 `src/db`.** Drizzle 스키마를 바꾸면 마이그레이션을 만들고, `wrangler.jsonc`
   바인딩을 갱신한 뒤 `npm run cf-typegen`.
3. **유즈케이스는 `src/features`.** tRPC 프로시저 + Zod 입력 스키마. 입력은 신뢰하지 않는다 —
   Zod 경계를 반드시 통과시킨다. 쓰기라면 서버에서 역할 인가
   ([ADR-0012](./docs/adr/0012-role-based-writes-allowlist.md)).
4. **UI 는 `src/components/ui`·`src/app`.** 프리미티브는 features 를 쓰되 db/core 를 직접
   건드리지 않는다.
5. **검증.** `npm run typecheck && npm run lint && npm run boundaries && npm test && npm run build`.
   시각 변경이면 Playwright 스냅샷.
6. 굵직한 아키텍처 결정을 했으면 **ADR 을 추가**한다(`docs/adr/template.md` 복사).

**페이지(라우트)를 추가한다면** `src/features/routes.ts` 를 고친다 — 거기가 nav 링크와 로그인
복귀 허용목록의 공동 정본이다. `src/app` 에 `page.tsx` 만 만들고 이 파일을 안 고치면 게이트는
전부 초록인데 **그 페이지에서 로그인한 사람만 조용히 `/` 로 떨어진다**(이슈 #25 가 고친 증상이
그대로 재발). 기계가 못 잡는 자리라 규칙으로 적어 둔다.

## 불변식 (협상 대상 아님)

1. **레이어 경계는 아래로만.** 위로 새는 import 금지 — CI 가 강제한다.
2. **입력은 신뢰하지 않는다.** 클라이언트·localStorage·OAuth 콜백은 Zod 로 검증한 뒤 쓴다.
3. **쓰기 인가는 서버가 정본.** UI 버튼 숨김은 편의일 뿐. 진짜 방어선은 tRPC 뮤테이션의
   역할 검사다.
4. **비밀은 저장소에 두지 않는다.** `CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET`·`JWT_SIGNING_JWK`·
   `JWT_PUBLIC_JWK`·`SUPERADMIN_CHANNEL_ID`·`AUTH_URL` 은 Cloudflare secret / 1Password
   Environment 로만 주입한다(정본은 `src/cloudflare-secrets.d.ts`). `.dev.vars` 는 gitignore.
   JWK 쌍은 `npm run gen-jwt-keys` 로 만든다 — 서명 키(`d` 포함)를 공개 키 자리에 넣지 않는다.
5. **채널은 3개뿐 — 디스코드는 없다.** 치지직·유튜브·X. 디스코드 링크·아이콘·언급을 만들지
   않는다(구 사이트에서 실제로 지웠던 플레이스홀더다).
6. **디자인 토큰이 색·타입의 정본.** 생 hex 금지. `globals.css` 의 CSS 변수 → Tailwind
   `@theme`/`@theme inline` 유틸리티로만 참조([ADR-0005](./docs/adr/0005-tailwind-v4-theme-tokens.md)).
7. **index/landing 분리 유지.** 병합은 사용자가 기각했다 — 에이전트가 뒤집지 않는다.
8. **장식은 인라인 SVG.** 이모지 아이콘(✨🚀🎯) 금지. 미니멀 블랙 모티프 SVG.
9. **이미지는 사용자가 제공한다.** 생성하지 말고 필요 목록을 정리해 요청한다.
10. **콜백 경로는 `/api/auth/callback/chzzk` 로 고정.** `AUTH_URL` 은 **origin 만** 담고
    (`https://chyailokunya.com`) 콜백 URL 은 코드가 `${AUTH_URL}/api/auth/callback/chzzk` 로
    조립한다 — 시크릿에 경로가 섞여 들어가면 조립이 깨진다. 이 경로는 **치지직 콘솔에 등록된
    redirect URI 와 완전히 일치해야 한다 — 다르면 403** 이다. 라우트를 옮기거나 origin 을
    바꿀 땐 치지직 콘솔 등록값을 같이 옮긴다
    ([ADR-0017](./docs/adr/0017-self-session-eddsa-refresh-rotation.md)).

## 이 스택에서 실제로 밟은 지뢰

Phase 1 스캐폴딩에서 실제로 터진 것들. 같은 실수를 반복하지 않기 위한 목록이다.

- **`@theme` vs `@theme inline` 을 틀리면 테마 플립이 조용히 죽는다.** 라이트/다크로 바뀌는
  색은 반드시 `@theme inline { --color-x: var(--x) }` — 그래야 유틸리티가 `var(--x)` 를
  그대로 emit 해 `data-theme` 전환을 따라간다. 정적 스케일(타입·간격·라운드)만 일반 `@theme`.
- **`@cloudflare/vitest-pool-workers` 는 v0.18(Vitest 4)에서 API 가 바뀌었다.**
  `defineWorkersConfig`/`@cloudflare/vitest-pool-workers/config` 는 사라졌다. 이제
  `cloudflareTest(옵션)` 플러그인을 `plugins` 에 넣고 `defineConfig` 는 `vitest/config` 에서
  가져온다. 예전 `poolOptions.workers` 내용이 그대로 `cloudflareTest()` 인자가 된다.
- **eslint-config-next(v16)는 네이티브 flat config 배열을 기본 export 한다.** FlatCompat 로
  감싸면 ESLint 9 에서 "Converting circular structure to JSON" 로 죽는다. `import next from
"eslint-config-next"; export default [..., ...next]` 로 그대로 spread 한다.
- **effect 안 동기 setState 는 Next 16 의 `react-hooks/set-state-in-effect` error 다.** DOM
  같은 외부 상태를 읽어 반영할 땐 `useSyncExternalStore` 를 쓴다(테마 토글이 그 예).
- **npm 11 은 install 스크립트를 게이팅한다.** workerd·esbuild·sharp postinstall 이 안 돌면
  바이너리가 없어 build 가 깨진다. 승인은 `npm approve-scripts <pkg>` 로 하고, 그 결과가
  `package.json` 의 `allowScripts` 에 지속돼 CI 의 `npm ci` 도 동일하게 재현한다.
- **`next-env.d.ts`·`cloudflare-env.d.ts` 는 생성물이지만 커밋한다.** 그래야 CI 의 typecheck
  단계가 `next build`/`cf-typegen` 을 선행하지 않고도 성립한다. 대신 lint·prettier 대상에선
  제외한다.
- **`pipe | tail` 은 exit code 를 가린다.** `npm run lint 2>&1 | tail` 뒤의 `$?` 는 tail 의
  것이라 항상 0. 게이트 통과를 확인할 땐 파이프 없이 exit code 를 직접 본다.
- **origin 이 SSH 면 푸시가 키 주인 명의로 나간다.** 이 머신엔 GitHub 계정이 둘 있고 저장소
  소유자(`chnu-kim`)가 SSH 키 주인이 아닐 수 있다. remote 를 HTTPS 로 두고 해당 푸시에만
  `git -c credential.helper='!gh auth git-credential' push` 로 자격증명을 적용한다 —
  전역 git 설정은 건드리지 않는다.

Phase 2(정적 콘텐츠 이식)에서 밟은 것들:

- **localStorage 는 외부 스토어다 — 마운트 로드를 effect+setState 로 하면 위 set-state-in-effect
  지뢰에 걸린다.** 게임 보드가 한때 `games-store.ts`(모듈 싱글턴 + `useSyncExternalStore`)를 쓴
  이유가 이것이다. **Phase 3 에서 목록의 정본이 D1 로 옮겨가며 그 파일은 사라졌다** — 지금 보드는
  서버 컴포넌트가 읽어 props 로 넘기고 클라이언트는 `useState` 로 필터·쓰기만 한다. 지뢰 자체는
  유효하니, 앞으로 브라우저 저장소를 다시 붙일 땐 같은 패턴으로 돌아온다.
- **`@next/next/no-img-element` 를 껐다.** 이 사이트 이미지는 사용자가 준 정적 팬아트고 Workers 엔
  Next 이미지 옵티마이저 로더가 없어 `next/image` 가 이득이 없다 — 평범한 `<img>` + width/height 로
  CLS 만 막는다(`eslint.config.mjs` 에 근거 주석).
- **`playwright.config.ts` 도 typecheck·build 대상이다.** tsconfig `include` 가 `**/*.ts` 라 config 의
  잘못된 옵션이 `next build` 를 깬다(실측: project-level `use.reducedMotion` 을 이 버전 타입이 거부).
  reduced-motion 은 스펙 안 `page.emulateMedia` 로 켠다.
- **내부 noindex 3종은 `docs/reference/` 에 frozen 스냅샷으로 보존한다.** 앱 라우트가 아니다 —
  구 `css/site.css`·`js/site.js` 사본과 함께 얼려 자체 완결적으로 열린다(`og-cover.html` 캡처 용도).
  prettier·eslint 대상에서 제외한다.

Phase 3(DB·도메인 코어)에서 밟은 것들:

- **vitest 워커 풀은 tsconfig 의 `paths`(`@/*`)를 안 읽는다.** `@/core`·`@/db` 를 import 하는
  모듈이 테스트에서 "Cannot find package" 로 죽는다 — `vitest.config` 의 `resolve.alias` 로 `@`
  를 `./src` 에 직접 매핑한다. (drizzle-kit 은 tsx 라 `@/` 를 읽지만 워커 풀은 아니다.)
- **`@cloudflare/vitest-pool-workers@0.18` 엔 `isolatedStorage` 옵션이 없다.** 테스트 간 D1
  쓰기가 자동으로 안 되돌려져 데이터가 누적된다(UNIQUE 충돌·개수 어긋남). setupFiles 의 전역
  `beforeEach` 로 테이블 데이터만 비운다(스키마는 `applyD1Migrations` 가 세운 채 유지, FK 순서로
  자식부터 삭제). 마이그레이션은 `readD1Migrations`(설정 사이드)→`TEST_MIGRATIONS` 바인딩→setup 의
  `applyD1Migrations` 로 각 파일에 적용한다.
- **drizzle 은 D1 에러를 `DrizzleQueryError` 로 감싼다.** "UNIQUE constraint failed" 는 최상위
  `e.message` 가 아니라 `e.cause` 에 있다 — cause 체인을 끝까지 훑어야 CONFLICT 로 맵된다.
- **치지직 category API 는 client_credentials 를 `Client-Id`/`Client-Secret` 헤더로 받는다**(별도
  토큰 교환 없음, 실측). `BASE_URL=https://openapi.chzzk.naver.com`, 응답은
  `{code:200, message, content:{data:[...]}}`. `POST /auth/v1/token` 은 이거 말고 사용자
  OAuth(authorization_code, Phase 4)용이다.
- **`getCloudflareContext()`(RSC·dev)와 `wrangler d1 … --local` 은 `.wrangler/state` 를 공유한다.**
  그래서 `db:migrate:local` + `db:seed -- --local` 로 심으면 `next dev` 가 그대로 읽는다. 반대로
  로컬 D1 에 스키마가 없으면 games 페이지가 500 난다 — e2e 는 `globalSetup` 이 `--local` 로
  마이그레이트 + 결정적 픽스처(`e2e/fixtures/games.sql`, poster null)를 심는다.
- **e2e 포트 3000 이 남의 dev 서버로 막히면 `reuseExistingServer` 가 그걸 재사용해 멈춘다.** 이
  머신은 다른 프로젝트가 3000 을 쓴다 — `PORT=3100 npm run e2e` 로 빈 포트에 우리 서버를 띄운다
  (기본값 3000 은 `playwright.config.ts` 가 정본이고, 그 파일 주석도 3100 을 가리킨다).

Phase 4(인증)에서 밟은 것:

- **`npm run build` 가 통과해도 배포는 깨질 수 있다 — 게이트가 `next build` 만 돌린다.**
  Next 16 이 `middleware.ts` 를 `proxy.ts` 로 바꾸며 Node 런타임 전용으로 만들었는데
  `@opennextjs/cloudflare` 는 Node 미들웨어를 거부한다("Node.js middleware is not currently
  supported"). proxy 를 엣지로 돌릴 수도 없다("Proxy does not support Edge runtime").
  **로컬·CI 게이트는 전부 초록인데 배포에서만 터졌다.** 그래서 이 저장소는 구 규약
  `src/middleware.ts` 를 쓴다(deprecation 경고 감수). OpenNext 가 Node proxy 를 지원하면 옮긴다.
  일반화하면: **런타임·번들러 계약을 건드리는 변경은 `npx opennextjs-cloudflare build` 로
  확인한다.** CI 게이트에 이 빌드가 들어 있다(`배포 빌드` 스텝).

- **`wrangler.jsonc` 에 `env.*` 섹션을 추가하면 e2e 가 통째로 죽는다.** e2e 는 dev 서버에
  테스트 세션 키를 먹이려고 환경명 `e2e` 를 쓰는데([ADR-0021](./docs/adr/0021-e2e-session-fixture-signed-access-cookie.md)),
  정의되지 않은 환경명을 wrangler 가 **경고로 넘기는 건 그 파일에 `env` 키가 하나도 없을 때뿐**
  이다. 아무 env 섹션이나 생기면 같은 상황이 에러로 승격돼 dev 서버가 안 뜨고, Playwright 엔
  "webServer 가 안 떴다"로만 보인다. `env.e2e` 를 만들어 막으려 하지 마라 — 환경은
  `d1_databases` 를 상속하지 않아 DB 바인딩이 사라진다. 경고 주석이 `wrangler.jsonc` 본문에 있다.
  로그인 상태 e2e 의 나머지 배선(왜 process.env 로는 안 되는지, 왜 webServer 커맨드에서
  심는지, 왜 `https://localhost` url 인지)은 전부 ADR-0021 에 있다.

주간 일정(#56, 일정 정본 도입)에서 밟은 것들:

- **마이그레이션 이관을 스크래치 sqlite CLI 로만 검증하면 트랜잭션 의존 결함을 놓친다 —
  하마터면 프로덕션 데이터가 소실될 뻔했다.** 0007 이 `games` 를 재생성하며(SQLite 는 컬럼 드롭이
  없다) 옛 `played_at` 을 `schedule_entries` 로 이관하는데, 초판은 자식 행을 먼저 채운 뒤
  `PRAGMA foreign_keys=OFF` 로 `DROP TABLE games` 의 `ON DELETE SET NULL` 을 막으려 했다. **그
  pragma 는 pending BEGIN 이 있으면 무시된다**(SQLite 명세) — 러너가 마이그레이션을 트랜잭션으로
  감싸면 DROP 이 SET NULL 을 발동시켜 방금 이관한 `game_id` 가 전부 NULL 이 돼 **과거 플레이
  날짜가 통째로 사라진다**(결정 16 "손실 0"이 깨진다). `sqlite3` CLI 는 자동커밋이라 pragma 가
  먹어 통과하므로 그 차이가 가려졌다(실측: 자동커밋 `game_id=1` · 트랜잭션 `game_id=NULL`).
  그래서 **자식 행을 부모 재생성 전에 만들지 말고**(FK 없는 임시 테이블로 옮긴 뒤 재생성하고
  자식은 그다음에 되채운다), 이관 검증은 `BEGIN…COMMIT` 안에서 재생한다. `e2e/migration-0007.spec.ts`
  가 그 회귀를 못박는다(`node:sqlite`, `foreign_keys=ON`, 트랜잭션 안 — 옛 순서로 되돌리면
  빨개진다). 게이트 8종이 전부 초록이어도 이건 안 잡힌다 — 적대적 리뷰가 잡았다.

- **상태를 바꾸는 tRPC 뮤테이션 e2e 는 `.dev.vars.e2e` 에 `AUTH_URL` 이 있어야 통과한다.**
  `rejectForeignOrigin`(CSRF, fail-closed)이 요청 Origin 을 `AUTH_URL` 과 **정확히(포트 포함)**
  대조하는데(`isAllowedOrigin` = `URL.origin` 완전 일치), e2e 환경은 공개 읽기만 하던 시절
  AUTH_URL 을 안 넣었다. 그래서 저장소 **첫 쓰기 e2e**(일정 저장)가 403 "forbidden origin" 으로
  걸렸다. `scripts/e2e-dev-vars.mjs` 가 이제 `AUTH_URL=http://localhost:PORT` 를 넣고, 재사용 시에도
  그 줄만 현재 포트로 맞춘다(키는 보존 — 살아 있는 서버의 검증을 안 흔든다). 포트를 바꿔 돌려도
  스크립트가 자가 치유한다.

게임 보드 개편(#61 이후, ADR-0023)에서 밟은 것들:

- **`-webkit-box`(line-clamp)는 자식을 blockify 해서, 안에 요소를 하나 넣는 순간 말줄임이 조용히
  죽는다.** 카드 제목을 버튼으로 감쌌더니 `-webkit-line-clamp: 2` 가 통째로 무력화돼 3줄짜리
  이름 한 장이 보드의 그 행 전체를 부풀렸다. 옛 flexbox 라 `display:inline` 을 줘도 자식이
  blockify 되어 한 덩어리가 된다(실측: h3 의 computed display 가 `-webkit-box` 가 아니라
  `flow-root`, 버튼은 `inline-block`, 3줄 높이 72px 그대로). **clamp 는 텍스트를 직접 담은 잎
  요소에 건다** — 감싸는 요소가 생기면 clamp 를 안쪽으로 옮긴다. 그리고 clamp 에 필요한
  `overflow:hidden` 은 그 요소의 `::after` 도 자르므로, 오버레이로 히트 영역을 넓히는 부품과는
  같은 요소에 못 둔다(카드 전체 클릭이 글자 상자로 쪼그라든다).

- **e2e 에서 `scrollIntoView` 는 `behavior:"instant"` 를 명시해야 한다.** 사이트가
  `scroll-behavior: smooth` 를 켜 두고 있어 기본값이면 스크롤이 애니메이션으로 진행되고, 곧바로
  좌표를 읽으면 **스크롤 전 위치**가 잡힌다(실측: 390px 에서 카드 top 이 541 그대로라 아래쪽이
  뷰포트 800 밖 → `elementFromPoint` 가 통째로 null). 히트테스트는 뷰포트 좌표를 받으므로 이
  차이가 "요소가 없다"로 보인다.

- **회전한 카드의 네 모서리는 카드 밖이다.** `.game` 은 `--rest-rot` 로 기울어
  `getBoundingClientRect` 가 회전 AABB 를 주는데, 그 모서리 안쪽 몇 px 은 실제 카드 영역이
  아니다. 히트테스트로 "카드 전체가 눌리는가"를 볼 땐 **세로 중심선 위**에서만 찍는다 —
  회전 중심이 카드 중심이라 그 선 위의 점만 각도와 무관하게 안이 보장된다.

- **`flex: 1 1 200px` 을 세로 flex 컨테이너 안에서 쓰면 그 200px 이 세로 기본 크기가 된다.**
  가로로 나란히 세우던 시절의 필드가 `.clearfields`(세로 flex) 안에 들어가자 grow:1 이 남는
  높이까지 먹어 폼 아래로 빈 종이가 ~180px 벌어졌다(실측). 방향이 바뀌는 컨테이너에 들어갈
  부품엔 flex 단축을 남겨 두지 않는다.

- **D1 은 대화형 트랜잭션이 없어(`batch()` 만 원자적) "조건부 CAS + 원자적 전체 교체"를 완벽히
  못 만든다.** batch 안에서 앞 문의 rowcount 로 뒤 문을 조건부로 건너뛸 수 없어서, 낙관적 동시성이
  필요한 쓰기(일정 주 단위 일괄 저장, 결정 14)에서 설계가 한 구멍을 다른 구멍으로 옮긴다(경합 →
  발행 경계 → sub-ms gap). 완벽을 쫓지 말고 **현실적 사고(분 단위 stale 저장)를 막는 선에서 수용
  경계를 긋고**, 남는 gap 은 코드 주석에 "알고 수용한 한계"로 명시한다(`saveWeek` 주석 참고 —
  이론적 sub-ms 경합은 2026-07-24 사용자 결정으로 수용). D1 에서 원자성이 필요한 새 쓰기를 짤 땐
  이 벽을 먼저 떠올린다.

발행 경계 재설계(#64, ADR-0024)에서 밟은 것들:

- **"행의 부재"를 도메인 상태로 쓰면 그 행이 필요한 다른 이유가 생기는 순간 겸직이 터진다.**
  `schedule_weeks` 행 없음이 "이관된 과거 아카이브"를 뜻했는데, 그 행은 동시에 낙관적 동시성
  (revision)의 자리이기도 했다 — CAS 때문에 행을 만드는 순간 도메인 상태가 딸려 와, 게임 폼의
  연결 해제가 그 주를 통째로 공개했다(#64). 고친 방법은 **기본값이 부재와 같은 뜻이 되게** 컬럼을
  두는 것이다(`draft` DEFAULT 0 + `coalesce(w.draft, 0)`): 그러면 행을 언제 만들든 도메인이 안
  흔들려 청구가 부작용 없는 연산이 된다. 부재를 상태로 쓸 땐 "이 행이 다른 이유로 필요해질 수
  있나"를 먼저 묻는다.

- **drizzle-kit 이 CHECK 추가로 테이블을 재생성하면, 이관문이 옛 테이블에서 새 컬럼을 읽으려
  한다.** 0008 초판이 `SELECT ... "draft" ... FROM schedule_weeks` 를 냈는데 그 시점 옛 테이블엔
  draft 가 없어 `no such column` 으로 죽는다 — **로컬 게이트는 전부 초록이다**(마이그레이션을
  안 돌리므로). 컬럼을 더하는 마이그레이션은 생성물의 INSERT…SELECT 를 반드시 열어 보고, 새 컬럼
  자리에 유도식을 손으로 넣는다. 회귀는 `e2e/migration-0008.spec.ts` 가 `node:sqlite` 로 재생해
  잡는다(0007 스펙과 같은 자리·같은 이유).

- **마이그레이션이 "화면을 안 바꾼다"는 주장은 문장이 아니라 쿼리로 증명한다.** 0008 스펙은 옛
  규칙과 새 규칙을 마이그레이션 **전후에 각각** 돌려 같은 집합이 나오는지 대조한다 — 유도식을
  잘못 짜면(예: `draft = 1` 을 전부에 박으면) 단위 테스트는 새 규칙만 보므로 통과하는데 이
  대조는 빨개진다.

콤보박스·모달 히스토리(PR #67)에서 밟은 것들:

- **히스토리 엔트리는 "있다"와 "지금 자리다"가 다르다 — 안 가르면 버려진 엔트리를 다음 모달이
  물려받는다.** 모달을 연 채 그 안의 링크로 떠나면 우리가 쌓은 엔트리는 되돌려지지 않고 남는데
  (언마운트에서 `back()` 을 부르면 이탈 자체를 무르므로 안 부른다), 그 엔트리는 이제 **현재보다
  뒤에** 있다. 돌아와 모달을 다시 열 때 "이미 엔트리가 있다"며 안 쌓으면, 뒤로가기가 페이지를
  떠나는데 컨트롤러는 그걸 자기 엔트리로 알고 모달을 닫는다 — **뒤로가기가 모달만 닫는다는
  약속이 정확히 거기서 깨진다.** `history.state` 에 토큰 표식을 박고 현재가 정말 우리 것인지
  확인해야 한다(`game-dialog.tsx` 의 `ENTRY_MARK`). 표식은 딥링크가 아니다 — "모달이 쌓은
  엔트리"라는 사실뿐이라 새로고침 뒤 아무것도 복원하지 않는다.

- **`history.back()` 은 비동기 브라우저 왕복이라 호출과 popstate 사이에 창이 있다.** 그 사이
  새 모달이 엔트리를 또 쌓으면 늦게 온 popstate 를 그 창이 자기 것으로 알고 닫는다 — 저사양
  폰(CPU 20배 스로틀)에서 0~90ms 로 벌어지고 4배에선 20ms 미만이라 사람이 못 만든다. 엔트리
  상태를 불리언이 아니라 **셋**(`none`/`live`/`popping`)으로 둬야 "엔트리가 있나"와 "되돌리는
  중인가"가 갈린다. **경합 e2e 는 스로틀이 필수다** — 안 조이면 옛 코드도 통과한다(실측).

- **뒤로가기 판정이 읽는 가드 값은 `useLayoutEffect` 로 갱신한다.** 평범한 effect 는 passive 라
  커밋 뒤 늦게 도는데, 그 사이 도착한 뒤로가기는 옛 값을 읽는다 — 게임을 고른(dirty 가 참이 된)
  직후의 제스처가 미저장 확인을 건너뛰고, 수정 모달이 열린(covered 가 참이 된) 직후의 제스처가
  아래 상세를 닫는다. **잠금을 세우려고 만든 배선이 그 순간만 안 잠긴다.**

- **`inert` 는 히트테스트·포커스만 막고 프로그램적 `click()` 은 그대로 디스패치된다.** 모달이
  열려 배경이 inert 인 동안 사람은 nav 를 못 누르지만, `page.evaluate(() => link.click())` 은
  통한다 — "모달을 연 채 클라이언트 네비게이션으로 떠났다"는 상태를 e2e 로 만드는 유일한 길이다
  (`page.goto` 는 문서를 새로 로드해 컨트롤러 상태까지 초기화하므로 그 경로를 못 만든다).

- **`End` 키의 캐럿 이동은 헤드리스에서 간헐적이다.** `Home` 직후 `End` 를 누르면 캐럿이 안
  움직이고 `expect.poll` 로 기다려도 그대로다(사이에 다른 키를 끼우면 옮겨진다 — 실측).
  `Home` 은 정상이라 **두 키가 같은 코드 경로를 타면 `Home` 하나로 계약을 증명하고** `End` 는
  부수효과(커서 해제)만 본다. 억지로 재면 앱 결함이 아닌 이유로 간헐 실패한다.

- **편집형 콤보박스에서 `Home`/`End` 를 목록 이동으로 가로채면 안 된다.** W3C APG 는 이 둘을
  Textbox 키로 못박고(`beginning`/`end of the field`) **Listbox Popup 표에는 넣지 않는다** —
  팝업이 열려 있어도 textbox 소관이라는 뜻이다. 가로채면 결과가 뜬 순간부터 검색어 앞뒤로
  캐럿을 못 옮겨, 접근성을 고치려는 변경이 다른 접근성을 깬다. 함께 정의된 "visual focus 를
  textbox 로 되돌린다"가 커서 해제에 해당한다.

팬 제안(ADR-0025)에서 밟은 것들:

- **보드를 안 바꾸는 쓰기는 성공 신호가 하나도 없다 — 화면이 직접 말해야 한다.** 저장 폼들은
  보드가 바뀌는 것이 곧 영수증이라 성공하면 모달을 닫아도 됐는데, 제안은 관리자가 반영해야
  바뀌므로 같은 규약을 쓰면 **모달이 사라진 것 말고 아무 일도 안 일어난다.** 팬은 실패로 읽고
  다시 보내고, 게임당 미처리 하나 제약에 걸려 "이미 보낸 제안이 있어요"를 만난다. 라이브 영역
  (`role="status"`)은 대안이 못 된다 — 모달이 열려 있는 동안 바깥은 inert 라 애초에 안 읽힌다.
  그래서 제안 폼은 닫지 않고 **성공 화면으로 바뀐다**(`suggest-dialog.tsx`).

- **`getByRole("alert")` 는 Next 의 라우트 announcer 를 먼저 잡는다.** App Router 가
  `#__next-route-announcer__`(빈 div, 같은 role)를 항상 DOM 에 두기 때문에, 우리 오류 문구를
  재려던 단언이 빈 문자열을 보고 타임아웃한다. 에러 자리를 잴 땐 그 모달 안으로 스코프를
  좁힌다(`[data-od-id='…'] .err`).

- **`narrow-body.spec.ts` 의 터치 타깃 검사는 셀렉터를 손으로 열거한다.** 새 조작을 더해도
  **자동으로 안 잡힌다** — 게이트가 전부 초록인데 그 버튼만 검사 밖이다. 본문에 인터랙티브
  요소를 더했으면 그 스펙에 같이 적는다. 그리고 신원이 갈리는 조작(관리자 전용·팬 전용)은
  한 세션으로 못 재므로 세션을 바꿔 가며 잰다(`E2E_FAN`).

- **"팬이 보는 값"과 "관리자 폼이 읽는 값"이 다른 기준이면, 스냅샷을 그대로 옮기는 순간 지시가
  뒤집힌다.** 보드의 `lastPlayed` 는 발행된 항목만 세고 게임 폼의 `playDates` 는 초안까지 센다.
  그래서 초안 주에 항목이 있는 게임은 팬 화면에 "기록 없음"이고, 클리어만 알려 주려는 제안이
  `playedDate: null` 을 싣는다 — 그 null 을 폼에 채우면 **팬이 못 본 날짜를 지우라는 지시**가
  되어 저장이 초안 항목의 연결을 끊는다. 화면에도 아무 신호가 없다. 값을 한 화면에서 다른
  화면으로 옮길 땐 **두 화면이 같은 기준으로 그 값을 얻는지** 먼저 확인한다(발행 경계가 이
  저장소에서 기준을 가르는 대표적인 축이다).

- **폼 값을 "비우는" 리셋은 출발점이 빈 값이 아닐 때 데이터를 지운다.** 컴포저는 다른 게임을
  고를 때 입력을 되돌리는데(이전 게임 값이 따라가면 안 된다) 그게 무조건 `""` 로 비우는
  구현이었다. 팬의 추가 요청을 반영하려고 **제안 값으로 열린** 컴포저에선 검색 결과를 고르는
  순간 그 값이 조용히 날아가고, 저장은 "반영됨"으로 처리된다 — 리뷰 둘이 독립적으로 같은 자리를
  잡았다. 리셋은 **"출발점으로 되돌린다"** 여야 한다(`initial ?? 빈 값`). 프리필 통로를 여는
  컴포넌트에 리셋이 있으면 그 둘이 서로를 아는지 먼저 확인한다.

- **히스토리 엔트리를 쓰는 모달을 닫은 **직후** `page.goto` 하면 ERR_ABORTED 다.** 닫힘이
  `history.back()` 의 비동기 왕복을 태우는데 그 사이 네비게이션이 겹치면 중단된다(실측).
  모달이 실제로 사라졌는지(`toHaveCount(0)`)를 먼저 기다린 뒤 이동한다.

- **앱에서 세고 쓰는 상한은 동시 요청 앞에서 통째로 뚫린다 — 판정을 INSERT 에 붙여야 한다.**
  `count(*)` 후 `insert` 는 두 왕복이라 동시에 온 요청이 전부 같은 낮은 수를 읽고 통과한다.
  "한두 건 넘칠 뿐"이 아니라 **버스트 크기만큼** 넘는다(적대적 리뷰가 잡았다 — 그 전 주석이
  틀렸다). D1 엔 대화형 트랜잭션이 없어 조건부 INSERT 를 못 만들지만, **SQLite 트리거는 그 벽을
  우회하지 않고 판정 자체를 쓰기 연산 안으로 옮긴다**(`BEFORE INSERT … WHEN … RAISE(ABORT)`).
  drizzle 스키마 DSL 엔 트리거가 없으므로 마이그레이션 SQL 과 `meta/_journal.json` 항목을 손으로
  더한다(스냅샷은 직전 것을 복사 — 테이블 정의가 안 바뀌므로 `drizzle-kit check` 도 통과한다).
  로그인만 하면 닿는 쓰기 경로를 새로 열 땐 이 자리를 먼저 떠올린다.

- **부분 UNIQUE 인덱스의 WHERE 절에 drizzle 이 테이블 한정자를 붙인다.** 생성물이
  `WHERE "t"."status" = 'pending'` 인데 SQLite 의 `CREATE INDEX … WHERE` 가 그걸 받는지는
  스펙만 봐선 모른다 — 받는다(실측 2026-07-26, `node:sqlite`). 마이그레이션을 만들면 생성된
  SQL 을 스크래치 sqlite 로 한 번 재생해 보는 습관이 이 자리를 덮는다.

## 접근성 기준 (협상 대상 아님)

구 사이트에서 검증된 기준을 그대로 잇는다.

- 대비: 본문 4.5:1, 큰 텍스트/UI 컴포넌트 3:1. 눈으로 판단하지 말고 계산한다.
- 터치 타깃 44×44 이상. 포커스 링은 항상 보이게(`--focus` 2px, `--accent` 는 채움용이라
  링으로 쓰면 대비가 안 난다).
- 장식(테이프·클립·리본·마크·발바닥)은 전부 `aria-hidden="true"`, 인라인 SVG.
- 새 창 링크엔 `<span class="sr-only">(새 창에서 열림)</span>`.
- `prefers-reduced-motion` 가드 안에 새 애니메이션을 넣는다.
- 라틴 전용 폰트(Gloock·Sacramento)에는 한글 페이스를 폴백으로 — 없으면 한글 제목이 OS
  임의 폰트로 떨어진다(토큰에 이미 반영).

## 코드 컨벤션

- **주석은 제약을 적는다.** "다음 줄이 뭘 하는지"가 아니라 "왜 이 값이어야 하는지". 구
  사이트에서 이어온 톤이다.
- **사용자 노출 문구는 전부 한국어이고 합쇼체다 — 해요체를 쓰지 않는다.** "~해요·~예요·~에요·
  ~네요·~군요·~주세요"가 아니라 "~합니다·~입니다·~주십시오"다. 안내문·힌트·오류·라이브 영역
  전부 해당한다(2026-07-26 사용자 지시로 앱 전체를 합쇼체로 통일했다 — 그전엔 "다정한 해요체"가
  기본이었고 파괴적 화면만 예외였다).

  **왜:** 값 칸이 `2026.03.01`·`완료` 같은 표기인데 옆 문장만 대화체면 화면이 통째로 가볍게
  읽힌다. PR #70 이 값 칸을 먼저 표기형으로 되돌렸고, 이 규칙이 그 나머지를 잇는다.

  예외는 **구 사이트에서 이식된 소개 카피**뿐이다(`landing` 의 캐릭터 소개 등) — 그건 UI 문구가
  아니라 사용자가 쓴 글이라 손대지 않는다. 고양이 말투("냐")는 화면당 1회까지로 그대로 둔다.

- **없는 고유명사를 만들지 않는다.** 역할·대상의 이름은 이미 정해져 있다(관리자·팬·보드·제안함).
  2026-07-26 에 제안 폼 안내문에 "쿠냐지기"를 새로 지어 넣었다가 되돌렸다 — 사이트에 없던 어휘를
  들이는 건 안티슬롭 규칙이 막는 것이고, 그 역할의 이름은 AGENTS.md·ADR·이슈가 전부 "관리자"로
  쓰고 있었다. 새 이름이 필요하다고 느끼면 지어내지 말고 물어본다.
- **값·상태를 적는 칸은 문장이 아니라 표기다.** 정의 목록의 값, 칩, 체크박스 라벨처럼 "무엇인가"
  를 적는 자리엔 해요체 서술을 넣지 않는다 — 바로 옆 칸이 `2026.03.01` 같은 표기라 거기만
  대화체면 화면이 통째로 가벼워진다(게임 상세가 "했어요"·"아직이에요"였다가 사용자 지적으로
  "완료"·"미완료"로 돌아왔다). **라벨이 묻고 값이 대답하는 구조를 만들지 마라** — 라벨은 이름이고
  값은 표기다. 다정한 해요체는 안내문·힌트·오류처럼 **말을 거는 자리**의 것이고, 거긴 그대로 둔다.
- 사용자가 가리킬 요소(섹션·제목·CTA·반복 카드)에 `data-od-id="kebab-case"`.
- 새 프레임워크·런타임 의존을 함부로 늘리지 않는다. 추상화는 두 번째 기능이 seam 을 드러낼
  때 JIT 로([ADR-0010](./docs/adr/0010-verification-first-jit-abstraction.md)).
- **날짜·시각 컬럼은 개념이 이름과 타입을 함께 정한다.** 세 종류가 있고 섞지 않는다:

  | 개념         | 접미사  | 타입                | 예             |
  | ------------ | ------- | ------------------- | -------------- |
  | 달력의 하루  | `_date` | `TEXT 'YYYY-MM-DD'` | `cleared_date` |
  | 하루 중 시각 | `_time` | `TEXT 'HH:MM'`      | `start_time`   |
  | 절대 순간    | `_at`   | `INTEGER` epoch ms  | `created_at`   |

  앞의 둘은 타임존이 없는 **라벨**이고(KST 로 읽는다는 도메인 약속), `_at` 만 진짜 시각이다.
  달력 날짜를 epoch 로 두면 저장·표시 양쪽에서 타임존이 개입해 KST 자정 근처의 하루가 밀린다 —
  이 저장소가 실제로 겪어 [ADR-0019](./docs/adr/0019-game-state-derived-from-dates.md)가 text 로
  되돌린 버그다. **"이식성을 위해 날짜를 전부 INTEGER 로 통일"은 방향이 반대다:** 관계형 DB 엔
  전부 `DATE` 가 있어 `'YYYY-MM-DD'` 는 `::date` 한 줄로 옮겨가지만, epoch 는 옮길 때마다
  "어느 존의 자정인가"를 사람이 다시 공급해야 하고 그 답은 컬럼 어디에도 안 적혀 있다. 문서
  DB·KV 로 가도 같다 — 날짜를 정렬 키로 쓰는 게 정석이라 문자열이 그대로 산다. 흩어져 보이는
  건 타입이 아니라 이름이 말을 안 해서였고, 그래서 통일하는 대상은 타입이 아니라 이 규약이다.
