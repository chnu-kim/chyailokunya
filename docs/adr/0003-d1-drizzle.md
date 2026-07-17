# ADR-0003: DB 는 Cloudflare D1(SQLite), ORM 은 Drizzle

- 상태: Accepted
- 날짜: 2026-07-18

## 맥락

게임 보드와 사용자(치지직 channelId·role)를 저장할 DB 가 필요하다. 호스팅이 Cloudflare
Workers([ADR-0002](./0002-cloudflare-workers-opennext.md))라 같은 런타임에서 바인딩으로
붙는 저장소가 유리하다. "계약이 타입 정본" 원칙에 맞는 ORM 이어야 한다.

## 결정

**Cloudflare D1**(SQLite) 를 저장소로, **Drizzle** 를 ORM/마이그레이션 도구로 쓴다.
스키마(`user`·`game`)가 타입의 정본이 되고, 마이그레이션 검증이 CI 게이트에 들어간다.

## 근거

- D1 은 Workers 바인딩으로 직접 붙고, 로컬은 Miniflare 로 재현된다(Vitest Workers pool,
  [ADR-0008](./0008-vitest-workers-playwright.md)).
- Drizzle 은 SQL-우선·타입 추론이 강하고 D1 드라이버를 1급 지원한다. 스키마에서 타입이
  흘러나와 tRPC/Zod([ADR-0004](./0004-trpc-zod.md))와 한 계약으로 이어진다.
- 팬사이트 규모의 읽기 위주 워크로드에 SQLite 의미론이면 충분하다.

## 기각한 대안

- **Prisma** — D1/엣지 지원이 무겁고 런타임 궁합이 Drizzle 보다 나빴다.
- **Postgres(Neon 등)** — 별도 벤더·커넥션 관리. 지금 필요 없는 리치 타입을 위해 D1 의
  바인딩 단순함을 버릴 이유가 없다.
- **KV/R2 만으로** — 관계·쿼리가 필요한 보드에 부적합.

## 결과

- (+) DB 가 배포 런타임 안에 있고 로컬에서 완전 재현된다.
- (+) 스키마 → 타입 → API 가 하나의 정본으로 연결된다.
- (−) D1 은 SQLite 라 리치 타입·복잡 트랜잭션이 제한적. 훗날 Postgres 이전은 Drizzle 로
  가능하나 공짜가 아니다 — v1 범위에선 문제되지 않는다.
