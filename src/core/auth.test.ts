import { describe, expect, it } from "vitest";
import { safeReturnTo, shouldBootstrapSuperadmin } from "./auth";

/* 실제 사이트 목록(features/routes.KNOWN_PAGE_PATHS)과 같은 값을 손으로 베낀 것. core 는
   목록을 소유하지 않으므로 인자로 넘긴다 — `src/core` 에서 `src/features` 를 import 하면
   `core-is-pure` 가 error 로 죽고, 순수 함수는 애초에 임의 목록으로 검증하는 게 옳다.
   이 사본이 진짜 목록·실제 라우트와 어긋나는지는 여기가 아니라 `e2e/routes.spec.ts` 가 본다
   (파일시스템을 읽어야 해서 workerd 안인 이 풀에선 못 한다). */
const ALLOWED = ["/", "/landing", "/games"];

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
    expect(safeReturnTo("/landing", ALLOWED)).toBe("/landing");
    expect(safeReturnTo("/games", ALLOWED)).toBe("/games");
    expect(safeReturnTo("/", ALLOWED)).toBe("/");
  });

  it("외부 URL 은 밖으로 내보내지 않는다(오픈 리다이렉트)", () => {
    // 이 목록이 통과하면 우리 도메인을 거쳐 피싱 사이트로 보내는 링크를 뿌릴 수 있다.
    expect(safeReturnTo("https://evil.example", ALLOWED)).toBe("/");
    expect(safeReturnTo("//evil.example", ALLOWED)).toBe("/"); // 프로토콜 상대 URL — 슬래시로 시작한다고 내부가 아니다
    expect(safeReturnTo("/\\evil.example", ALLOWED)).toBe("/"); // 브라우저가 // 로 정규화하는 형태
    expect(safeReturnTo("http://evil.example/games", ALLOWED)).toBe("/");
    expect(safeReturnTo("javascript:alert(1)", ALLOWED)).toBe("/");
  });

  it("목록에 없는 내부 경로도 기본값으로 떨어진다", () => {
    /* 허용목록이 파서 기반 "외부 URL 인가" 검사보다 나은 지점이 여기다 — 이것들은 전부
       진짜 내부 경로라 어떤 origin 검사도 통과시킨다. 로그인하자마자 로그아웃(logout)·
       리다이렉트 루프(login)·로그인 성공 직후 404(없는 경로)를 목록 대조만이 막는다. */
    expect(safeReturnTo("/api/auth/logout", ALLOWED)).toBe("/");
    expect(safeReturnTo("/api/auth/login", ALLOWED)).toBe("/");
    expect(safeReturnTo("/nope", ALLOWED)).toBe("/");
    expect(safeReturnTo("/games?q=1", ALLOWED)).toBe("/");
    expect(safeReturnTo("/landing/", ALLOWED)).toBe("/");
  });

  it("값이 없으면(쿠키 부재·빈 쿼리) 기본값 /", () => {
    expect(safeReturnTo(undefined, ALLOWED)).toBe("/");
    expect(safeReturnTo(null, ALLOWED)).toBe("/");
    expect(safeReturnTo("", ALLOWED)).toBe("/");
    expect(safeReturnTo("   ", ALLOWED)).toBe("/");
  });
});
