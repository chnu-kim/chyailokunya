import { base64url, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { JWT_AUDIENCE, JWT_ISSUER, JWT_KID } from "./config";
import {
  generateRefreshToken,
  hashToken,
  signAccessToken,
  verifyAccessToken,
  type AccessClaims,
} from "./tokens";

/* jose EdDSA(Ed25519) 서명·검증이 workerd(vitest 워커 풀)에서 실제로 도는지까지 겸해 검증한다
   (리서치 리스크 실측). 키쌍은 매 스위트 1회 생성한다. */

let privateJwk: JWK;
let publicJwk: JWK;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
  privateJwk = { ...(await exportJWK(privateKey)), kid: JWT_KID, alg: "EdDSA" };
  publicJwk = { ...(await exportJWK(publicKey)), kid: JWT_KID, alg: "EdDSA" };
});

const claims: AccessClaims = { userId: 42, channelId: "chan-abc", channelName: "쿠냐" };
const TTL = 15 * 60 * 1000;

describe("access token 서명·검증", () => {
  it("서명한 토큰을 검증하면 클레임이 돌아온다(왕복)", async () => {
    const jwt = await signAccessToken(privateJwk, claims, TTL, Date.now());
    expect(await verifyAccessToken([publicJwk], jwt)).toEqual(claims);
  });

  it("만료된 토큰(exp 과거)은 null", async () => {
    const jwt = await signAccessToken(privateJwk, claims, -1000, Date.now());
    expect(await verifyAccessToken([publicJwk], jwt)).toBeNull();
  });

  it("서명 변조 토큰은 null", async () => {
    const jwt = await signAccessToken(privateJwk, claims, TTL, Date.now());
    const tampered = jwt.slice(0, -2) + (jwt.endsWith("AA") ? "BB" : "AA");
    expect(await verifyAccessToken([publicJwk], tampered)).toBeNull();
  });

  it("다른 키로 서명한 토큰은 null", async () => {
    const other = await generateKeyPair("EdDSA", { extractable: true });
    const otherJwk = { ...(await exportJWK(other.privateKey)), kid: JWT_KID, alg: "EdDSA" };
    const jwt = await signAccessToken(otherJwk, claims, TTL, Date.now());
    expect(await verifyAccessToken([publicJwk], jwt)).toBeNull();
  });

  it("alg='none' 위조는 null (algorithms 고정)", async () => {
    const enc = (o: unknown) => base64url.encode(new TextEncoder().encode(JSON.stringify(o)));
    const forged =
      enc({ alg: "none", typ: "JWT", kid: JWT_KID }) +
      "." +
      enc({ sub: "42", iss: JWT_ISSUER, aud: JWT_AUDIENCE }) +
      ".";
    expect(await verifyAccessToken([publicJwk], forged)).toBeNull();
  });

  it("alg=HS256 confusion(public key 를 HMAC secret 으로)은 null", async () => {
    // Ed25519 public key raw(x)를 HMAC secret 으로 HS256 서명 — algorithms:['EdDSA'] 가 거부해야 함.
    const secret = base64url.decode(publicJwk.x as string);
    const forged = await new SignJWT({ channelId: "x", channelName: "y" })
      .setProtectedHeader({ alg: "HS256", kid: JWT_KID })
      .setSubject("42")
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setExpirationTime("15m")
      .sign(secret);
    expect(await verifyAccessToken([publicJwk], forged)).toBeNull();
  });

  it("malformed(세그먼트 부족)는 null", async () => {
    expect(await verifyAccessToken([publicJwk], "a.b")).toBeNull();
    expect(await verifyAccessToken([publicJwk], "")).toBeNull();
  });

  it("검증 키에 private 성분(d)이 섞이면 거부한다(공개측 오설정 fail-safe)", async () => {
    const jwt = await signAccessToken(privateJwk, claims, TTL, Date.now());
    // private JWK(d 포함)를 검증측에 넘기는 건 설정 실수 — 서명능력 유출이므로 검증을 거부한다.
    expect(await verifyAccessToken([privateJwk], jwt)).toBeNull();
  });
});

describe("refresh 토큰", () => {
  it("generateRefreshToken 은 매번 다르고 충분히 길다(32바이트)", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32B base64url ≈ 43자
  });

  it("hashToken 은 결정적이고 원본과 다르다(sha256 hex)", async () => {
    const t = "opaque-refresh-secret";
    expect(await hashToken(t)).toBe(await hashToken(t));
    expect(await hashToken(t)).not.toBe(t);
    expect(await hashToken(t)).toHaveLength(64);
  });
});
