# ADR-0017: 인증 라이브러리 = Auth.js(next-auth v5) + 커스텀 치지직 provider + edge env 주입

- 상태: Accepted
- 날짜: 2026-07-18
- 보완: [ADR-0006](./0006-chzzk-oauth-jwt-session.md)(치지직 커스텀 OAuth → 자체 JWT)을 라이브러리·주입 방식으로 구체화

## 맥락

[ADR-0006](./0006-chzzk-oauth-jwt-session.md)은 "치지직 커스텀 OAuth → 자체 JWT 세션"을 정했지만
_무엇으로_ 구현할지는 열어 뒀다. Phase 4(#6)에서 그걸 정한다. 힘 두 가지가 맞선다:

- **직접 구현**(jose 로 JWT 서명 + 콜백·state·CSRF·쿠키를 손으로) — 의존을 안 늘리고([ADR-0010](./0010-verification-first-jit-abstraction.md)
  YAGNI) 통제가 확실하지만, CSRF·state·쿠키 보안을 우리가 떠안는다.
- **Auth.js(next-auth v5)** — 콜백·state·쿠키·CSRF 를 검증된 라이브러리가 처리하지만 의존이 늘고
  Cloudflare Workers/OpenNext 통합 리스크가 있다.

제약: 치지직은 표준 OIDC 가 아니다(camelCase 인가 파라미터·토큰 교환 JSON body·state 재전송·
`{code,message,content}` envelope). 그리고 Workers 는 시크릿을 `process.env` 가 아니라 요청 스코프
바인딩으로 준다 — 대부분의 auth 라이브러리가 가정하는 모듈 로드 시 `process.env` 읽기가 안 맞는다.

## 결정

**Auth.js(next-auth v5)** 를 쓰되, 세 가지로 이 저장소에 맞춘다:

- **커스텀 OAuth provider**(`src/features/auth/chzzk-provider.ts`): `authorization`/`token`/`userinfo`
  를 직접 매핑한다. 비표준(camelCase·JSON body·state 재전송·envelope)은 순수·주입가능 함수
  `chzzk-api.ts` 에 가둬 네트워크 없이 단위테스트한다. CSRF 는 `checks:["state"]` 로 Auth.js 에 맡긴다.
- **lazy config 함수**: `NextAuth(async () => { const { env } = getCloudflareContext(); … })`. config 를
  함수로 넘겨 요청 스코프에서 시크릿(`AUTH_SECRET`·`CHZZK_*`·`AUTH_URL`·`SUPERADMIN_CHANNEL_ID`)을
  읽는다 — `process.env` 비의존. `trustHost:true`(Workers 뒤 프록시, `AUTH_URL` 이 정본 origin).
- **JWT 세션 전략 · DB adapter 미사용**: 신원 upsert(users↔oauth 분리)는 `jwt` 콜백에서 우리가
  직접 하고 치지직 토큰은 저장하지 않는다([ADR-0006](./0006-chzzk-oauth-jwt-session.md)). effective
  authorities 를 JWT 클레임에 실어 인가 핫패스에 DB 왕복이 없다([ADR-0014](./0014-v1-data-model-schema.md)).
  세션 클레임은 서명돼 있어도 소비 경계에서 `parseAuthorities` 로 방어적으로 좁힌다(불변식 2).

## 근거

- 치지직이 OIDC 가 아니라 off-the-shelf provider 로는 안 되지만, Auth.js 의 `authorization`/`token`/
  `userinfo` 오버라이드가 비표준 매핑을 정확히 허용한다 — 비표준을 순수 함수에 가두면 통제·검증성을
  직접 구현만큼 얻으면서 CSRF·쿠키·콜백 보안은 라이브러리가 진다.
- lazy config 로 Workers 의 요청 스코프 env 를 정공법으로 잇는다 — `initOpenNextCloudflareForDev`
  덕에 dev 도 같은 경로라 "로컬은 되는데 배포는 깨지는" 표류가 없다.
- JWT 클레임 인가는 [ADR-0014](./0014-v1-data-model-schema.md)의 "인가 핫패스 DB 왕복 0" 과 정합한다.

## 기각한 대안

- **jose 로 직접 구현** — CSRF·state·쿠키 보안을 우리가 떠안는다. 팬사이트 규모에 라이브러리가 검증한
  콜백 흐름을 재발명할 이유가 약하다(사용자 확정).
- **DB adapter(@auth/\*-adapter)** — 세션·계정을 어댑터 스키마에 맞춰야 하고 치지직 토큰을 저장하게 된다.
  우리는 users↔oauth 를 우리 스키마로 분리·소유하고([ADR-0014](./0014-v1-data-model-schema.md)) 토큰을
  저장하지 않는다([ADR-0006](./0006-chzzk-oauth-jwt-session.md)).
- **표준 provider 프리셋** — 치지직이 OIDC 가 아니라 그대로 안 맞는다.

## 결과

- (+) CSRF·state·쿠키·콜백을 검증된 라이브러리가 처리. 비표준은 순수 함수로 격리돼 테스트된다.
- (+) 요청 스코프 env 주입이 dev·배포에서 같은 경로 — 시크릿을 저장소 밖에 둔다(불변식 4).
- (−) **staleness**: 역할 변경은 대상자 재로그인 전까지 세션에 안 뜬다(핫패스 DB 왕복 회피의 대가).
  필요 시 세션 `maxAge` 단축으로 완화한다.
- (−) next-auth v5 는 beta 라 API 가 바뀔 수 있다 — 정확 버전으로 핀하고, JWT 타입 보강이 안 닿는
  등 통합 함정은 코드 주석·`src/types/next-auth.d.ts` 에 근거를 남긴다.
- (−) 의존이 하나 는다 — [ADR-0010](./0010-verification-first-jit-abstraction.md)의 YAGNI 를 인증
  보안의 무게에 한해 접는다.
