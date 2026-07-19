/* env 의 JWK JSON 문자열 → jose JWK(ADR-0017). private=서명(로그인·refresh), public=검증
   (proxy·서버 컴포넌트·tRPC). app 이 getCloudflareContext().env 를 통째로 넘기고, 어떤 env
   키를 어떤 라벨로 읽는지는 이 파일이 정한다 — 전에는 짝 검사와 parseJwk("JWT_PUBLIC_JWK")
   호출이 세 곳에 중복돼 라벨 문자열이 흩어져 있었다. 파싱 실패는 설정 오류라 throw
   (부팅 즉시 드러난다). */

import type { JWK } from "jose";

type KeyEnv = { JWT_PUBLIC_JWK?: string; JWT_SIGNING_JWK?: string };

/* 같은 JSON 이면 **같은 객체**를 돌려준다. jose 는 임포트한 CryptoKey 를 JWK 객체 정체성으로
   WeakMap 캐시하는데, 매번 JSON.parse 로 새 객체를 만들면 그 캐시가 구조적으로 100% 미스가 되어
   요청마다 importKey(Ed25519)를 다시 문다. JWK 문자열은 배포 동안 불변인 env 값이라 isolate
   수명 캐시가 안전하다(값이 바뀌면 키가 달라져 자연히 새로 파싱된다). */
const parsed = new Map<string, JWK>();

function parseJwk(json: string, label: string): JWK {
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

export type SessionKeys = {
  /* 검증 키 목록 — 단일 키(v1)지만 kid 다중키 회전(config.JWT_KID)을 대비해 배열이다. */
  verificationKeys(): JWK[];
  signingKey(): JWK;
};

/* 키는 쌍으로만 의미가 있다 — 한쪽만 있는 설정은 오설정이다. public 만 빠지면 access 검증이
   **영원히 실패**해 모든 요청이 회전 분기로 떨어지고(요청마다 refresh 행이 늘며 세션이 안착하지
   못한다), 서명키만 있으면 세션 쿠키는 발급되지만 검증자가 전부 공개키를 필요로 해 사용자는
   계속 비로그인으로 보인다(쓸 수 없는 세션). 그래서 어느 쪽이 빠져도 null — 호출자는 세션
   기능 자체를 끈 fail-closed 로 처리한다(조용한 폭주 금지). 파싱은 게터 호출 시점까지 미룬다 —
   짝 확인만 하는 경로(access 검증 없이 통과 등)가 안 쓸 키까지 미리 파싱하지 않게. */
export function sessionKeys(env: KeyEnv): SessionKeys | null {
  const publicJson = env.JWT_PUBLIC_JWK;
  const signingJson = env.JWT_SIGNING_JWK;
  if (!publicJson || !signingJson) return null;
  return {
    verificationKeys: () => [parseJwk(publicJson, "JWT_PUBLIC_JWK")],
    signingKey: () => parseJwk(signingJson, "JWT_SIGNING_JWK"),
  };
}

/* 검증만 하는 읽기 경로(server-session)용 — 서명키 없이도 access 검증은 성립하므로 짝을
   요구하지 않는다(요구하면 "읽기만 되는 배포 중간 상태"에서 로그인 표시가 통째로 죽는다).
   공개키 부재는 비로그인(null)으로 처리한다. */
export function verificationKeys(env: Pick<KeyEnv, "JWT_PUBLIC_JWK">): JWK[] | null {
  return env.JWT_PUBLIC_JWK ? [parseJwk(env.JWT_PUBLIC_JWK, "JWT_PUBLIC_JWK")] : null;
}
