# ADR-0006: 인증은 치지직 커스텀 OAuth → 자체 JWT 세션

- 상태: Accepted
- 날짜: 2026-07-18

> **보완:** [ADR-0014](./0014-v1-data-model-schema.md) 가 이 결정을 정교화했다 — `channelId` 는
> `users` 가 아니라 `oauth_accounts.provider_user_id` 로 내려가고(users ↔ OAuth 분리, 다중 로그인
> 수단 대비), 세션엔 `role` 대신 **effective authorities** 를 싣는다. 이 ADR 의 핵심(치지직 커스텀
> OAuth → 자체 JWT, 치지직 토큰 미저장)은 그대로 유효하다.
>
> **보완:** [ADR-0017](./0017-authjs-chzzk-provider-edge-env.md) 가 _무엇으로_ 구현할지를 정했다 —
> Auth.js(next-auth v5) 커스텀 provider + lazy config 로 Workers 요청 스코프 env 주입 + JWT 세션 전략
> (DB adapter 미사용). 이 ADR 의 핵심은 그대로다.

## 맥락

v1 은 전원 치지직 로그인, allowlist(channelId) 계정만 쓰기. 치지직 Open API 는 표준
OIDC 가 아니라 자체 OAuth 흐름을 쓴다. 신원의 안정 식별자는 `channelId` 다.

## 결정

치지직 OAuth 를 **커스텀 프로바이더**로 붙이고, 로그인 순간에만 치지직 토큰으로 신원을
확인한 뒤 **자체 JWT 세션 `{channelId, role}`** 을 발급한다. 이후 요청은 치지직 토큰이
아니라 이 세션이 담당한다.

검증된 계약:

- 인증 코드: `GET https://chzzk.naver.com/account-interlock?clientId&redirectUri&state`
- 토큰: `POST /auth/v1/token` (access 1일 / refresh 30일)
- 신원: `GET /open/v1/users/me` → `channelId`(안정) + `channelName`

## 근거

- 표준 OIDC 가 아니므로 off-the-shelf 프로바이더로는 안 된다 — authorization/token/userinfo
  매핑을 직접 짠다.
- 세션을 자체 JWT 로 들면 치지직 토큰을 장기 보관·갱신할 필요가 없다(로그인 시 1회 신원
  확인이면 충분). 저장하는 비밀이 줄어 유출면이 작아진다.
- `role` 을 세션에 담아 매 요청 인가를 서버에서 값싸게 판단한다([ADR-0012](./0012-role-based-writes-allowlist.md)).

## 기각한 대안

- **치지직 토큰을 세션으로 그대로 사용** — 만료·갱신·폐기를 우리가 떠안고, 매 요청 외부
  의존이 생긴다.
- **범용 Auth 라이브러리 표준 프로바이더** — 치지직이 OIDC 가 아니라 그대로는 안 맞는다.

## 결과

- (+) 세션 수명·역할을 우리가 통제. 외부 토큰 갱신 부담 없음.
- (−) 커스텀 프로바이더는 손이 많이 간다(콜백·state·CSRF·매핑). Phase 4 의 핵심 리스크.
- (−) redirect URI 는 안정 배포 URL 이 필요해 Phase 0(앱 등록)·Phase 5(도메인)가 상호 의존.
- 비밀(`CHZZK_CLIENT_SECRET`·`AUTH_SECRET`·`SUPERADMIN_CHANNEL_ID`)은 저장소가 아니라
  Cloudflare secret / 1Password Environment 로만 주입한다.
