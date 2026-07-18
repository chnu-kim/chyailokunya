/* 자체 세션 토큰(ADR-0017). access = EdDSA(Ed25519) JWT(jose) — stateless, 검증 시 DB 무관.
   refresh = opaque 난수 + sha256 해시(원본 저장 안 함). 서명은 private JWK(Worker), 검증은
   public JWK(proxy·tRPC·서버컴포넌트) 로 갈린다. algorithms 를 config 의 JWT_ALG 로 못박아
   alg confusion 을 차단한다(불변식 2). 시간은 인자로 받아 서명하고, 검증 만료는 jose 가 현재
   시각으로 판정한다. */

import { base64url, createLocalJWKSet, importJWK, jwtVerify, SignJWT, type JWK } from "jose";
import { JWT_ALG, JWT_AUDIENCE, JWT_ISSUER, JWT_KID } from "./config";

export type AccessClaims = { userId: number; channelId: string; channelName: string };

/* access JWT 서명. sub=userId, 커스텀 클레임에 channelId·channelName(표시명은 DB 아닌 세션).
   now·ttlMs 로 iat/exp(초 단위)를 계산해 서명 결정성을 확보한다. */
export async function signAccessToken(
  privateJwk: JWK,
  claims: AccessClaims,
  ttlMs: number,
  now: number,
): Promise<string> {
  const key = await importJWK(privateJwk, JWT_ALG);
  const iat = Math.floor(now / 1000);
  return new SignJWT({ channelId: claims.channelId, channelName: claims.channelName })
    .setProtectedHeader({ alg: JWT_ALG, kid: JWT_KID, typ: "JWT" })
    .setSubject(String(claims.userId))
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(Math.floor((now + ttlMs) / 1000))
    .sign(key);
}

/* access JWT 검증. 실패(만료·서명·alg·iss/aud·malformed)는 예외가 아니라 null 로 좁혀 소비자가
   "비로그인"으로 다루게 한다. algorithms 를 JWT_ALG 로 고정(alg confusion 차단), createLocalJWKSet
   가 kid 로 키를 골라 회전을 처리한다. sub 가 정수 userId 로 좁혀지지 않으면 null. */
export async function verifyAccessToken(
  publicJwks: JWK[],
  jwt: string,
): Promise<AccessClaims | null> {
  try {
    // 검증 경로에 private 성분(d)이 섞이면 = 공개측에 private 키를 실수로 배포한 것. 서명능력
    // 유출이라 검증 자체를 거부해 실수를 드러낸다(fail-safe, 불변식 4).
    if (publicJwks.some((k) => typeof (k as { d?: unknown }).d === "string")) return null;
    const jwks = createLocalJWKSet({ keys: publicJwks });
    const { payload } = await jwtVerify(jwt, jwks, {
      algorithms: [JWT_ALG],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    return {
      userId,
      channelId: typeof payload.channelId === "string" ? payload.channelId : "",
      channelName: typeof payload.channelName === "string" ? payload.channelName : "",
    };
  } catch {
    return null;
  }
}

/* refresh 토큰 = 암호학적 난수 32바이트(base64url). opaque — 서명·파싱 없이 DB 해시 조회로만
   검증한다. Math.random 이 아니라 crypto.getRandomValues 로 예측 불가하게 만든다. */
export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url.encode(bytes);
}

/* grace 멱등 후계를 **저장하지 않고 재계산**한다(ADR-0017).

   초판은 후계 평문을 구 행의 replaced_by_token 에 심었다. 그 값이 지워지기 전까지 *현재 활성*
   refresh 의 평문이 DB 에 남아 "해시만 저장" 경계가 깨졌고, 청소를 지연 호출로 바꿔도 다음
   요청이 올 때까지(최대 sliding TTL) 남았다 — 적대적 리뷰가 배포 차단으로 지적한 지점이다.

   successor = HMAC-SHA256(key = 서명 JWK 에서 파생한 서버 비밀, msg = 구 토큰).
   - DB 를 통째로 읽어도 후계를 만들 수 없다: 구 토큰 평문도 서버 비밀도 DB 에 없다.
   - 구 토큰을 훔친 자도 서버 비밀 없이는 오프라인 유도가 불가능하다 — 여전히 제시해야 하고,
     grace 밖이면 도난으로 탐지된다(탐지 능력이 보존된다).
   - 같은 구 토큰이면 항상 같은 후계라 동시 탭이 수렴한다(멱등). */
export async function deriveSuccessorToken(privateJwk: JWK, oldToken: string): Promise<string> {
  const material = typeof privateJwk.d === "string" ? privateJwk.d : "";
  if (!material) throw new Error("deriveSuccessorToken: private JWK 에 d 성분이 없다");
  // 서명 키를 HMAC 에 그대로 쓰지 않고 용도 라벨을 섞어 파생한다(키 분리).
  const keyBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("chyailokunya/refresh-successor/v1|" + material),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(oldToken));
  return base64url.encode(new Uint8Array(mac));
}

/* refresh 원본을 DB 에 저장하지 않고 sha256 해시만 둔다(DB 유출 시 재사용 방지). hex 로 저장해
   token_hash UNIQUE 조회의 정본 키로 쓴다. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
