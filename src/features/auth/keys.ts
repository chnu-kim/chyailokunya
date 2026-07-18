/* env 의 JWK JSON 문자열을 jose JWK 로 파싱(ADR-0017). private=서명(로그인·refresh), public=검증
   (proxy·tRPC). app 이 getCloudflareContext().env 에서 문자열을 꺼내 이 순수 파서에 넘긴다 —
   features 는 env 를 모른다. 파싱 실패·부재는 설정 오류라 throw(부팅 즉시 드러난다). */

import type { JWK } from "jose";

/* 같은 JSON 이면 **같은 객체**를 돌려준다. jose 는 임포트한 CryptoKey 를 JWK 객체 정체성으로
   WeakMap 캐시하는데, 매번 JSON.parse 로 새 객체를 만들면 그 캐시가 구조적으로 100% 미스가 되어
   요청마다 importKey(Ed25519)를 다시 문다. JWK 문자열은 배포 동안 불변인 env 값이라 isolate
   수명 캐시가 안전하다(값이 바뀌면 키가 달라져 자연히 새로 파싱된다). */
const parsed = new Map<string, JWK>();

export function parseJwk(json: string | undefined, label: string): JWK {
  if (!json) throw new Error(`${label} 미설정 — 인증 키가 필요해요`);
  const hit = parsed.get(json);
  if (hit) return hit;

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`${label} 파싱 실패 — JWK JSON 이어야 해요`);
  }
  if (!value || typeof value !== "object") {
    throw new Error(`${label} 파싱 실패 — JWK JSON 이어야 해요`);
  }

  const jwk = value as JWK;
  parsed.set(json, jwk);
  return jwk;
}
