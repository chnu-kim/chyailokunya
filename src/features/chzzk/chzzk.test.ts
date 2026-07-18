import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { authoritiesFor } from "@/core/authorities";
import { makeDb } from "@/db";
import { createCallerFactory } from "@/features/trpc/init";
import { appRouter } from "@/features/router";
import type { Context } from "@/features/trpc/init";
import { searchCategories } from "./client";

/* 네트워크 없이 매핑·GAME 필터·에러 경로를 못박는다(Q2: 코드는 실제, 검증은 목). fetch 를
   주입해 응답을 흉내낸다 — searchCategories 는 fetchImpl 을 받는다. */

const creds = { clientId: "id", clientSecret: "sec" };
const envelope = (data: unknown[]) => ({ code: 200, message: null, content: { data } });

function fakeFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): typeof fetch {
  return (async () =>
    ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    }) as Response) as typeof fetch;
}

describe("searchCategories (클라이언트)", () => {
  it("GAME 만 남기고 4필드를 정규화한다", async () => {
    const f = fakeFetch(
      envelope([
        { categoryType: "GAME", categoryId: "g1", categoryValue: "엘든링", posterImageUrl: "u" },
        { categoryType: "SPORTS", categoryId: "s1", categoryValue: "축구", posterImageUrl: "u2" },
        { categoryType: "ETC", categoryId: "e1", categoryValue: "저챗", posterImageUrl: null },
      ]),
    );
    expect(await searchCategories(creds, "엘든", 5, f)).toEqual([
      { categoryType: "GAME", categoryId: "g1", categoryValue: "엘든링", posterImageUrl: "u" },
    ]);
  });

  it("poster 빈 문자열은 null 로 정규화", async () => {
    const f = fakeFetch(
      envelope([{ categoryType: "GAME", categoryId: "g", categoryValue: "A", posterImageUrl: "" }]),
    );
    const out = await searchCategories(creds, "a", 5, f);
    expect(out[0]!.posterImageUrl).toBeNull();
  });

  it("code !== 200 이면 던진다", async () => {
    const f = fakeFetch({ code: 401, message: "unauthorized" });
    await expect(searchCategories(creds, "a", 5, f)).rejects.toThrow(/401/);
  });

  it("HTTP 오류면 던진다", async () => {
    const f = fakeFetch({}, { ok: false, status: 500 });
    await expect(searchCategories(creds, "a", 5, f)).rejects.toThrow(/HTTP 500/);
  });
});

const createCaller = createCallerFactory(appRouter);
const write = authoritiesFor(["admin"]); // game:write

function makeCtx(over: Partial<Context> = {}): Context {
  return { db: makeDb(env.DB), authorities: new Set(), chzzk: null, actor: null, ...over };
}

describe("chzzk.categorySearch (라우터)", () => {
  it("game:write 없으면 FORBIDDEN — creds 있어도 인가가 먼저", async () => {
    const caller = createCaller(makeCtx({ chzzk: creds }));
    await expect(caller.chzzk.categorySearch({ query: "a" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("인가는 됐지만 creds 없으면 PRECONDITION_FAILED", async () => {
    const caller = createCaller(makeCtx({ authorities: write, chzzk: null }));
    await expect(caller.chzzk.categorySearch({ query: "a" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("인가+creds 면 검색해 GAME 을 돌려준다(전역 fetch 목)", async () => {
    const stub = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () =>
            envelope([
              {
                categoryType: "GAME",
                categoryId: "g1",
                categoryValue: "엘든링",
                posterImageUrl: "u",
              },
            ]),
        }) as Response,
    );
    vi.stubGlobal("fetch", stub);
    try {
      const caller = createCaller(makeCtx({ authorities: write, chzzk: creds }));
      const out = await caller.chzzk.categorySearch({ query: "엘든", size: 5 });
      expect(out).toHaveLength(1);
      expect(out[0]!.categoryId).toBe("g1");
      expect(stub).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
