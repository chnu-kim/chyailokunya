# ADR-0001: 프레임워크는 Next.js (App Router)

- 상태: Accepted
- 날짜: 2026-07-18

## 맥락

정적 HTML/CSS/JS 팬사이트(`chnu-kim/chyaro-kunya`)를 풀스택으로 옮긴다. v1 정박점은
공용 게임 보드 + 역할 기반 쓰기라 서버 렌더·서버 데이터 접근·인증이 필요하다. 동시에
"프론트는 잦은 디자인/UI 변경을 1급 제약으로" 다뤄야 한다.

## 결정

**Next.js App Router** 를 프레임워크로 쓴다. 서버 컴포넌트로 데이터를 서버에서 읽고,
클라이언트 컴포넌트는 상호작용에만 쓴다.

## 근거

- 서버 컴포넌트 + 서버 액션/라우트 핸들러가 D1·세션 접근을 자연스럽게 서버에 둔다
  (게임 보드 읽기는 공개, 쓰기는 역할 검사 뒤).
- Cloudflare Workers 배포 경로(OpenNext, [ADR-0002](./0002-cloudflare-workers-opennext.md))가
  App Router 를 지원한다.
- 파일 기반 라우팅 + 레이아웃이 index/landing 분리 유지([ADR-0011](./0011-keep-index-and-landing-separate.md))와
  잘 맞는다.

## 기각한 대안

- **정적 사이트 유지(현행)** — 서버 쓰기·인증을 담을 수 없어 v1 목표를 못 이룬다.
- **Pages Router** — App Router 가 서버 컴포넌트/스트리밍의 정본이고 신규 프로젝트 권장.
- **SvelteKit/Remix 등** — 팀 친숙도·Cloudflare 어댑터 성숙도·shadcn 생태계에서 Next 가 앞선다.

## 결과

- (+) 서버/클라이언트 경계가 언어 차원에서 명확해진다.
- (+) tRPC·Drizzle·Tailwind·shadcn 조합의 레퍼런스가 풍부하다.
- (−) App Router 의 캐싱·렌더 모델은 학습 곡선이 있다 — 재검증/캐시는 실제 필요할 때
  JIT 로 다룬다([ADR-0010](./0010-verification-first-jit-abstraction.md)).
