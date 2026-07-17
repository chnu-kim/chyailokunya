# ADR-0005: 스타일은 Tailwind v4 @theme + 기존 토큰 승격

- 상태: Accepted
- 날짜: 2026-07-18

## 맥락

구 사이트의 `css/site.css` 는 `:root` 디자인 토큰(브랜드·시맨틱·타입·간격·그림자)과
라이트/다크 두 테마를 규율로 지켜 왔다: 생 hex 금지, `var(--token)` 만 참조. 이 규율은
접근성(대비 계산)과 테마 무결성을 지탱한다. 프론트 변경이 잦으므로 이 토큰 체계를
버리지 않고 살려야 한다.

## 결정

**Tailwind v4** 를 쓰되, 기존 `:root`/`[data-theme="dark"]` 토큰을 **`@theme`(정적 스케일)**
과 **`@theme inline`(테마 전환 색)** 으로 승격한다. 프리미티브는 **Radix/shadcn** 로 얹는다.
테마 전환은 `prefers-color-scheme` 가 아니라 **`data-theme` 속성**(첫 페인트 전 인라인
스크립트)으로 유지한다.

## 근거

- 색의 정본은 여전히 CSS 변수 한 곳. `@theme inline` 은 유틸리티가 `var(--bg)` 를 그대로
  emit 하게 해, `:root → [data-theme="dark"]` 플립이 Tailwind 유틸리티까지 그대로 흐른다.
- `@custom-variant dark ([data-theme="dark"])` 로 `dark:` 유틸리티를 구 사이트의 테마
  계약에 정렬한다.
- 웹폰트 폴백 규율(Gloock/Sacramento 뒤에 한글 페이스)도 토큰에 그대로 이식 — 한글 제목이
  OS 임의 폰트로 떨어지는 과거 버그를 막는다.

## 기각한 대안

- **Tailwind v3 + config 토큰** — v4 의 CSS-우선 `@theme` 가 기존 `:root` 규율과 더 자연스럽다.
- **토큰 버리고 Tailwind 팔레트만** — 라이트/다크 대비 튜닝과 브랜드 정합을 잃는다.
- **CSS Modules/vanilla-extract** — 프론트 잦은 변경엔 유틸리티 우선이 반복 속도가 빠르다.

## 결과

- (+) 접근성 규율(대비·포커스 링·테마 독립값)이 토큰째 보존된다.
- (+) shadcn 프리미티브를 토큰 위에 바로 얹을 수 있다.
- (−) `@theme` vs `@theme inline` 구분을 틀리면 플립이 조용히 죽는다 — 전환 색은 반드시
  `inline`. 이 규칙은 `globals.css` 주석과 AGENTS.md 불변식에 박아둔다.
