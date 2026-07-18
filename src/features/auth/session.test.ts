import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { makeDb } from "@/db";
import { JWT_KID } from "./config";
import { issueSession, refreshSession } from "./session";
import { upsertChzzkAccount } from "./service";
import { verifyAccessToken } from "./tokens";

/* 세션 오케스트레이션: 신원(getIdentity) + refresh family(refresh-service) + access 서명(tokens)을
   엮어 로그인 발급·refresh 갱신을 만든다. D1 + jose 키로 검증한다. */

let privateJwk: JWK;
let publicJwk: JWK;
beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
  privateJwk = { ...(await exportJWK(privateKey)), kid: JWT_KID, alg: "EdDSA" };
  publicJwk = { ...(await exportJWK(publicKey)), kid: JWT_KID, alg: "EdDSA" };
});

const db = () => makeDb(env.DB);
// access exp 는 jose 가 실제 현재 시각으로 검증하므로, 가짜 과거 시각이 아니라 실제 now 를 쓴다.
const now = () => Date.now();

describe("issueSession", () => {
  it("신원으로 access(검증 가능)와 refresh 를 발급한다", async () => {
    const { userId } = await upsertChzzkAccount(db(), "chan-a", "쿠냐");
    const s = await issueSession(db(), privateJwk, userId, now());
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.refresh).toBeTruthy();
    expect(await verifyAccessToken([publicJwk], s.access)).toEqual({
      userId,
      channelId: "chan-a",
      channelName: "쿠냐",
    });
  });

  it("로그인 이력 없는 userId 는 null", async () => {
    expect(await issueSession(db(), privateJwk, 9999, now())).toBeNull();
  });
});

describe("refreshSession", () => {
  it("refresh 로 새 access·refresh 를 발급하고 표시명을 유지한다", async () => {
    const { userId } = await upsertChzzkAccount(db(), "chan-a", "쿠냐");
    const first = await issueSession(db(), privateJwk, userId, now());
    if (!first) throw new Error("issue failed");

    const next = await refreshSession(db(), privateJwk, first.refresh, now() + 60_000);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.refresh).not.toBe(first.refresh); // rotation
    expect(await verifyAccessToken([publicJwk], next.access)).toEqual({
      userId,
      channelId: "chan-a",
      channelName: "쿠냐",
    });
  });

  it("무효(도난/폐기된) refresh 는 null", async () => {
    expect(await refreshSession(db(), privateJwk, "bogus-refresh", now())).toBeNull();
  });
});
