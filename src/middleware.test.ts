/* 요청 진입점의 세션 갱신 계약(ADR-0017). 커버리지 0 이었다 — 매 요청 도는 코드인데 유닛이
   한 줄도 안 봤고, e2e 는 이미 유효한 access 쿠키를 심고 시작하므로(ADR-0021) **회전 분기와
   실패 분기를 지나가지 않는다.**

   여기서 못박는 것들은 대부분 "안 하면 조용히 나쁜 일이 나는" 종류다: 키 부재 fail-closed(안
   하면 refresh 폭주), access 유효 시 DB 0(안 지키면 모든 요청이 D1 을 문다), 회전 후 request
   쿠키 forward(안 하면 이번 요청만 옛 세션을 본다), 로그아웃 마커 우선(안 보면 로그아웃이
   최대 15분 안 먹는다). */

import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb } from "@/db";
import { ACCESS_TTL_MS, COOKIE_NAME, JWT_KID } from "@/features/auth/config";
import { issueSession } from "@/features/auth/session";
import { upsertChzzkAccount } from "@/features/auth/service";
import { signAccessToken, verifyAccessToken } from "@/features/auth/tokens";

const { ctx } = vi.hoisted(() => ({ ctx: { env: {} as Record<string, unknown> } }));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: ctx.env }),
}));

const { middleware } = await import("./middleware");

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
    JWT_SIGNING_JWK: JSON.stringify(privateJwk),
    JWT_PUBLIC_JWK: JSON.stringify(publicJwk),
  };
});

function request(cookies: Record<string, string> = {}): NextRequest {
  const jar = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest("https://chyailokunya.com/games", {
    headers: jar ? { cookie: jar } : {},
  });
}

function setCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

function isCleared(line: string | undefined): boolean {
  return line !== undefined && /max-age=0(;|$)/i.test(line);
}

// 새 세션을 발급하고 그 쿠키 쌍을 돌려준다.
async function freshSession(channelId: string) {
  const { userId } = await upsertChzzkAccount(db(), channelId, "테스터");
  const session = await issueSession(db(), privateJwk, userId, Date.now());
  expect(session).not.toBeNull();
  return { userId, ...session! };
}

describe("middleware — 통과 경로", () => {
  /* 한쪽 키만 있는 오설정에서 계속 회전을 시도하면 요청마다 refresh 행이 늘고 세션이 영영
     안착하지 못한다. 세션 기능 자체를 끈 비로그인으로 통과시킨다. */
  it("JWK 가 쌍으로 없으면 세션 기능을 끄고 통과한다(fail-closed) — 조용한 refresh 폭주 금지", async () => {
    for (const missing of [{ JWT_PUBLIC_JWK: undefined }, { JWT_SIGNING_JWK: undefined }]) {
      ctx.env = { ...ctx.env, ...missing };
      const res = await middleware(request({ [COOKIE_NAME.refresh]: "whatever" }));
      expect(res.headers.getSetCookie()).toHaveLength(0);
    }
  });

  it("세션 쿠키가 없으면 그냥 통과한다 — 익명 트래픽에 Set-Cookie 를 붙이지 않는다", async () => {
    const res = await middleware(request());
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  /* 배포 후 __Host- 쿠키가 없는 요청엔 익명 방문자와 "구 이름 쿠키만 남은" 사용자가 섞인다.
     후자면 만료를 실어 수동 브라우징에서도 구 쿠키가 정리되게 한다. */
  it("구 이름 쿠키만 남았으면 만료를 실어 정리한다", async () => {
    const res = await middleware(request({ ck_at: "old-token" }));
    expect(isCleared(setCookie(res, "ck_at"))).toBe(true);
  });

  it("access 가 유효하면 서명 검증만 하고 통과한다 — refresh 를 쓰지 않는다", async () => {
    const session = await freshSession("chan-valid");
    const res = await middleware(
      request({ [COOKIE_NAME.access]: session.access, [COOKIE_NAME.refresh]: session.refresh }),
    );
    /* 회전이 돌았다면 새 쿠키가 실린다 — 안 실렸다는 건 DB 를 안 물었다는 뜻이다.
       이게 깨지면 공개 읽기 트래픽 전부가 요청마다 D1 왕복을 한다. */
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});

describe("middleware — 회전", () => {
  it("access 가 없고 refresh 가 유효하면 회전해 새 쿠키를 심는다", async () => {
    const session = await freshSession("chan-rotate");

    const res = await middleware(request({ [COOKIE_NAME.refresh]: session.refresh }));

    const access = setCookie(res, COOKIE_NAME.access);
    expect(access).toBeDefined();
    const rotated = setCookie(res, COOKIE_NAME.refresh)!;
    // 회전이므로 refresh 값도 새것이어야 한다 — 같으면 재사용 감지가 성립하지 않는다.
    expect(rotated).not.toContain(session.refresh);

    const token = access!.slice(`${COOKIE_NAME.access}=`.length).split(";")[0]!;
    expect(await verifyAccessToken([publicJwk], decodeURIComponent(token))).toMatchObject({
      channelId: "chan-rotate",
    });
  });

  /* 응답 쿠키만 심으면 **이번 요청의 다운스트림(RSC·route·tRPC)은 옛 쿠키를 본다** — 갱신 직후
     한 번은 비로그인으로 렌더된다. request.cookies 를 덮어 forward 해야 그 창이 닫힌다. */
  it("갱신한 access 를 같은 요청의 다운스트림에 forward 한다", async () => {
    const session = await freshSession("chan-forward");
    const req = request({ [COOKIE_NAME.refresh]: session.refresh });

    await middleware(req);

    const forwarded = req.cookies.get(COOKIE_NAME.access)?.value;
    expect(forwarded).toBeDefined();
    expect(await verifyAccessToken([publicJwk], forwarded!)).toMatchObject({
      channelId: "chan-forward",
    });
  });

  it("도난·만료 refresh 면 세션 쿠키를 걷고 비로그인으로 통과한다 — 공개 읽기는 계속된다", async () => {
    const res = await middleware(request({ [COOKIE_NAME.refresh]: "not-a-real-token" }));

    expect(isCleared(setCookie(res, COOKIE_NAME.access))).toBe(true);
    expect(isCleared(setCookie(res, COOKIE_NAME.refresh))).toBe(true);
    // 요청 자체는 통과해야 한다 — 세션이 죽었다고 공개 페이지가 막히면 안 된다.
    expect(res.status).toBe(200);
  });
});

describe("middleware — 로그아웃 마커", () => {
  /* 로그아웃 직전에 회전 중이던 요청의 응답이 나중에 도착해 access 를 되심을 수 있다. access 는
     무상태라 그대로면 최대 15분 통과한다 — 공용 브라우저에서 "로그아웃했는데 로그인 상태". */
  it("마커가 있으면 유효한 access 도 믿지 않는다", async () => {
    const session = await freshSession("chan-logged-out");
    const req = request({
      [COOKIE_NAME.access]: session.access,
      [COOKIE_NAME.loggedOut]: "1",
    });

    const res = await middleware(req);

    expect(isCleared(setCookie(res, COOKIE_NAME.access))).toBe(true);
    // 이번 요청의 다운스트림도 세션을 못 보게 한다 — 응답만 고치면 이 요청은 로그인 상태다.
    expect(req.cookies.get(COOKIE_NAME.access)).toBeUndefined();
  });

  it("마커가 있으면 refresh 회전도 안 한다 — 되살아날 경로를 통째로 끊는다", async () => {
    const session = await freshSession("chan-lo-refresh");
    const res = await middleware(
      request({ [COOKIE_NAME.refresh]: session.refresh, [COOKIE_NAME.loggedOut]: "1" }),
    );

    // 회전했다면 새 access 가 값과 함께 실린다 — 삭제(max-age=0)여야 한다.
    expect(isCleared(setCookie(res, COOKIE_NAME.access))).toBe(true);
  });
});

describe("middleware — 만료된 access", () => {
  it("만료된 access 는 refresh 로 갈아 끼운다", async () => {
    const session = await freshSession("chan-expired");
    // 과거 시각으로 서명해 이미 만료된 access 를 만든다.
    const expired = await signAccessToken(
      privateJwk,
      { userId: session.userId, channelId: "chan-expired", channelName: "테스터" },
      ACCESS_TTL_MS,
      Date.now() - ACCESS_TTL_MS * 2,
    );

    const res = await middleware(
      request({ [COOKIE_NAME.access]: expired, [COOKIE_NAME.refresh]: session.refresh }),
    );

    expect(setCookie(res, COOKIE_NAME.access)).toBeDefined();
    expect(setCookie(res, COOKIE_NAME.refresh)).toBeDefined();
  });
});
