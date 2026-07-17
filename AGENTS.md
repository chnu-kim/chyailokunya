# AGENTS.md

`chyailokunya` 에서 작업하는 코딩 에이전트를 위한 플레이북. **이 파일이 규칙의 정본이고**
`CLAUDE.md`·`GEMINI.md` 는 이걸 import 한다. 규칙이 바뀌면 여기만 고친다.

결정의 **"왜"** 는 [`docs/adr/`](./docs/adr/) 에 있다. 규칙(불변식·경계·플레이북)은 여기,
근거는 ADR — 둘을 섞지 않는다([ADR-0013](./docs/adr/0013-docs-adr-and-agents.md)).

## 이 저장소가 무엇인가

버추얼 스트리머 **챠이로 쿠냐** 팬사이트. 정적 사이트(`chnu-kim/chyaro-kunya`)를
**Next.js 풀스택(Cloudflare Workers)** 으로 옮기는 마이그레이션의 결과물이다.

- 배포: Cloudflare Workers, 도메인 `chyailokunya.com` (Phase 5 컷오버까지 구 사이트가 라이브)
- 스택 요약: Next.js App Router · OpenNext(Workers) · D1+Drizzle · tRPC+Zod · Tailwind v4 ·
  치지직 커스텀 OAuth → 자체 JWT 세션. 각 선택의 근거는 [ADR-0001~0013](./docs/adr/).
- **v1 정박점:** 공용 게임 보드 + 역할 기반 쓰기(전원 치지직 로그인, allowlist channelId 만 쓰기).

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
npm run e2e            # Playwright 스모크 (dev 서버 자동 기동)

npm run preview        # opennextjs-cloudflare build + workerd 로 배포 런타임 재현
npm run cf-typegen     # wrangler.jsonc 변경 후 cloudflare-env.d.ts 재생성
```

CI(`.github/workflows/ci.yml`)가 PR·main 에서 `format · lint · typecheck · boundaries ·
unit · build` 를 게이트로 돌린다. 배포는 CI 가 아니라 **Cloudflare Workers Builds** 가
main 갱신 시 맡는다([ADR-0009](./docs/adr/0009-actions-gate-workers-builds.md)).

## 아키텍처 맵

단일 Next 앱. 의존은 **아래로만** 흐르고 dependency-cruiser 가 기계 강제한다
([ADR-0007](./docs/adr/0007-single-app-enforced-boundaries.md)):

```
src/components/ui  →  src/features  →  src/db  →  src/core
                          (app/ 는 조립 지점 — 어디든 쓸 수 있다)
```

| 레이어              | 책임                                  | 의존 가능    |
| ------------------- | ------------------------------------- | ------------ |
| `src/core`          | 순수 도메인 로직. HTTP·DB·React 무관. | (없음)       |
| `src/db`            | Drizzle 스키마·D1 클라이언트.         | `core`       |
| `src/features`      | 유즈케이스·tRPC 라우터·서비스.        | `db`, `core` |
| `src/components/ui` | Radix/shadcn 프리미티브.              | `features`   |
| `src/app`           | 라우트·레이아웃·조립.                 | 전부         |

위로 새는 import 는 `npm run boundaries` 가 error 로 죽인다. 경로 규칙이 "이 코드가 어디
속하나"의 정본이다.

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
4. **비밀은 저장소에 두지 않는다.** `CHZZK_CLIENT_SECRET`·`AUTH_SECRET`·`SUPERADMIN_CHANNEL_ID`
   는 Cloudflare secret / 1Password Environment 로만 주입한다. `.dev.vars` 는 gitignore.
5. **채널은 3개뿐 — 디스코드는 없다.** 치지직·유튜브·X. 디스코드 링크·아이콘·언급을 만들지
   않는다(구 사이트에서 실제로 지웠던 플레이스홀더다).
6. **디자인 토큰이 색·타입의 정본.** 생 hex 금지. `globals.css` 의 CSS 변수 → Tailwind
   `@theme`/`@theme inline` 유틸리티로만 참조([ADR-0005](./docs/adr/0005-tailwind-v4-theme-tokens.md)).
7. **index/landing 분리 유지.** 병합은 사용자가 기각했다 — 에이전트가 뒤집지 않는다.
8. **장식은 인라인 SVG.** 이모지 아이콘(✨🚀🎯) 금지. 미니멀 블랙 모티프 SVG.
9. **이미지는 사용자가 제공한다.** 생성하지 말고 필요 목록을 정리해 요청한다.

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
