/* 팬아트 서빙의 계약(ADR-0028). 커버리지 0 이었고, 그중 **캐시 분기는 어느 층도 볼 수 없었다** —
   `caches` 는 workerd 전역이라 `next dev` 에 없어서 e2e 가 그 코드를 아예 안 지나간다(AGENTS
   지뢰). 워커 풀 테스트는 진짜 workerd 라 여기서는 보인다. 실제로 그 사각지대에서 캐시 키
   정규화와 캐시 히트 시 조건부 요청이 각각 한 번씩 새어 나갔었다.

   `ctx.waitUntil` 은 목이 제공한다 — OpenNext 의 waitUntil 래핑은 ISR 전용이라 이 라우트는
   Cloudflare ctx 를 직접 부른다(AGENTS). 테스트에선 그 프라미스를 모아 뒀다가 await 해서,
   "응답 뒤에 캐시가 실제로 앉는지"까지 본다. */

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fanartCacheKey, fanartObjectKey } from "@/core/fanart";

const { ctx } = vi.hoisted(() => ({
  ctx: { env: {} as Record<string, unknown>, pending: [] as Promise<unknown>[] },
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: ctx.env,
    ctx: { waitUntil: (p: Promise<unknown>) => ctx.pending.push(p) },
  }),
}));

const { GET } = await import("./route");

const BASE = "https://chyailokunya.com/api/fanart";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
// 형식이 곧 방어선이다 — `<uuid>.<ext>` 만 통과한다(core/fanart.isFanartKey).
const KEY = "11111111-2222-4333-8444-555555555555.png";

beforeEach(async () => {
  ctx.env = { ...env };
  ctx.pending = [];
  // 이 스펙이 쓰는 키만 정리한다 — 버킷을 통째로 비우면 병렬 스펙끼리 서로의 객체를 지운다.
  await env.FANART.delete(fanartObjectKey(KEY));
  await caches.default.delete(fanartCacheKey(`${BASE}/${KEY}`));
});

function get(key: string, headers: Record<string, string> = {}): Promise<Response> {
  return GET(new Request(`${BASE}/${key}`, { headers }), { params: Promise.resolve({ key }) });
}

// waitUntil 로 흘린 캐시 쓰기가 끝나기를 기다린다(안 기다리면 다음 단언이 경합한다).
async function settle(): Promise<void> {
  await Promise.all(ctx.pending);
  ctx.pending = [];
}

async function putPng(): Promise<void> {
  await env.FANART.put(fanartObjectKey(KEY), PNG, {
    httpMetadata: { contentType: "image/png" },
  });
}

describe("GET /api/fanart/[key]", () => {
  /* 키 형식이 경로 순회를 구조적으로 막는다 — `..`·`/` 가 애초에 못 들어온다. 형식이 아니면
     R2 를 두드리지도 않는다(인증 없는 공개 경로라 그 왕복 자체가 증폭 통로다). */
  it("키 형식이 아니면 404 — R2 를 두드리지 않는다", async () => {
    for (const bad of ["../secret", "not-a-uuid.png", `${KEY}.exe`, ""]) {
      expect((await get(bad)).status).toBe(404);
    }
  });

  it("객체가 없으면 404 — 그 404 는 캐시하지 않는다", async () => {
    const res = await get(KEY);
    expect(res.status).toBe(404);
    await settle();
    // 고아 정리·재업로드가 지나간 뒤에도 "없음"이 굳으면 안 된다.
    expect(await caches.default.match(fanartCacheKey(`${BASE}/${KEY}`))).toBeUndefined();
  });

  it("객체가 있으면 바이트를 그대로 흘리고 etag·cache-control 을 싣는다", async () => {
    await putPng();

    const res = await get(KEY);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  /* `immutable` 도 1년도 아니다 — 이 자원은 **삭제될 수 있다**. 내렸는데 1년간 안 내려가는
     상태를 만들지 않으려고 수명을 짧게 두고 재검증에 맡긴다. */
  it("cache-control 에 immutable 을 걸지 않는다 — 지운 그림이 안 내려가면 안 된다", async () => {
    await putPng();
    const cc = (await get(KEY)).headers.get("cache-control")!;
    expect(cc).not.toContain("immutable");
    expect(cc).toContain("max-age=3600");
  });

  it("etag 가 같으면 304 로 본문을 안 보낸다", async () => {
    await putPng();
    const etag = (await get(KEY)).headers.get("etag")!;
    await settle();

    const res = await get(KEY, { "if-none-match": etag });

    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  /* **엣지 캐시가 선 뒤에도 재검증이 성립해야 한다.** 캐시 히트를 그냥 돌려주면 만료돼 되묻는
     클라이언트가 304 대신 전체 바이트를 받는다 — R2 경로에만 재검증을 두면 그 계약이 캐시가
     서는 순간 조용히 깨진다. 이 분기는 `next dev` 에 caches 가 없어 e2e 가 구조적으로 못 본다. */
  it("캐시 히트여도 조건부 요청을 먼저 본다 — 304 가 캐시 유무에 안 흔들린다", async () => {
    await putPng();
    const etag = (await get(KEY)).headers.get("etag")!;
    await settle();
    // 이제 캐시에 앉아 있다. R2 를 지워 "캐시에서만 나온다"를 확실히 한다.
    await env.FANART.delete(fanartObjectKey(KEY));
    expect(await caches.default.match(fanartCacheKey(`${BASE}/${KEY}`))).toBeDefined();

    const res = await get(KEY, { "if-none-match": etag });

    expect(res.status).toBe(304);
  });

  /* Cache API 는 요청 URL 전체를 키로 쓴다 — `?n=1`, `?n=2` … 를 붙이면 매번 미스인데 R2 조회는
     같은 객체라, 인증 없는 이미지 URL 하나가 무한한 R2 재읽기가 된다. */
  it("캐시 키를 origin+pathname 으로 정규화한다 — 쿼리로 캐시를 우회할 수 없다", async () => {
    await putPng();
    await get(KEY);
    await settle();

    // 쿼리를 붙여도 같은 엔트리를 맞혀야 한다. R2 를 지워 캐시에서만 나오게 만든다.
    await env.FANART.delete(fanartObjectKey(KEY));
    const res = await GET(new Request(`${BASE}/${KEY}?n=1`), {
      params: Promise.resolve({ key: KEY }),
    });

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });
});
