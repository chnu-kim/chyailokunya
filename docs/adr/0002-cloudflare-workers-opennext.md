# ADR-0002: 호스팅은 Cloudflare Workers + @opennextjs/cloudflare

- 상태: Accepted
- 날짜: 2026-07-18

## 맥락

구 사이트는 GitHub Pages 로 서빙됐다. 이제 D1·세션·서버 렌더가 필요하고, 도메인은
`chyailokunya.com` 을 Cloudflare 에 둔다. Next.js([ADR-0001](./0001-next-app-router.md))를
Cloudflare 위에 올리는 경로가 여럿이다.

## 결정

**Cloudflare Workers** 에 **`@opennextjs/cloudflare`** 어댑터로 배포한다. `next build`
산출물을 OpenNext 가 Worker 번들(`.open-next/worker.js`)로 감싸고, `wrangler.jsonc` 가
런타임(compat date·flags·assets·D1 바인딩)을 정의한다.

## 근거

- D1·KV·R2·Durable Objects 바인딩을 같은 런타임에서 직접 쓸 수 있다.
- OpenNext 는 App Router·서버 컴포넌트·미들웨어를 지원하며 활발히 유지된다(빌드 검증에서
  Next 16 을 정상 번들).
- `nodejs_compat` 로 Next 런타임의 `node:` 의존을 충족한다.

## 기각한 대안

- **Cloudflare Pages / `@cloudflare/next-on-pages`** — deprecated 경로. Workers + OpenNext 가
  공식 권장이 됐다.
- **Vercel** — 벤더가 갈리고 D1/Workers 바인딩을 못 쓴다. 도메인·DB 를 Cloudflare 에
  모으는 이점이 사라진다.
- **셀프호스트 Node 서버** — 운영 부담이 팬사이트 규모에 안 맞는다.

## 결과

- (+) DB·엣지·정적 자산이 한 벤더·한 런타임 안에 모인다.
- (+) `opennextjs-cloudflare preview` 로 배포 런타임(workerd)을 로컬에서 그대로 재현.
- (−) OpenNext 어댑터가 Next 새 버전을 따라잡는 시차가 생길 수 있다 — 업그레이드 전
  `preview` 로 확인한다.
- (−) `wrangler` ≥ 3.99 필요, edge runtime(`export const runtime = "edge"`)은 못 쓴다.
