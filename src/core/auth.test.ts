import { describe, expect, it } from "vitest";
import { shouldBootstrapSuperadmin } from "./auth";

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
