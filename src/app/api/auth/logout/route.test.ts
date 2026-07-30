/* 로그아웃 라우트의 계약(ADR-0017 Q12). 이 라우트도 커버리지 0 이었다 — e2e 는 세션을 쿠키로
   직접 심고 지우므로(ADR-0021) 이 경로를 안 탄다.

   여기서 못박는 것 중 둘은 **주석으로만 있던 방어**다: 크로스사이트 폼 POST 가 쿠키 없이도
   Set-Cookie(삭제)만으로 피해자를 로그아웃시키는 경로(Origin 검사가 끊는다), 그리고 회전 중이던
   응답이 나중에 도착해 access 를 되심는 경로(로그아웃 마커가 끊는다). 방어를 지우면 이 파일이
   빨개진다. */

import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb } from "@/db";
import { COOKIE_NAME, JWT_KID } from "@/features/auth/config";
import { issueSession, refreshSession } from "@/features/auth/session";
import { upsertChzzkAccount } from "@/features/auth/service";

const { ctx, jar } = vi.hoisted(() => ({
  ctx: { env: {} as Record<string, unknown> },
  // next/headers 의 cookies() 가 돌려주는 최소 표면(CookieJar) — 테스트마다 갈아 끼운다.
  jar: { cookies: new Map<string, string>() },
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

const { POST } = await import("./route");

const AUTH_URL = "https://chyailokunya.com";
const db = () => makeDb(env.DB);

let privateJwk: JWK;
beforeAll(async () => {
  const { privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  privateJwk = { ...(await exportJWK(privateKey)), kid: JWT_KID, alg: "EdDSA" };
});

beforeEach(() => {
  ctx.env = { ...env, AUTH_URL };
  jar.cookies = new Map();
});

function post(headers: Record<string, string> = { origin: AUTH_URL }): Promise<Response> {
  return POST(new Request(`${AUTH_URL}/api/auth/logout`, { method: "POST", headers }));
}

function setCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

// maxAge=0 이 "삭제"의 표현이다(session-cookies 의 cleared()).
function isCleared(line: string | undefined): boolean {
  return line !== undefined && /max-age=0(;|$)/i.test(line);
}

describe("POST /api/auth/logout", () => {
  it("AUTH_URL 이 없으면 503 — Host 헤더로 폴백하지 않는다(fail-closed)", async () => {
    ctx.env = { ...env, AUTH_URL: undefined };
    expect((await post()).status).toBe(503);
  });

  /* SameSite=Lax 만으로는 이걸 못 막는다: 크로스사이트 폼 POST 는 쿠키가 안 실려 DB 폐기는
     건너뛰지만, 응답의 Set-Cookie(삭제)는 그대로 적용돼 피해자가 조용히 로그아웃된다. */
  it("Origin 이 우리 것이 아니면 403 — 부재도 위조도 막는다(강제 로그아웃 CSRF)", async () => {
    const cases: Record<string, string>[] = [
      {},
      { origin: "https://evil.example" },
      { origin: "not-a-url" },
    ];
    for (const headers of cases) {
      const res = await post(headers);
      expect(res.status).toBe(403);
      // 거절이면 쿠키를 **건드리지 않아야** 한다 — 삭제 헤더가 실리면 그 자체가 공격 성공이다.
      expect(res.headers.getSetCookie()).toHaveLength(0);
    }
  });

  it("세션 쿠키를 걷고 `/` 로 303 — 로그아웃 마커를 함께 심는다", async () => {
    const res = await post();

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    expect(isCleared(setCookie(res, COOKIE_NAME.access))).toBe(true);
    expect(isCleared(setCookie(res, COOKIE_NAME.refresh))).toBe(true);
    /* 쿠키 삭제만으론 부족하다 — 이 순간 회전 중이던 요청의 응답이 나중에 도착하면 access 를
       다시 심는다. access 는 무상태라 그대로면 최대 15분 통과한다(공용 브라우저에서 "로그아웃
       했는데 로그인 상태"). 마커가 그 뒤 요청들에게 세션 쿠키를 믿지 말라고 알린다. */
    expect(setCookie(res, COOKIE_NAME.loggedOut)).toBeDefined();
  });

  it("제시된 refresh 의 family 를 DB 에서 폐기한다 — 쿠키만 지우는 게 아니다", async () => {
    const { userId } = await upsertChzzkAccount(db(), "chan-logout");
    const session = await issueSession(db(), privateJwk, userId, Date.now());
    expect(session).not.toBeNull();
    jar.cookies.set(COOKIE_NAME.refresh, session!.refresh);

    expect((await post()).status).toBe(303);

    // 폐기됐으면 같은 refresh 로 갱신이 안 된다 — 쿠키를 되살려도 세션이 안 선다.
    expect(await refreshSession(db(), privateJwk, session!.refresh, Date.now())).toBeNull();
  });

  it("refresh 쿠키가 없어도 303 으로 정리한다 — 이미 끊긴 세션의 로그아웃도 성립해야 한다", async () => {
    const res = await post();
    expect(res.status).toBe(303);
    expect(isCleared(setCookie(res, COOKIE_NAME.access))).toBe(true);
  });
});
