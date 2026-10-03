# AGENTS.md

챠이로 쿠냐 팬사이트. Next.js App Router · OpenNext(Cloudflare Workers) · D1+Drizzle · tRPC+Zod ·
Tailwind v4 · XState. 라이브는 `https://chyailokunya.com` 하나다.

이 파일은 코드·게이트·ADR 만 보고는 알 수 없는 것만 적는다. 결정의 이유는 [`docs/adr/`](./docs/adr/),
실제로 밟은 함정의 경위는 [`docs/pitfalls.md`](./docs/pitfalls.md) 에 있다. 규칙은 필요해질 때
더한다([ADR-0031](./docs/adr/0031-minimal-agents-md.md)).

## 검증

빠른 로컬 루프다. CI 게이트 전체(`.github/workflows/ci.yml`)는 아니다.

```bash
npm run format:check && npm run lint && npm run typecheck && npm run boundaries && npm test && npm run build
```

다음 변경은 위 루프가 초록이어도 끝난 게 아니다. CI 의 해당 단계를 로컬에서 같이 돌린다.

- **스키마나 마이그레이션을 바꿨다:** `npx drizzle-kit check`.
- **런타임·번들러·`wrangler.jsonc`·서버 라우트를 건드렸다:** `npx opennextjs-cloudflare build`
  다음 배포 번들 스모크. `npm run db:migrate:local` 을 한 뒤,
  `npx wrangler dev --port 3200 --local` 을 띄우고 `node scripts/post-deploy-smoke.mjs http://localhost:3200`
  를 실행한다. `next build` 가 초록이어도 배포는 깨질 수 있다.

그 밖에 지킬 것:

- 결과는 exit code 로 본다. `| tail` 같은 파이프를 걸면 0 이 나온다.
- e2e 는 `PORT=3100 npm run e2e` 로 돌린다. 3000 은 다른 dev 서버가 쓰기 쉽다. 그 서버를 재사용하면
  e2e 세션 키를 읽지 못해 로그인 스펙이 깨진다.
- 커버리지 임계치는 래칫이다. 테스트를 늘리는 PR 은 `vitest.config.ts` 의 `thresholds` 도 함께
  올린다([ADR-0029](./docs/adr/0029-verification-layers-and-coverage-ratchet.md)).
- 시계, CPU 한도, Workers 전역처럼 런타임이 다르게 구현하는 부분은 배포 후 스모크만 볼 수 있다.
- 머지와 배포는 다른 일이다. CI 가 흔들리면 Deploy 가 조용히 skipped 된다. 머지한 뒤 deploy
  결과를 확인한다.

## 불변식

1. 레이어 의존은 `components/ui → features → db → core` 방향으로만 흐른다(`npm run boundaries`).
2. 외부 입력(클라이언트·localStorage·OAuth 콜백)은 Zod 로 검증한 뒤 쓴다.
3. 쓰기 인가의 정본은 서버의 역할 검사다. 로그인만으로는 쓸 수 없고, 팬 제안만 로그인으로
   허용한다. member 역할 행은 만들지 않는다([ADR-0012](./docs/adr/0012-role-based-writes-allowlist.md)·[0025](./docs/adr/0025-fan-suggestions.md)).
4. 비밀은 저장소에 두지 않는다. 목록의 정본은 `src/cloudflare-secrets.d.ts` 다.
5. origin 은 apex 하나다. `www` 는 일부러 열지 않았다. 세션 쿠키와 Origin 검증이 한 origin 에
   묶여 있기 때문이다.
6. OAuth 콜백은 `/api/auth/callback/chzzk` 로 고정이다. `AUTH_URL` 에는 origin 만 넣는다. 치지직
   콘솔의 redirect URI 와 다르면 403 이 난다.
7. 채널은 치지직·유튜브·X 셋뿐이다. 디스코드는 넣지 않는다.
8. 색과 타입은 `src/app/globals.css` 토큰으로만 쓴다. 생 hex 를 새로 쓰지 않는다.
9. index 와 landing 은 분리를 유지한다. 장식은 인라인 SVG 로 만들고 이모지 아이콘은 쓰지 않는다.
   이미지는 생성하지 말고 사용자에게 요청한다.
10. 페이지를 더하면 `src/features/routes.ts` 도 고친다. 빠뜨리면 그 페이지에서 로그인한 사람만
    `/` 로 떨어진다.

## 비싼 함정

어긴 뒤에야 드러나고 게이트도 못 잡는 것들이다. 이 다섯 말고도 `docs/pitfalls.md` 에는 UI·상태
머신·CSS·e2e·이미지 캡처 절이 있다. 그런 작업을 시작하면 해당 절을 먼저 읽는다.

- **마이그레이션.** 부모 테이블을 다시 만드는 마이그레이션은 자식 행을 재생성 뒤에 되채운다.
  `PRAGMA foreign_keys=OFF` 는 트랜잭션 안에서 무시되기 때문이다. drizzle-kit 이 만든
  `INSERT…SELECT` 는 직접 열어 확인한다. 검증은 `BEGIN…COMMIT` 안에서 재생한다.
- **D1 동시성.** D1 엔 대화형 트랜잭션이 없고 `batch()` 만 원자적이다. 동시 요청에 걸리는 상한은
  트리거로 INSERT 에 붙인다.
- **배포 런타임.** `caches` 는 `next dev` 에 없다. 무료 플랜의 CPU 10ms 를 넘는 서버 렌더는 두지
  않는다. `wrangler.jsonc` 에 `env.*` 를 더하면 e2e 가 뜨지 않는다.
- **생성물.** dev 서버가 `next-env.d.ts` 를 다시 쓴다. `git add` 직전에
  `git checkout origin/main -- next-env.d.ts` 로 되돌린다. `cf-typegen` 은 `.dev.vars` 와
  `.open-next` 를 치운 뒤에 돌린다.
- **푸시.** HTTPS remote 에 `git -c credential.helper='!gh auth git-credential' push` 로 한다. 이
  머신의 SSH 키 주인이 저장소 소유자가 아닐 수 있다.

## 접근성

`e2e/a11y.spec.ts`(axe)는 초기 화면과 비로그인 상태만 본다. 그 밖의 것은 손으로 지킨다.

- 대비는 본문 4.5:1, 큰 텍스트와 UI 3:1 이다. 눈으로 판단하지 않고 스크립트로 계산한다.
- 터치 타깃은 44×44 다. `e2e/narrow-body.spec.ts` 는 셀렉터를 손으로 나열하므로, 조작을 더하면
  그 목록에도 적는다.
- 포커스 링은 `--focus` 를 쓴다. 장식에는 `aria-hidden` 을 붙이고, 새 창 링크에는 sr-only
  `(새 창에서 열림)` 을 단다. 애니메이션은 `prefers-reduced-motion` 가드 안에 넣는다.

## 컨벤션

- 사용자에게 보이는 문구는 한국어 합쇼체로 쓴다(`e2e/copy-tone.spec.ts`). 값과 상태를 적는 칸은
  문장이 아니라 표기(`2026.03.01`·`완료`)로 쓴다. 사이트에 없는 고유명사는 지어내지 않는다.
- 문구에는 사실만 쓴다. 꾸밈말, 의성어, 고양이 말투, 이모티콘, 쿠냐가 하지 않은 말, 확인하지 않은
  방송 내용을 지어 넣지 않는다. 사실이 확인되지 않으면 쓰지 말고 묻는다.
- 주석에는 무엇을 하는지가 아니라 왜 이 값이어야 하는지를 적는다.
- 사용자가 가리킬 요소에는 `data-od-id="kebab-case"` 를 붙인다.
- 날짜 컬럼은 `_date`(TEXT `YYYY-MM-DD`), 시각은 `_time`(TEXT `HH:MM`), 순간은 `_at`(epoch ms)으로
  쓴다. 달력 날짜를 epoch 로 두지 않는다([ADR-0019](./docs/adr/0019-game-state-derived-from-dates.md)).
  "이식성을 위해 INTEGER 로 통일"은 반대 방향이다. `'YYYY-MM-DD'` 는 어느 DB 의 `DATE` 로도 옮겨
  가지만, epoch 는 옮길 때마다 어느 존의 자정인지를 다시 정해야 한다.
- 둘 이상이 함께 바뀌거나, 불가능한 조합이 생기거나, 비동기가 끼는 클라이언트 상태는
  `src/core/*.machine.ts` 로 올린다([ADR-0026](./docs/adr/0026-xstate-unifies-client-state.md)).
- 굵직한 결정을 내리면 ADR 을 더한다(`docs/adr/template.md`).
