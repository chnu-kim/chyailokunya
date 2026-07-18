# ADR-0017: 세션 = 자체 발급 EdDSA access + DB refresh 회전 (인증 라이브러리 미사용)

- 상태: Accepted
- 날짜: 2026-07-18
- 보완: [ADR-0006](./0006-chzzk-oauth-jwt-session.md)(치지직 커스텀 OAuth → 자체 JWT)을 세션 메커니즘으로 구체화
- 뒤집음: [ADR-0014](./0014-v1-data-model-schema.md)의 "세션에 effective authorities 를 싣는다" — 인가 순간 DB 조회로 바꾼다

## 맥락

[ADR-0006](./0006-chzzk-oauth-jwt-session.md)은 "치지직 커스텀 OAuth → 자체 JWT 세션, 치지직 토큰
미저장"을 정했지만 _세션을 어떤 메커니즘으로_ 굴릴지는 열어 뒀다. Phase 4(#6)에서 정한다.

이 ADR 의 **첫 판은 Auth.js(next-auth v5) + 커스텀 치지직 provider + stateless JWT 세션**이었고,
authorities 를 JWT 클레임에 실어 인가 핫패스의 DB 왕복을 0 으로 만들었다([ADR-0014](./0014-v1-data-model-schema.md)가
원한 것). PR #12 의 adversarial 리뷰가 그 판을 [high] 로 무너뜨렸다:

> **역할을 회수해도 JWT 만료(기본 30일)까지 권한이 유효하다.**

이건 튜닝 문제가 아니라 전제 붕괴다. [ADR-0012](./0012-role-based-writes-allowlist.md)(역할 기반
쓰기)와 [ADR-0018](./0018-role-audit-and-elevation-guard.md)(상승 가드 + 감사)는 **"권한을 즉시 거둘
수 있다"** 를 깔고 설계됐다. 인가 판단을 토큰에 캐시하면 강등된 관리자가 만료까지 쓰기 권한을
유지한다 — 감사 로그는 "언제 거뒀는지"를 적지만 그 시각에 실제로 거둬지지 않는다. 불변식 3(서버
인가가 진짜 방어선)이 서버가 아니라 **과거에 서명된 종이**를 방어선으로 삼게 된다.

맞선 힘:

- **인가 핫패스 DB 왕복 0**([ADR-0014](./0014-v1-data-model-schema.md)) ↔ **즉시 회수**.
- **검증된 라이브러리에 보안을 맡김** ↔ **세션 수명·회전·폐기에 대한 통제**.

제약: 치지직은 OIDC 가 아니라(camelCase 파라미터·JSON body 토큰 교환·state 재전송·`{code,message,content}`
envelope) 어차피 provider 매핑을 손으로 하고 있었다. Workers 는 시크릿을 요청 스코프 바인딩으로
준다. D1 은 **interactive transaction 이 없다**(`db.batch` 만 원자적).

## 결정

**인증 라이브러리를 걷어내고 세션을 자체 발급한다.** 다섯 축:

1. **access = EdDSA(Ed25519) JWT · 15분 · httpOnly 쿠키 · 신원만.** jose 로 서명/검증하고
   `jwtVerify(algorithms:["EdDSA"])` 로 알고리즘을 못박아 alg confusion(`none`·HS256 위조)을 차단한다.
   `kid`·`iss`·`aud` 를 검증한다. **authorities 를 싣지 않는다** — 클레임은 `userId·channelId·channelName`
   뿐이다. 비대칭이라 검증 측(proxy·route·서버 컴포넌트)은 public key 만 갖는다.
2. **refresh = opaque 난수(32B) + sha256 해시만 DB 저장 · httpOnly 쿠키.** 14일 sliding +
   **90일 absolute cap**(family 첫 로그인 기준).
   **평문은 어디에도 저장하지 않는다 — 예외 없다.**

   > 초판엔 예외가 있었다: 아래 3의 grace 멱등 반환을 위해 `replaced_by_token` 에 후계 토큰의
   > **평문**을 심었다. 지연 청소로 창을 좁히려 했지만 적대적 리뷰가 배포 차단으로 지적했다 —
   > 청소는 _다음 요청_ 에 의존하므로, 사용자가 한 번 갱신하고 쉬면 **현재 활성** 토큰의 평문이
   > sliding TTL(14일)까지 남는다. DB 를 한 번 읽는 것만으로 세션 탈취가 되고, 공격자가 쥔 것이
   > 폐기된 과거 토큰이 아니라 체인의 head 라 회전·재사용 감지도 무력하다.
   >
   > **해결: 저장하지 않고 재계산한다.** `successor = HMAC-SHA256(서명 JWK 에서 파생한 서버 비밀, 구 토큰)`.
   > 같은 구 토큰이면 항상 같은 후계라 멱등이 유지되고 DB 엔 해시만 남는다. DB 를
   > 통째로 읽어도 후계를 만들 수 없고(구 토큰 평문도 서버 비밀도 DB 에 없다), 구 토큰을 훔친
   > 자도 서버 비밀 없이는 오프라인 유도가 불가능해 **여전히 제시해야 하므로 도난 탐지가 보존**
   > 된다. `replaced_by_token` 컬럼은 마이그레이션 0005 로 제거했고, 회귀를 막는 테스트("회전
   > 직후에도 DB 어디에도 refresh 평문이 없다")를 남겼다. 남은 청소는 만료 행 삭제뿐이라
   > 보안 경계가 아니라 용량 관리다.

3. **회전 + 재사용 감지.** 조건부 UPDATE claim(D1 단일 writer 라 원자적)으로 **최초 회전자만** 승계한다.
   이미 회전된 토큰이 오면:
   - **grace 30초 내** → 정상 동시 탭. **같은 후계를 멱등 반환**한다(구 토큰에서 재계산 — 위 2 참고).
     새로 발급하지 **않는다** — 발급하면 도둑이 유효 토큰을 무한정 찍어내 도난 감지가 무력화된다
     (adversarial 이 잡은 함정). 후계 행이 실제로 없으면(claim 후 INSERT 전 크래시) 손상으로 끊는다.
   - **grace 밖** → 도난. **family 전체 폐기 + `security_events` 기록.**
   - **회전(`superseded_at`)과 폐기(`revoked_at`)를 다른 컬럼으로 분리한다.** 한 컬럼으로 합치면
     로그아웃한 토큰이 grace 안에서 "정상 동시 탭"으로 분류돼 되살아난다(TDD 가 잡은 실제 버그).
4. **authorities = 인가 순간 DB 조회**, 요청 스코프 메모이즈(`ctx.authoritiesOf()`). 공개 읽기 경로는
   인가가 없어 여전히 DB 0 이고, 인가가 필요한 요청만 1회 조회한다. **회수가 즉시 반영된다.**
5. **자동 갱신 = `src/middleware.ts`.** access 가 유효하면 검증만(DB 0), 만료면 회전하고 갱신된
   쿠키를 downstream 으로 forward 한다.

   > **Next 16 이 권하는 `proxy.ts` 를 쓸 수 없다.** 처음엔 "Next16 의 middleware rename 이고
   > OpenNext 라 Node 런타임이니 D1·jose 가 그대로 된다"고 적었는데 **틀렸다.** Next 16 은
   > proxy 를 Node 전용으로 만들었고 `@opennextjs/cloudflare` 는 Node 미들웨어를 거부한다
   > ("Node.js middleware is not currently supported"). proxy 를 엣지로 돌릴 수도 없다
   > ("Proxy does not support Edge runtime"). 구 규약 `middleware.ts` 는 엣지로 번들돼 OpenNext
   > 가 받으므로 deprecation 경고를 감수하고 이걸 쓴다 — Workers 자체가 workerd 라 D1 바인딩·
   > jose(WebCrypto)는 그대로 동작한다. OpenNext 가 Node proxy 를 지원하면 옮긴다.
   >
   > 이 오판은 **로컬·CI 게이트를 모두 통과하고 배포에서만 터졌다**(`next build` 는 받아준다).
   > 그래서 CI 게이트에 `opennextjs-cloudflare build` 를 추가했다.

부수 결정: **콜백 경로는 `/api/auth/callback/chzzk`** — 치지직 콘솔에 등록된 redirect URI 와
**완전 일치**해야 하는 값이라 코드가 콘솔을 따른다(다르면 동의 화면에서 403). provider 를 경로에
새기는 형태라 `oauth_accounts.provider` 로 다중 로그인 수단을 대비한 스키마([ADR-0014](./0014-v1-data-model-schema.md))
와도 맞는다. `AUTH_URL` 은 **origin 만**(`https://chyailokunya.com`) — 경로가 섞여 들어가면
`${AUTH_URL}/api/auth/callback/chzzk` 조립이 깨진다(실제로 1Password 에 콜백 URL 전체가 들어
있었다). · **CSRF 2겹**(SameSite=Lax + **Origin 헤더 검증**) · **state 는 쿠키 이중제출**(DB 미사용,
httpOnly·10분) · **로그아웃 = 현재 기기의 family 폐기 + 로그아웃 마커 쿠키**(다중 기기는 family 로
자연 분리) · 키는 시크릿 `JWT_SIGNING_JWK`(private) / `JWT_PUBLIC_JWK`(public), `kid="v1"`.

> **로그아웃은 쿠키 삭제만으로 확정되지 않는다.** 로그아웃 직전에 proxy 가 회전 중이던 요청의
> 응답이 **나중에 도착하면** 방금 서명한 access 를 되심는다. refresh 는 DB 에서 폐기됐지만
> access 는 무상태라 최대 15분간 통과한다 — 공용 브라우저에서 "로그아웃했는데 로그인 상태"가
> 된다(적대적 리뷰가 [high] 로 잡았다). 서버가 마지막 순간에 검사해도 못 막는다: 문제는 서버
> 판정이 아니라 **브라우저의 응답 도착 순서**다. 그래서 로그아웃이 access TTL 과 같은 수명의
> 마커 쿠키(`ck_lo`)를 남기고, 이후 요청에서 proxy·세션 읽기가 세션 쿠키를 무시·삭제한다.
> 로그인(콜백)이 마커를 걷는다. DB 조회는 늘지 않는다(쿠키 존재 검사뿐).

> **CSRF 를 "3겹"으로 적었던 초안을 정정한다.** 세 번째로 세었던 "tRPC 는 JSON POST 라 preflight 가
> 강제된다"는 **방어가 아니다** — `multipart/form-data` 는 CORS simple content-type 이라 preflight
> 없이 크로스사이트 폼 POST 가 뮤테이션 경로에 도달한다. 그래서 실제 방어는 두 겹이고, 그중
> Origin 검증은 초판에 **구현 자체가 없었다**(적대적 리뷰가 잡았다). 지금은 쓰기 경로가 Origin 을
> `AUTH_URL` 과 대조해 일치할 때만 처리한다(fail-closed: Origin 이 없거나 AUTH_URL 을 모르면 거절).
> 로그아웃도 같은 검사를 받는다 — POST+SameSite 만으로는 강제 로그아웃이 막히지 않기 때문이다:
> 쿠키가 안 실려 DB 폐기는 건너뛰지만 응답의 삭제 Set-Cookie 는 그대로 적용돼 피해자가 로그아웃된다.
>
> **GET 표면은 `Sec-Fetch-Site` 로 닫는다.** Origin 은 쓰기에만 쓸 수 있다 — 브라우저가
> same-origin GET 엔 Origin 을 안 실어 주기 때문이다. 그런데 인가된 _쿼리_(치지직 카테고리 검색)
> 는 쿠키를 업고 크로스사이트에서 트리거될 수 있고, 응답을 SOP 로 못 읽어도 부수효과와 외부 API
> 쿼터는 남는다. 그래서 tRPC 경계가 `Sec-Fetch-Site: cross-site` 를 먼저 거절한다.

## 근거

- **즉시 회수가 [ADR-0012](./0012-role-based-writes-allowlist.md)·[ADR-0018](./0018-role-audit-and-elevation-guard.md)의
  전제를 되살린다.** 대가는 "인가가 필요한 요청당 DB 1회"인데, D1 로컬 읽기라 싸고 요청 스코프
  메모이즈로 1회에 묶인다. [ADR-0014](./0014-v1-data-model-schema.md)가 지키려던 것은 _읽기 경로의_
  DB 왕복 0 이었고 그건 그대로 유지된다 — 잃은 건 _쓰기 인가_ 의 캐시뿐이다.
- **비대칭(EdDSA)이라 서명 키가 퍼지지 않는다.** 검증만 하는 곳은 public key 로 충분하다.
  workerd 가 Ed25519 를 기본 지원하는 것을 실측으로 확인했다(리서치 리스크 해소).
- **opaque + 해시 저장**은 stateless refresh 로는 불가능한 폐기를 가능하게 한다.
- **회전 + 재사용 감지**는 refresh 탈취를 _탐지 가능한 사건_ 으로 바꾼다 — stateless JWT 세션에는
  없는 능력이다. family 단위 폐기로 도난 시 해당 로그인만 끊고 다른 기기는 살린다.
- **Auth.js 를 걷어낸 비용이 크지 않았다.** 치지직이 OIDC 가 아니라 `authorization`/`token`/`userinfo`
  를 이미 손으로 매핑하고 있었고, 비표준은 순수·주입가능 함수(`chzzk-api.ts`)로 격리돼 네트워크
  없이 테스트된다. 남은 건 state·쿠키·콜백인데 이건 위 결정으로 명시적으로 소유한다.

## 기각한 대안

- **Auth.js 유지 + 세션 `maxAge` 단축**(이 ADR 의 첫 판) — 회수 지연을 _줄일_ 뿐 없애지 못하고,
  짧게 할수록 재로그인이 잦아 UX 가 상한다. 근본 원인(인가 판단을 토큰에 캐시)이 남는다.
- **세션 전체를 불투명 쿠키 + 매 요청 DB 조회** — 신원 확인까지 DB 를 탄다. access 를 stateless 로
  두면 신원은 DB 0 이고 **인가만** 조회하면 되므로 이게 더 싸다.
- **refresh 도 JWT** — 폐기가 안 된다. 회전·도난 대응의 핵심을 잃는다.
- **회전 없는 장수명 refresh** — 탈취를 탐지할 방법이 없다.
- **grace 창에서 새 refresh 발급** — 도둑이 유효 토큰을 무한 증식시켜 도난 감지를 무력화한다
  (adversarial 검증이 [HIGH] 로 잡았다). 멱등 후계 반환으로 대체했다.
- **DB adapter(@auth/\*-adapter)** — 어댑터 스키마에 세션·계정을 맞춰야 하고 치지직 토큰을 저장하게
  된다. users↔oauth 분리는 우리 스키마가 소유한다([ADR-0014](./0014-v1-data-model-schema.md)).

## 결과

- (+) **역할 회수가 즉시 반영된다**(다음 인가부터). ADR-0012/0018 의 전제 회복.
- (+) **refresh 도난이 탐지·차단된다** — family 폐기 + `security_events` 감사.
- (+) 의존이 하나 줄었다(next-auth 제거). [ADR-0010](./0010-verification-first-jit-abstraction.md) YAGNI 와 정합.
- (+) 세션 수명·쿠키·회전이 `features/auth/config.ts` 한 곳에 모여 조정이 쉽다.
- (−) **CSRF·state·쿠키·회전을 우리가 소유한다.** 그래서 시간 판정을 순수 함수(`core/session.ts`)로
  뽑아 엣지·실패 케이스를 단위테스트로, 회전·재사용·family 격리를 D1 테스트로 촘촘히 덮었다.
- (−) 인가가 필요한 요청마다 DB 1회(요청 스코프 메모이즈). 공개 읽기는 영향 없음.
- (−) **키 운영이 생겼다** — JWK 쌍을 시크릿으로 관리하고, 회전은 `kid` 로 한다(`scripts/gen-jwt-keys.mjs`).
- (−) **D1 에 interactive transaction 이 없다** — 회전 원자성은 조건부 UPDATE claim 으로, 다중 문장
  원자성은 `db.batch` 로만 얻는다. `db.transaction()` 은 이 스택에서 쓰지 않는다.
