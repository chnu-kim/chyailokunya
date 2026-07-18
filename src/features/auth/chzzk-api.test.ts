import { describe, expect, it } from "vitest";
import { exchangeCodeForTokens, fetchChzzkUser } from "./chzzk-api";

/* 네트워크 없이 매핑·에러·비표준 계약(state 재전송·envelope)을 못박는다 — chzzk/client.ts
   테스트와 같은 fetchImpl 주입 방식. 치지직 응답은 {code,message,content} envelope. */

const creds = { clientId: "id", clientSecret: "sec" };

function fakeFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): typeof fetch {
  return (async () =>
    ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    }) as Response) as typeof fetch;
}

describe("exchangeCodeForTokens", () => {
  it("code===200 이면 accessToken 을 매핑한다", async () => {
    const f = fakeFetch({
      code: 200,
      content: { accessToken: "at", refreshToken: "rt", tokenType: "Bearer", expiresIn: 86400 },
    });
    const t = await exchangeCodeForTokens(creds, "code-1", "state-1", f);
    expect(t).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      tokenType: "Bearer",
      expiresIn: 86400,
    });
  });

  it("state 를 body 에 재전송하고 grantType=authorization_code(치지직 비표준)", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      captured = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 200, content: { accessToken: "at" } }),
      } as Response;
    }) as typeof fetch;
    await exchangeCodeForTokens(creds, "code-9", "state-9", fetchImpl);
    const sent = JSON.parse(captured!.body as string);
    expect(sent).toMatchObject({
      grantType: "authorization_code",
      clientId: "id",
      clientSecret: "sec",
      code: "code-9",
      state: "state-9",
    });
  });

  it("expiresIn 이 문자열이어도 숫자로 강제, 없는 필드는 null", async () => {
    const f = fakeFetch({ code: 200, content: { accessToken: "at", expiresIn: "3600" } });
    const t = await exchangeCodeForTokens(creds, "c", "s", f);
    expect(t.expiresIn).toBe(3600);
    expect(t.refreshToken).toBeNull();
    expect(t.tokenType).toBeNull();
  });

  it("code !== 200 이면 던진다", async () => {
    const f = fakeFetch({ code: 401, message: "invalid_grant" });
    await expect(exchangeCodeForTokens(creds, "c", "s", f)).rejects.toThrow(/401/);
  });

  it("accessToken 이 없으면 던진다", async () => {
    const f = fakeFetch({ code: 200, content: { refreshToken: "rt" } });
    await expect(exchangeCodeForTokens(creds, "c", "s", f)).rejects.toThrow(/accessToken/);
  });

  it("HTTP 오류면 던진다", async () => {
    const f = fakeFetch({}, { ok: false, status: 500 });
    await expect(exchangeCodeForTokens(creds, "c", "s", f)).rejects.toThrow(/HTTP 500/);
  });
});

describe("fetchChzzkUser", () => {
  it("channelId·channelName 을 매핑하고 Bearer 헤더로 인증한다", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      captured = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 200, content: { channelId: "chan-1", channelName: "쿠냐" } }),
      } as Response;
    }) as typeof fetch;
    const u = await fetchChzzkUser("access-xyz", fetchImpl);
    expect(u).toEqual({ channelId: "chan-1", channelName: "쿠냐" });
    expect((captured!.headers as Record<string, string>).Authorization).toBe("Bearer access-xyz");
  });

  it("channelId 가 없으면 던진다(빈 신원 방어)", async () => {
    const f = fakeFetch({ code: 200, content: { channelName: "이름만" } });
    await expect(fetchChzzkUser("at", f)).rejects.toThrow(/channelId/);
  });

  it("code !== 200 이면 던진다", async () => {
    const f = fakeFetch({ code: 401, message: "unauthorized" });
    await expect(fetchChzzkUser("at", f)).rejects.toThrow(/401/);
  });
});
