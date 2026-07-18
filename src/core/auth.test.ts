import { describe, expect, it } from "vitest";
import { authoritiesFor } from "./authorities";
import { authoritiesToClaim, parseAuthorities, shouldBootstrapSuperadmin } from "./auth";

describe("shouldBootstrapSuperadmin", () => {
  it("channelId 가 SUPERADMIN_CHANNEL_ID 와 정확히 일치하면 승격", () => {
    expect(shouldBootstrapSuperadmin("chan-abc", "chan-abc")).toBe(true);
  });

  it("불일치면 승격 안 함", () => {
    expect(shouldBootstrapSuperadmin("chan-abc", "chan-xyz")).toBe(false);
  });

  it("env 미설정(undefined·빈 문자열)이면 아무도 승격하지 않는다", () => {
    // 빈 env 를 "모두 일치"로 오해하면 첫 로그인이 전부 superadmin 이 된다 — 절대 금지.
    expect(shouldBootstrapSuperadmin("chan-abc", undefined)).toBe(false);
    expect(shouldBootstrapSuperadmin("chan-abc", "")).toBe(false);
    expect(shouldBootstrapSuperadmin("", "")).toBe(false);
  });

  it("앞뒤 공백은 양쪽 다 조여 비교(설정 실수로 조용히 어긋나지 않게)", () => {
    expect(shouldBootstrapSuperadmin(" chan-abc ", "chan-abc")).toBe(true);
    expect(shouldBootstrapSuperadmin("chan-abc", " chan-abc\n")).toBe(true);
  });
});

describe("authoritiesToClaim / parseAuthorities", () => {
  it("Set → 정렬 배열(결정적 클레임)", () => {
    const claim = authoritiesToClaim(authoritiesFor(["superadmin"]));
    expect(claim).toEqual(["game:delete", "game:write", "role:manage"]);
  });

  it("빈 집합은 빈 배열", () => {
    expect(authoritiesToClaim(authoritiesFor([]))).toEqual([]);
  });

  it("클레임 → 집합 라운드트립(순서 무관 동치)", () => {
    const before = authoritiesFor(["admin"]);
    const round = parseAuthorities(authoritiesToClaim(before));
    expect([...round].sort()).toEqual([...before].sort());
  });

  it("배열이 아니거나 null 이면 빈 집합(방어)", () => {
    expect(parseAuthorities(null).size).toBe(0);
    expect(parseAuthorities(undefined).size).toBe(0);
    expect(parseAuthorities("game:write").size).toBe(0);
    expect(parseAuthorities({ 0: "game:write" }).size).toBe(0);
  });

  it("화이트리스트 밖 문자열·비문자열 원소는 버린다(변조 방어)", () => {
    const a = parseAuthorities(["game:write", "role:manage", "root", "", 7, null]);
    expect([...a].sort()).toEqual(["game:write", "role:manage"]);
  });
});
