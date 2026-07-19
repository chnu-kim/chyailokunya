/* 치지직 사용자 OAuth: authorization_code 토큰 교환 + 신원 조회(ADR-0006). category
   API(features/chzzk/client.ts)와 같은 공통 어댑터(features/chzzk-http.ts)를 쓰되, 이쪽은
   로그인 순간에만 쓴다 — 토큰은 저장하지 않고(ADR-0006) 자체 JWT 로 넘어간다. 순수 함수라
   콜백 라우트(app/api/auth/callback/chzzk)가 호출하고, 네트워크 없이 매핑·에러 경로를
   단위테스트한다. 치지직 계약의 비표준(camelCase body·state 재전송)이 여기 갇힌다. */

import { asRecord, callChzzkApi, chzzkUrl, str, type ChzzkCreds } from "@/features/chzzk-http";

export type ChzzkTokens = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  expiresIn: number | null;
};

export type ChzzkUser = { channelId: string; channelName: string };

/* 인가 코드 → 토큰. JSON body 의 키는 camelCase 이고 state 를 재전송한다(치지직 요구 —
   표준 OAuth2 엔 없는 항목). 토큰은 반환만 하고 저장하지 않는다. code !== 200 이나
   accessToken 부재는 로그인 실패로 던진다(provider 가 잡아 인증 거절). */
export async function exchangeCodeForTokens(
  creds: ChzzkCreds,
  code: string,
  state: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ChzzkTokens> {
  const content = await callChzzkApi(
    chzzkUrl("/auth/v1/token"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grantType: "authorization_code",
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        code,
        state,
      }),
    },
    "토큰 교환",
    fetchImpl,
  );

  const c = asRecord(content);
  const accessToken = str(c.accessToken);
  if (!accessToken) throw new Error("치지직 토큰 응답에 accessToken 이 없어요");

  const expiresInRaw = c.expiresIn;
  const expiresIn =
    typeof expiresInRaw === "number"
      ? expiresInRaw
      : Number.isFinite(Number(expiresInRaw))
        ? Number(expiresInRaw)
        : null;
  return {
    accessToken,
    refreshToken: str(c.refreshToken) || null,
    tokenType: str(c.tokenType) || null,
    expiresIn,
  };
}

/* accessToken 으로 신원 조회. channelId 가 안정 식별자(oauth_accounts.provider_user_id 로
   내려감). Bearer 헤더로 인증하고 envelope 를 파싱한다 — channelId 가 없으면 신원 확인
   실패로 던진다(방어: 세션에 빈 신원이 실리지 않게). */
export async function fetchChzzkUser(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ChzzkUser> {
  const content = await callChzzkApi(
    chzzkUrl("/open/v1/users/me"),
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "사용자 조회",
    fetchImpl,
  );

  const c = asRecord(content);
  const channelId = str(c.channelId).trim();
  if (!channelId) throw new Error("치지직 사용자 응답에 channelId 가 없어요");
  return { channelId, channelName: str(c.channelName) };
}
