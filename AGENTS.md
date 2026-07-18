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
를 읽는다(기본 3000, CI 는 그대로).

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
- 사용자 노출 문구는 전부 한국어. 톤은 다정하고 장난기 있되 과하지 않게. 고양이 말투("냐")는
  화면당 1회까지.
- 사용자가 가리킬 요소(섹션·제목·CTA·반복 카드)에 `data-od-id="kebab-case"`.
- 새 프레임워크·런타임 의존을 함부로 늘리지 않는다. 추상화는 두 번째 기능이 seam 을 드러낼
  때 JIT 로([ADR-0010](./docs/adr/0010-verification-first-jit-abstraction.md)).
