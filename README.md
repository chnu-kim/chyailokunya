# chyailokunya

버추얼 스트리머 **챠이로 쿠냐** 팬사이트. 정적 사이트
[`chnu-kim/chyaro-kunya`](https://github.com/chnu-kim/chyaro-kunya) 를 Next.js 풀스택
(Cloudflare Workers)으로 옮기는 마이그레이션.

> Phase 5 컷오버 전까지 구 정적 사이트가 라이브다 — 이 저장소는 그 자리를 넘겨받는다.

## 스택

Next.js (App Router) · [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) (Workers) ·
Cloudflare D1 + Drizzle · tRPC + Zod · Tailwind v4 · 치지직 커스텀 OAuth → 자체 JWT 세션.

각 선택의 근거는 [`docs/adr/`](./docs/adr/), 작업 규칙은 [`AGENTS.md`](./AGENTS.md).

## 개발

```bash
npm install            # 최초 1회 (npm 11 이면 approve-scripts 로 workerd 등 승인)
npm run dev            # http://localhost:3000
npm run build          # 컴파일 + 타입체크 + 정적 생성
npm test               # Vitest — workerd 안에서 단위 테스트
npm run preview        # workerd 로 배포 런타임 재현 (opennext build + preview)
```

전체 게이트(`format · lint · typecheck · boundaries · unit · build`)와 명령어는
[`AGENTS.md`](./AGENTS.md#검증-빌드테스트린트가-대신-잡아준다) 참고.

## 구조

```
src/core          순수 도메인 (HTTP·DB·React 무관)
src/db            Drizzle 스키마 · D1 클라이언트
src/features      유즈케이스 · tRPC 라우터
src/components/ui Radix/shadcn 프리미티브
src/app           라우트 · 레이아웃 · 조립
docs/adr          아키텍처 결정 기록 (왜)
```

의존은 아래로만 흐르고(`ui → features → db → core`) dependency-cruiser 가 CI 에서 강제한다.
