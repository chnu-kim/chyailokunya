import { describe, expect, it } from "vitest";
import {
  clearLoggedOutMarker,
  clearOauthStateCookie,
  clearReturnToCookie,
  clearSessionCookies,
  dropSessionFromRequest,
  expireLegacyCookies,
  forwardRotatedAccess,
  hasLegacyCookies,
  hasLoggedOutMarker,
  plantLoggedOutMarker,
  plantOauthStateCookie,
  plantReturnToCookie,
  plantSessionCookies,
  readOauthStateCookie,
  readReturnToCookie,
  readSessionCookies,
  type CookieOptions,
} from "./session-cookies";

/* 이 스위트는 회귀 핀이다 — 쿠키 이름·속성·만료가 **바이트 수준으로** ADR-0017 배선과 같아야
   한다(__Host- 요건: Secure·Path=/·Domain 미지정). 값이 바뀌면 의도된 프로토콜 변경인지부터
   의심하라. */

type SetCall = { name: string; value: string; options: CookieOptions };

function fakeSink() {
  const calls: SetCall[] = [];
  return {
    calls,
    cookies: {
      set(name: string, value: string, options: CookieOptions) {
        calls.push({ name, value, options });
      },
    },
  };
}

function fakeJar(entries: Record<string, string>) {
  return {
    get: (name: string) => {
      const value = entries[name];
      return value === undefined ? undefined : { value };
    },
    has: (name: string) => name in entries,
  };
}

const BASE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

describe("세션 쿠키 심기/걷기", () => {
  it("심기는 access→refresh 순서로, TTL(15분/14일)을 초 단위 maxAge 로 싣는다", () => {
    const sink = fakeSink();
    plantSessionCookies(sink, { access: "AT", refresh: "RT" });
    expect(sink.calls).toEqual([
      { name: "__Host-ck_at", value: "AT", options: { ...BASE, maxAge: 15 * 60 } },
      { name: "__Host-ck_rt", value: "RT", options: { ...BASE, maxAge: 14 * 24 * 60 * 60 } },
    ]);
  });

  it("걷기는 같은 짝을 빈 값 + maxAge 0 으로 즉시 만료시킨다", () => {
    const sink = fakeSink();
    clearSessionCookies(sink);
    expect(sink.calls).toEqual([
      { name: "__Host-ck_at", value: "", options: { ...BASE, maxAge: 0 } },
      { name: "__Host-ck_rt", value: "", options: { ...BASE, maxAge: 0 } },
    ]);
  });

  it("읽기는 심은 이름과 같은 이름을 본다(심기/읽기 왕복)", () => {
    const jar = fakeJar({ "__Host-ck_at": "AT", "__Host-ck_rt": "RT" });
    expect(readSessionCookies(jar)).toEqual({ access: "AT", refresh: "RT" });
    expect(readSessionCookies(fakeJar({}))).toEqual({ access: undefined, refresh: undefined });
  });
});

describe("로그아웃 마커 의미론", () => {
  it("마커 수명은 access TTL 과 같다 — 되심길 수 있는 access 의 최대 수명만큼만 막는다", () => {
    const sink = fakeSink();
    plantLoggedOutMarker(sink);
    expect(sink.calls).toEqual([
      { name: "__Host-ck_lo", value: "1", options: { ...BASE, maxAge: 15 * 60 } },
    ]);
  });

  it("지우기는 빈 값 + maxAge 0", () => {
    const sink = fakeSink();
    clearLoggedOutMarker(sink);
    expect(sink.calls).toEqual([
      { name: "__Host-ck_lo", value: "", options: { ...BASE, maxAge: 0 } },
    ]);
  });

  it("판정은 값이 아니라 존재다 — 빈 값 마커도 로그아웃으로 본다", () => {
    expect(hasLoggedOutMarker(fakeJar({ "__Host-ck_lo": "1" }))).toBe(true);
    expect(hasLoggedOutMarker(fakeJar({ "__Host-ck_lo": "" }))).toBe(true);
    expect(hasLoggedOutMarker(fakeJar({}))).toBe(false);
  });

  it("심은 마커를 읽으면 로그아웃, 지운 뒤(브라우저가 삭제)엔 아니다(왕복)", () => {
    const sink = fakeSink();
    plantLoggedOutMarker(sink);
    const planted = sink.calls[0]!;
    expect(hasLoggedOutMarker(fakeJar({ [planted.name]: planted.value }))).toBe(true);
    expect(hasLoggedOutMarker(fakeJar({}))).toBe(false);
  });
});

describe("OAuth state 쿠키", () => {
  it("심기는 10분 TTL, 지우기는 즉시 만료, 읽기는 같은 이름(왕복)", () => {
    const sink = fakeSink();
    plantOauthStateCookie(sink, "nonce-1");
    clearOauthStateCookie(sink);
    expect(sink.calls).toEqual([
      { name: "__Host-ck_oauth_state", value: "nonce-1", options: { ...BASE, maxAge: 10 * 60 } },
      { name: "__Host-ck_oauth_state", value: "", options: { ...BASE, maxAge: 0 } },
    ]);
    expect(readOauthStateCookie(fakeJar({ "__Host-ck_oauth_state": "nonce-1" }))).toBe("nonce-1");
    expect(readOauthStateCookie(fakeJar({}))).toBeUndefined();
  });
});

describe("복귀 경로(return_to) 쿠키", () => {
  it("state 와 같은 10분 TTL·같은 속성으로 왕복한다(이슈 #25)", () => {
    const sink = fakeSink();
    plantReturnToCookie(sink, "/landing");
    clearReturnToCookie(sink);
    expect(sink.calls).toEqual([
      { name: "__Host-ck_return_to", value: "/landing", options: { ...BASE, maxAge: 10 * 60 } },
      { name: "__Host-ck_return_to", value: "", options: { ...BASE, maxAge: 0 } },
    ]);
    expect(readReturnToCookie(fakeJar({ "__Host-ck_return_to": "/games" }))).toBe("/games");
    expect(readReturnToCookie(fakeJar({}))).toBeUndefined();
  });
});

describe("레거시(__Host- 이전) 쿠키 만료", () => {
  it("구 이름 4종을 전부 즉시 만료시킨다", () => {
    const sink = fakeSink();
    expireLegacyCookies(sink);
    expect(sink.calls).toEqual(
      ["ck_at", "ck_rt", "ck_oauth_state", "ck_lo"].map((name) => ({
        name,
        value: "",
        options: { ...BASE, maxAge: 0 },
      })),
    );
  });

  it("존재 판정은 구 이름 중 하나라도 있으면 참(익명 트래픽엔 Set-Cookie 를 안 붙이는 근거)", () => {
    expect(hasLegacyCookies(fakeJar({ ck_rt: "x" }))).toBe(true);
    expect(hasLegacyCookies(fakeJar({ "__Host-ck_at": "x" }))).toBe(false);
    expect(hasLegacyCookies(fakeJar({}))).toBe(false);
  });
});

describe("middleware request-forward", () => {
  it("rotation 성공 시 다운스트림이 볼 access 만 덮는다(refresh 는 안 만짐)", () => {
    const set: Array<[string, string]> = [];
    const deleted: string[] = [];
    forwardRotatedAccess(
      { set: (n, v) => set.push([n, v]), delete: (n) => deleted.push(n) },
      "AT2",
    );
    expect(set).toEqual([["__Host-ck_at", "AT2"]]);
    expect(deleted).toEqual([]);
  });

  it("로그아웃 마커 적중 시 세션 짝을 요청에서 걷는다", () => {
    const deleted: string[] = [];
    dropSessionFromRequest({ set: () => {}, delete: (n) => deleted.push(n) });
    expect(deleted).toEqual(["__Host-ck_at", "__Host-ck_rt"]);
  });
});
