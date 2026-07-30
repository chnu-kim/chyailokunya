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

/* PNG 시그니처 + **IHDR 까지**(8×8). 매직 바이트만으론 부족하다 — 라우트가 IHDR 에서 폭·높이를
   읽어 픽셀 예산을 보고, 못 읽으면 415 로 거절한다(ADR-0030 의 fail-closed 가드). 픽셀 데이터는
   여전히 필요 없다: 어느 경로에서도 디코드하지 않는다. */
const PNG = (() => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(b.buffer).setUint32(16, 8); // width
  new DataView(b.buffer).setUint32(20, 8); // height
  return b;
})();

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

  /* 픽셀 예산(ADR-0030) — **바이트 상한과 다른 축이다.** 여기서 재는 것은 "라우트가 R2 에 넣기
     전에 거절하는가"이고, 경계값·형식별 파싱은 core/fanart 단위 테스트가 본다. */
  it("픽셀 폭탄은 413 이고 R2 에 아무것도 안 남는다", async () => {
    const bomb = new Uint8Array(24);
    bomb.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bomb.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    const view = new DataView(bomb.buffer);
    view.setUint32(16, 20000);
    view.setUint32(20, 20000); // 4억 화소 — 디코드하면 1.6GB
    const before = (await env.FANART.list({ prefix: "fanart/" })).objects.length;

    const res = await upload(bomb);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toContain("화소");
    // **넣기 전에** 거절해야 한다 — 뒤에 두면 고아 객체가 남는다.
    expect((await env.FANART.list({ prefix: "fanart/" })).objects.length).toBe(before);
  });

  it("한 변 상한을 넘으면 413 — 픽셀 예산은 통과하는 조합이다", async () => {
    /* 20001×1 은 2만 화소라 예산 안이지만 저장 Zod 가 거절한다. 업로드에서 같이 안 보면 "업로드는
       성공하고 그림은 어디에도 못 걸리는" 상태가 되어 화면이 그 이유를 설명할 수 없다. */
    const wide = new Uint8Array(24);
    wide.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    wide.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    const v = new DataView(wide.buffer);
    v.setUint32(16, 20001);
    v.setUint32(20, 1);
    expect((await upload(wide)).status).toBe(413);
  });

  it("APNG 는 415 — gif 를 뺀 이유를 애니메이션 PNG 가 우회한다", async () => {
    /* `<img>` 로 재생되는 애니메이션은 CSS 의 prefers-reduced-motion 가드가 못 막는다(접근성
       기준). 판정은 acTL 청크 하나이고 경계는 core/fanart 단위 테스트가 본다. */
    const apng = new Uint8Array(45);
    apng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    apng.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    new DataView(apng.buffer).setUint32(16, 100);
    new DataView(apng.buffer).setUint32(20, 100);
    apng.set([0, 0, 0, 8], 33);
    apng.set([0x61, 0x63, 0x54, 0x4c], 37); // "acTL"
    expect((await upload(apng)).status).toBe(415);
  });

  it("헤더를 못 읽으면 415 — 치수 힌트와 반대로 fail-closed 다", async () => {
    /* 통과시키면 위 폭탄 방어에 우회로가 생긴다. 매직 바이트를 이미 지난 파일이므로 "그 형식이라고
       주장하는데 헤더가 규격과 다르다"는 뜻이고, 그런 파일은 브라우저도 못 그린다. */
    const truncated = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect((await upload(truncated)).status).toBe(415);
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
    /* **치수가 객체 메타에 묶인다**(ADR-0030) — 응답이 아니라 여기가 정본이다. 저장 경로가 이
       값을 읽으므로 클라이언트가 치수를 에코할 필요가 없고, 위조가 DB 에 닿을 자리도 없다
       (적대적 리뷰 9라운드). 픽스처는 8×8 이다. */
    expect(stored!.customMetadata).toEqual({ w: "8", h: "8" });
    // 서빙되는 Content-Type 은 클라이언트 주장이 아니라 매직 바이트 판정의 결과다.
    expect(stored!.httpMetadata?.contentType).toBe("image/png");
    await env.FANART.delete(fanartObjectKey(key));
  });
});
