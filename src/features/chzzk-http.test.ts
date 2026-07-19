import { describe, expect, it } from "vitest";
import { asRecord, callChzzkApi, chzzkUrl, credsFromEnv, str } from "./chzzk-http";

/* auth/chzzk-api.test.ts·chzzk/chzzk.test.ts 는 도메인 매핑(토큰·사용자·category)을 각자
   못박고, 여기는 그 밑에 깔린 공통부(envelope 언랩·오류 문구·URL 조립·creds 조립)만 겨눈다 —
   두 도메인이 병렬로 이 계약을 다시 시험할 필요가 없게. */

function fakeFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): typeof fetch {
  return (async () =>
    ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    }) as Response) as typeof fetch;
}

describe("callChzzkApi", () => {
  it("code===200 이면 content 를 그대로 돌려준다", async () => {
    const f = fakeFetch({ code: 200, content: { a: 1 } });
    await expect(callChzzkApi(chzzkUrl("/x"), {}, "테스트", f)).resolves.toEqual({ a: 1 });
  });

  it("HTTP 오류면 label 을 물고 던진다", async () => {
    const f = fakeFetch({}, { ok: false, status: 500 });
    await expect(callChzzkApi(chzzkUrl("/x"), {}, "테스트", f)).rejects.toThrow(
      /치지직 테스트 실패: HTTP 500/,
    );
  });

  it("code !== 200 이면 message 를 물고 던진다", async () => {
    const f = fakeFetch({ code: 401, message: "invalid_grant" });
    await expect(callChzzkApi(chzzkUrl("/x"), {}, "테스트", f)).rejects.toThrow(
      /치지직 테스트 오류 401: invalid_grant/,
    );
  });
});

describe("chzzkUrl", () => {
  it("BASE_URL 기준으로 조립하고 query 를 붙인다", () => {
    const url = chzzkUrl("/open/v1/categories/search", { query: "엘든", size: "5" });
    expect(url.origin).toBe("https://openapi.chzzk.naver.com");
    expect(url.pathname).toBe("/open/v1/categories/search");
    expect(url.searchParams.get("query")).toBe("엘든");
    expect(url.searchParams.get("size")).toBe("5");
  });
});

describe("credsFromEnv", () => {
  it("둘 다 있어야 creds, 하나라도 없으면 null", () => {
    expect(credsFromEnv("id", "sec")).toEqual({ clientId: "id", clientSecret: "sec" });
    expect(credsFromEnv(undefined, "sec")).toBeNull();
    expect(credsFromEnv("id", undefined)).toBeNull();
    expect(credsFromEnv(undefined, undefined)).toBeNull();
  });
});

describe("asRecord·str", () => {
  it("객체 아니면 빈 레코드, 문자열 아니면 빈 문자열", () => {
    expect(asRecord(null)).toEqual({});
    expect(asRecord("x")).toEqual({});
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(str(1)).toBe("");
    expect(str("x")).toBe("x");
  });
});
