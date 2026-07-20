import { describe, expect, it } from "vitest";
import { safeReturnTo, shouldBootstrapSuperadmin } from "./auth";

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

describe("safeReturnTo", () => {
  it("알려진 내부 경로는 그대로 돌려준다", () => {
    expect(safeReturnTo("/landing")).toBe("/landing");
    expect(safeReturnTo("/games")).toBe("/games");
    expect(safeReturnTo("/")).toBe("/");
  });

  it("외부 URL 은 밖으로 내보내지 않는다(오픈 리다이렉트)", () => {
    // 이 목록이 통과하면 우리 도메인을 거쳐 피싱 사이트로 보내는 링크를 뿌릴 수 있다.
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("//evil.example")).toBe("/"); // 프로토콜 상대 URL — 슬래시로 시작한다고 내부가 아니다
    expect(safeReturnTo("/\\evil.example")).toBe("/"); // 브라우저가 // 로 정규화하는 형태
    expect(safeReturnTo("http://evil.example/games")).toBe("/");
    expect(safeReturnTo("javascript:alert(1)")).toBe("/");
  });

  it("목록에 없는 내부 경로도 기본값으로 떨어진다", () => {
    // 화이트리스트라 "우리 사이트처럼 생겼다"로는 부족하다 — 없는 경로로 보내면 404 만 남는다.
    expect(safeReturnTo("/games?q=1")).toBe("/");
    expect(safeReturnTo("/api/auth/logout")).toBe("/");
    expect(safeReturnTo("/landing/")).toBe("/");
  });

  it("값이 없으면(쿠키 부재·빈 쿼리) 기본값 /", () => {
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
    expect(safeReturnTo("   ")).toBe("/");
  });
});
