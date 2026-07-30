/* 팬아트 업로드의 계약(ADR-0028). 커버리지 0 이었다 — e2e 는 5MB 본문 스펙이 dev 서버를 묶어
   무관한 스펙을 줄줄이 타임아웃시켰고(AGENTS 지뢰), 그래서 큰 본문 계약은 애초에 e2e 로 못
   재기로 한 자리다. 여기가 그 판정이 사는 층이다.

   **인가는 목으로 건너뛰지 않는다** — `next/headers` 의 쿠키만 갈아 끼우고 access 검증·역할
   조회·권한 파생은 진짜로 돌린다(불변식 3: 서버가 정본). 목으로 authorities 를 주면 정작
   막아야 할 판정이 테스트 밖으로 나간다. */

import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FANART_MAX_BYTES, fanartObjectKey, isFanartKey } from "@/core/fanart";
import { makeDb } from "@/db";
import { ACCESS_TTL_MS, COOKIE_NAME, JWT_KID } from "@/features/auth/config";
import { ensureSuperadmin, upsertChzzkAccount } from "@/features/auth/service";
import { signAccessToken } from "@/features/auth/tokens";

const { ctx, jar } = vi.hoisted(() => ({
  ctx: { env: {} as Record<string, unknown> },
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

// PNG 매직 바이트(89 50 4E 47 0D 0A 1A 0A) + 패딩. sniffImageType 은 앞 12바이트만 본다.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);

let privateJwk: JWK;
let publicJwk: JWK;
beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
  privateJwk = { ...(await exportJWK(privateKey)), kid: JWT_KID, alg: "EdDSA" };
  publicJwk = { ...(await exportJWK(publicKey)), kid: JWT_KID, alg: "EdDSA" };
});

beforeEach(() => {
  ctx.env = { ...env, AUTH_URL, JWT_PUBLIC_JWK: JSON.stringify(publicJwk) };
  jar.cookies = new Map();
});

/* 진짜 access 쿠키를 심는다 — e2e 세션 픽스처와 같은 발상이다(ADR-0021). 서명·검증 경로가
   그대로 돌아야 "인가를 실제로 통과했다"가 성립한다. */
async function signInAs(channelId: string, superadmin = false): Promise<void> {
  const { userId } = await upsertChzzkAccount(db(), channelId, "테스터");
  if (superadmin) await ensureSuperadmin(db(), userId);
  const access = await signAccessToken(
    privateJwk,
    { userId, channelId, channelName: "테스터" },
    ACCESS_TTL_MS,
    Date.now(),
  );
  jar.cookies.set(COOKIE_NAME.access, access);
}

function upload(body: BodyInit | null, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request(`${AUTH_URL}/api/fanart`, {
      method: "POST",
      headers: { origin: AUTH_URL, ...headers },
      body,
    }),
  );
}

describe("POST /api/fanart — 진입 가드", () => {
  it("크로스사이트는 인가를 보기도 전에 막는다", async () => {
    await signInAs("chan-admin", true);
    const res = await upload(PNG, { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
  });

  it("Origin 이 우리 것이 아니면 403 — tRPC 쓰기와 같은 가드를 쓴다", async () => {
    await signInAs("chan-admin", true);
    const res = await POST(
      new Request(`${AUTH_URL}/api/fanart`, {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: PNG,
      }),
    );
    expect(res.status).toBe(403);
  });

  it("비로그인은 401", async () => {
    expect((await upload(PNG)).status).toBe(401);
  });

  /* 로그인만으로는 못 올린다 — 역할 행이 없으면 빈 권한이다(ADR-0012). UI 가 버튼을 감추는
     것과 무관하게 여기서 막혀야 불변식 3 이 성립한다. */
  it("로그인했어도 schedule:write 가 없으면 403", async () => {
    await signInAs("chan-fan");
    expect((await upload(PNG)).status).toBe(403);
  });
});

describe("POST /api/fanart — 본문 판정", () => {
  beforeEach(async () => {
    await signInAs("chan-admin", true);
  });

  it("Content-Length 가 상한을 넘으면 바이트를 읽기 전에 413", async () => {
    const res = await upload(PNG, { "content-length": String(FANART_MAX_BYTES + 1) });
    expect(res.status).toBe(413);
  });

  /* 헤더는 클라이언트의 주장이다. Content-Length 없이(청크) 보내면 위 검사를 그냥 지나치므로,
     읽으면서 끊지 않으면 상한이 메모리 보호로는 무의미해진다. */
  it("헤더를 속여도 실제 길이로 다시 잰다 — 읽는 중에 끊는다", async () => {
    const oversize = new Uint8Array(FANART_MAX_BYTES + 1);
    oversize.set(PNG.subarray(0, 8));
    // ReadableStream 으로 보내면 Content-Length 가 안 실린다(청크 전송).
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(oversize);
        controller.close();
      },
    });
    const res = await POST(
      new Request(`${AUTH_URL}/api/fanart`, {
        method: "POST",
        headers: { origin: AUTH_URL },
        body: stream,
        // @ts-expect-error — 스트림 본문엔 duplex 가 필요하다(표준, 타입엔 아직 없다).
        duplex: "half",
      }),
    );
    expect(res.status).toBe(413);
  });

  it("빈 본문은 400", async () => {
    expect((await upload(new Uint8Array(0))).status).toBe(400);
  });

  /* 확장자도 Content-Type 도 안 믿는다 — 실제 바이트 앞머리로 판정한다. svg 처럼 마크업인
     형식은 애초에 통과하지 않는다(우리 origin 에서 서빙되므로 XSS 경로가 된다). */
  it("매직 바이트가 이미지가 아니면 415 — Content-Type 을 속여도 통과 못 한다", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const res = await upload(svg, { "content-type": "image/png" });
    expect(res.status).toBe(415);
  });

  it("PNG 는 201 + 키를 돌려주고 R2 에 실제로 앉는다", async () => {
    const res = await upload(PNG);

    expect(res.status).toBe(201);
    const { key } = (await res.json()) as { key: string };
    expect(isFanartKey(key)).toBe(true);
    // DB 엔 URL 이 아니라 키만 담긴다(ADR-0028) — 키가 호스트를 표현할 문법이 없어야 한다.
    expect(key).not.toContain("/");

    const stored = await env.FANART.get(fanartObjectKey(key));
    expect(stored).not.toBeNull();
    // 서빙되는 Content-Type 은 클라이언트 주장이 아니라 매직 바이트 판정의 결과다.
    expect(stored!.httpMetadata?.contentType).toBe("image/png");
    await env.FANART.delete(fanartObjectKey(key));
  });
});
