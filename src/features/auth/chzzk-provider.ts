/* 치지직 커스텀 OAuth provider(ADR-0006·0017). 치지직은 표준 OIDC 가 아니라 off-the-shelf
   provider 로 안 되므로 authorization/token/userinfo 를 직접 매핑한다. 비표준(camelCase 인가
   파라미터·JSON body·state 재전송·envelope 응답)은 chzzk-api.ts 순수 함수에 갇히고, 여기선
   Auth.js 계약(TokenSet 은 snake_case·Profile)으로 잇는다. state 검증(CSRF)은 Auth.js 가
   checks:["state"] 로 맡는다 — 우리는 그 state 를 토큰 교환 body 에 재전송만 한다. */

import type { OAuth2Config } from "next-auth/providers";
import type { ChzzkCreds } from "@/features/chzzk/client";
import { exchangeCodeForTokens, fetchChzzkUser } from "./chzzk-api";

// userinfo 가 돌려주는 raw profile. profile() 이 Auth.js User 로, jwt 콜백이 upsert 키로 쓴다.
export type ChzzkProfile = { channelId: string; channelName: string };

const AUTHORIZE_URL = "https://chzzk.naver.com/account-interlock";
const TOKEN_URL = "https://openapi.chzzk.naver.com/auth/v1/token";
const USERINFO_URL = "https://openapi.chzzk.naver.com/open/v1/users/me";

export function chzzkProvider(
  opts: ChzzkCreds & { redirectUri: string },
): OAuth2Config<ChzzkProfile> {
  const creds: ChzzkCreds = { clientId: opts.clientId, clientSecret: opts.clientSecret };
  return {
    id: "chzzk",
    name: "치지직",
    type: "oauth",
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    checks: ["state"],
    /* 치지직은 camelCase 파라미터(clientId·redirectUri)를 읽는다. Auth.js 가 표준 client_id·
       redirect_uri·state 도 덧붙이지만 치지직은 그걸 무시한다(실측 대상, ADR-0017 리스크).
       redirectUri 는 등록된 콜백 URL 과 문자 단위로 일치해야 한다. */
    authorization: {
      url: AUTHORIZE_URL,
      params: { clientId: opts.clientId, redirectUri: opts.redirectUri },
    },
    /* 표준 교환이 아니라 커스텀 request 로 JSON body·state 재전송을 처리한다(chzzk-api). 반환은
       Auth.js TokenSet(snake_case)로 매핑한다. state 는 콜백 params 를 우선하고 Auth.js 가 검증한
       checks.state 로 폴백한다(둘은 같아야 정상). */
    token: {
      url: TOKEN_URL,
      // 인자 타입을 명시한다 — token 은 `string | TokenEndpointHandler` union 이라 리터럴
      // contextual 추론이 실패해 params·checks 가 implicit any 로 샌다. any 좁힘은 여기 한 번만.
      async request({
        params,
        checks,
      }: {
        params: Record<string, unknown>;
        checks: { state?: string };
      }) {
        const code = String(params.code ?? "");
        const state = String(params.state ?? checks.state ?? "");
        const t = await exchangeCodeForTokens(creds, code, state);
        return {
          tokens: {
            access_token: t.accessToken,
            refresh_token: t.refreshToken ?? undefined,
            token_type: t.tokenType ?? "Bearer",
            expires_in: t.expiresIn ?? undefined,
          },
        };
      },
    },
    userinfo: {
      url: USERINFO_URL,
      async request({ tokens }: { tokens: { access_token?: string } }) {
        return fetchChzzkUser(String(tokens.access_token ?? ""));
      },
    },
    // Auth.js User 로 매핑. 우리 DB userId 는 jwt 콜백이 channelId 로 upsert 하니 여기선 id=channelId.
    profile(profile) {
      return { id: profile.channelId, name: profile.channelName };
    },
  };
}
