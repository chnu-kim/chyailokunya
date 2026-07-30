/* 치지직 OAuth 콜백의 계약(ADR-0017). **이 저장소에서 검증이 가장 비어 있던 자리다** — 유닛도
   e2e 도 안 봤고(e2e 는 access 쿠키를 직접 서명해 콜백을 건너뛴다, ADR-0021), 커버리지를 처음
   재기 전까지는 그 사실 자체가 안 보였다(ADR-0029 맥락).

   여기서 못박는 것들은 전부 **보안 경계**다: state 이중 제출(위조 콜백 차단), 실패 시 state·
   return_to 회수(일회용 보장), 복귀 경로 재검증, 그리고 superadmin 부트스트랩이 "아무도 없을
   때만" 도는 것(env 가 DB 를 매 로그인 덮으면 권한 회수가 무의미해진다).

   치지직 HTTP 두 호출만 목으로 바꾼다 — 나머지(D1 upsert·세션 발급·쿠키)는 진짜로 돈다. */

import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb } from "@/db";
import { COOKIE_NAME, JWT_KID } from "@/features/auth/config";
import {
  ensureSuperadmin,
  listRolesForChannel,
  resolveUserIdByChannel,
  upsertChzzkAccount,
} from "@/features/auth/service";
import { verifyAccessToken } from "@/features/auth/tokens";

const { ctx, jar, chzzk } = vi.hoisted(() => ({
  ctx: { env: {} as Record<string, unknown> },
  jar: { cookies: new Map<string, string>() },
  // 치지직 응답을 테스트마다 갈아 끼운다. throw 로 두면 네트워크 실패 경로가 된다.
  chzzk: {
    user: { channelId: "chan-fan", channelName: "팬" },
    exchange: null as null | (() => never),
  },
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: ctx.env }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.cookies.get(name);
      return value === undefined ? undefined : { value };
    },
  }),
}));
vi.mock("@/features/auth/chzzk-api", () => ({
  exchangeCodeForTokens: async () => {
    if (chzzk.exchange) chzzk.exchange();
    return { accessToken: "chzzk-at", refreshToken: "chzzk-rt" };
  },
  fetchChzzkUser: async () => chzzk.user,
}));

const { GET } = await import("./route");

const AUTH_URL = "https://chyailokunya.com";
const STATE = "state-nonce-1";
const db = () => makeDb(env.DB);

let privateJwk: JWK;
let publicJwk: JWK;
beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
  privateJwk = { ...(await exportJWK(privateKey)), kid: JWT_KID, alg: "EdDSA" };
  publicJwk = { ...(await exportJWK(publicKey)), kid: JWT_KID, alg: "EdDSA" };
});

beforeEach(() => {
  ctx.env = {
    ...env,
    AUTH_URL,
    CHZZK_CLIENT_ID: "client-abc",
    CHZZK_CLIENT_SECRET: "secret-abc",
    JWT_SIGNING_JWK: JSON.stringify(privateJwk),
    JWT_PUBLIC_JWK: JSON.stringify(publicJwk),
    SUPERADMIN_CHANNEL_ID: undefined,
  };
  jar.cookies = new Map([[COOKIE_NAME.state, STATE]]);
  chzzk.user = { channelId: "chan-fan", channelName: "팬" };
  chzzk.exchange = null;
});

function callback(query = `?code=auth-code&state=${STATE}`): Promise<Response> {
  return GET(new Request(`${AUTH_URL}/api/auth/callback/chzzk${query}`));
}

function location(res: Response): URL {
  return new URL(res.headers.get("location")!);
}

function setCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

function isCleared(line: string | undefined): boolean {
  return line !== undefined && /max-age=0(;|$)/i.test(line);
}

// 응답이 심은 access 쿠키를 실제로 **검증해서** 클레임을 꺼낸다 — 모양만 맞는 문자열이 아니라
// 우리 키로 서명된 토큰인지까지 본다.
async function accessClaims(res: Response) {
  const line = setCookie(res, COOKIE_NAME.access);
  if (!line) return null;
  const token = line.slice(`${COOKIE_NAME.access}=`.length).split(";")[0]!;
  return verifyAccessToken([publicJwk], decodeURIComponent(token));
}

describe("GET /api/auth/callback/chzzk — 실패 경로", () => {
  it("AUTH_URL 이 없으면 503 — 리다이렉트 대상이 요청자에게 좌우되지 않게(fail-closed)", async () => {
    ctx.env = { ...ctx.env, AUTH_URL: undefined };
    expect((await callback()).status).toBe(503);
  });

  /* 공격자는 우리 httpOnly 쿠키를 못 심으므로, 쿼리와 쿠키가 같아야 한다는 요구가 위조 콜백을
     막는다. 네 갈래 전부 같은 자리에서 끊긴다. */
  it("state 이중 제출이 안 맞으면 로그인 실패로 되돌린다 — code·state·쿠키 어느 하나만 없어도", async () => {
    const cases: [string, Map<string, string>][] = [
      [`?state=${STATE}`, new Map([[COOKIE_NAME.state, STATE]])], // code 없음
      ["?code=auth-code", new Map([[COOKIE_NAME.state, STATE]])], // 쿼리 state 없음
      [`?code=auth-code&state=${STATE}`, new Map()], // 쿠키 없음
      ["?code=auth-code&state=other", new Map([[COOKIE_NAME.state, STATE]])], // 불일치
    ];
    for (const [query, cookies] of cases) {
      jar.cookies = cookies;
      const res = await callback(query);
      expect(location(res).pathname + location(res).search).toBe("/?login=failed");
      expect(setCookie(res, COOKIE_NAME.access)).toBeUndefined();
    }
  });

  /* state 를 안 걷으면 같은 nonce 로 TTL(10분) 내내 콜백을 재시도할 수 있어 "일회용"이 코드로
     지켜지지 않는다. return_to 도 같이 걷는다 — 남기면 다음 로그인이 이번 시도의 경로로 튄다. */
  it("실패해도 state·return_to 쿠키를 걷는다 — nonce 재사용과 경로 잔여를 함께 끊는다", async () => {
    const res = await callback("?code=auth-code&state=mismatch");
    expect(isCleared(setCookie(res, COOKIE_NAME.state))).toBe(true);
    expect(isCleared(setCookie(res, COOKIE_NAME.returnTo))).toBe(true);
  });

  it("치지직 자격이 없으면 실패로 되돌린다", async () => {
    ctx.env = { ...ctx.env, CHZZK_CLIENT_SECRET: undefined };
    expect(location(await callback()).search).toBe("?login=failed");
  });

  /* 서명키만 있으면 쿠키는 발급되는데 검증자(proxy·RSC·tRPC)가 전부 공개키를 요구해 사용자는
     계속 비로그인으로 보인다 — 쓸 수 없는 세션을 만드느니 실패시킨다. */
  it("JWK 가 쌍으로 없으면 실패로 되돌린다 — 쓸 수 없는 세션을 만들지 않는다", async () => {
    for (const missing of [{ JWT_PUBLIC_JWK: undefined }, { JWT_SIGNING_JWK: undefined }]) {
      ctx.env = { ...ctx.env, ...missing };
      expect(location(await callback()).search).toBe("?login=failed");
    }
  });

  it("치지직 호출이 던지면 내부 오류를 노출하지 않고 실패로 되돌린다", async () => {
    chzzk.exchange = () => {
      throw new Error("chzzk 500");
    };
    const res = await callback();
    expect(location(res).search).toBe("?login=failed");
    expect(res.status).toBe(307);
  });
});

describe("GET /api/auth/callback/chzzk — 성공 경로", () => {
  it("세션 쿠키를 심고 로그인을 누른 페이지로 되돌린다", async () => {
    jar.cookies.set(COOKIE_NAME.returnTo, "/games");

    const res = await callback();

    expect(location(res).pathname).toBe("/games");
    expect(setCookie(res, COOKIE_NAME.refresh)).toBeDefined();
    expect(await accessClaims(res)).toMatchObject({
      channelId: "chan-fan",
      channelName: "팬",
    });
  });

  it("성공하면 state·return_to 를 걷고 로그아웃 마커를 지운다", async () => {
    const res = await callback();
    expect(isCleared(setCookie(res, COOKIE_NAME.state))).toBe(true);
    expect(isCleared(setCookie(res, COOKIE_NAME.returnTo))).toBe(true);
    /* 마커를 안 지우면 방금 로그인한 세션이 그 마커에 막혀 계속 비로그인으로 보인다 —
       proxy 와 server-session 이 둘 다 마커를 먼저 보기 때문이다. */
    expect(isCleared(setCookie(res, COOKIE_NAME.loggedOut))).toBe(true);
  });

  /* 이 쿠키는 `__Host-`+httpOnly 라 남이 못 심는다 — 여기서 한 번 더 좁히는 건 공격자가 아니라
     (a) 검증 없이 심는 경로가 나중에 생기는 것과 (b) 허용목록이 좁아진 뒤 도착한 10분 전 쿠키를
     막기 위해서다. */
  it("복귀 경로를 한 번 더 검증한다 — 허용목록 밖 값이 쿠키에 있어도 `/` 로 간다", async () => {
    jar.cookies.set(COOKIE_NAME.returnTo, "/not-a-page");
    expect(location(await callback()).pathname).toBe("/");
  });

  it("처음 보는 채널도 로그인된다 — users·oauth_accounts 를 세우고 표시명을 스냅샷한다", async () => {
    chzzk.user = { channelId: "chan-new", channelName: "새 팬" };

    const res = await callback();

    // 신원이 DB 에 앉아야 세션이 발급된다(issueSession 은 로그인 이력 없는 userId 에 null).
    expect(await resolveUserIdByChannel(db(), "chan-new")).not.toBeNull();
    expect(await accessClaims(res)).toMatchObject({
      channelId: "chan-new",
      channelName: "새 팬",
    });
  });
});

describe("superadmin 부트스트랩", () => {
  it("아무도 superadmin 이 아닐 때만 env 채널을 승격한다", async () => {
    ctx.env = { ...ctx.env, SUPERADMIN_CHANNEL_ID: "chan-boss" };
    chzzk.user = { channelId: "chan-boss", channelName: "보스" };

    await callback();

    expect(await listRolesForChannel(db(), "chan-boss")).toContain("superadmin");
  });

  /* env 가 DB 를 매 로그인 덮으면 권한 회수가 무의미해진다 — 회수해도 다음 로그인에 감사 없이
     부활하고, 최고 권한만 "즉시 회수" 계약 밖에 놓인다(ADR-0018). */
  it("이미 superadmin 이 있으면 승격하지 않는다 — 회수가 로그인으로 무효화되면 안 된다", async () => {
    const { userId } = await upsertChzzkAccount(db(), "chan-other");
    await ensureSuperadmin(db(), userId);
    await upsertChzzkAccount(db(), "chan-boss");

    ctx.env = { ...ctx.env, SUPERADMIN_CHANNEL_ID: "chan-boss" };
    chzzk.user = { channelId: "chan-boss", channelName: "보스" };
    await callback();

    expect(await listRolesForChannel(db(), "chan-boss")).not.toContain("superadmin");
  });

  it("env 채널이 아니면 승격하지 않는다", async () => {
    ctx.env = { ...ctx.env, SUPERADMIN_CHANNEL_ID: "chan-boss" };
    chzzk.user = { channelId: "chan-someone-else", channelName: "남" };

    await callback();

    expect(await listRolesForChannel(db(), "chan-someone-else")).toHaveLength(0);
  });
});
