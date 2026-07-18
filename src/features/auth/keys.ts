/* env 의 JWK JSON 문자열을 jose JWK 로 파싱(ADR-0017). private=서명(로그인·refresh), public=검증
   (proxy·tRPC). app 이 getCloudflareContext().env 에서 문자열을 꺼내 이 순수 파서에 넘긴다 —
   features 는 env 를 모른다. 파싱 실패·부재는 설정 오류라 throw(부팅 즉시 드러난다). */

import type { JWK } from "jose";

export function parseJwk(json: string | undefined, label: string): JWK {
  if (!json) throw new Error(`${label} 미설정 — 인증 키가 필요해요`);
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as JWK;
  } catch {
    throw new Error(`${label} 파싱 실패 — JWK JSON 이어야 해요`);
  }
}
