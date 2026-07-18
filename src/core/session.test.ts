import { describe, expect, it } from "vitest";
import { classifyReusedToken, computeFamilyExpiry, computeRefreshExpiry } from "./session";

/* refresh 회전에서 조건부 UPDATE claim 이 0행(=이미 회전됨)일 때, 다시 조회한 refresh 행을
   순수하게 판정한다. 이 판정이 rotation 보안의 핵심이라 각 분기를 개별로 못박는다. */

const GRACE = 30_000;
const now = 1_000_000;
// 유효 기간·cap 이 넉넉한 기본 행. superseded_at(회전) / revoked_at(폐기)만 케이스별로 바꾼다.
const base = {
  expiresAt: now + 1_000_000,
  familyExpiresAt: now + 10_000_000,
  supersededAt: null as number | null,
  revokedAt: null as number | null,
};

describe("classifyReusedToken", () => {
  it("존재하지 않는 토큰(null)은 invalid", () => {
    expect(classifyReusedToken(null, now, GRACE)).toBe("invalid");
  });

  it("회전(superseded) 직후 grace 이내 재등장은 reuse-grace(정상 동시 탭)", () => {
    expect(classifyReusedToken({ ...base, supersededAt: now - 5_000 }, now, GRACE)).toBe(
      "reuse-grace",
    );
  });

  it("grace 경계(정확히 graceMs)는 아직 grace 로 본다", () => {
    expect(classifyReusedToken({ ...base, supersededAt: now - GRACE }, now, GRACE)).toBe(
      "reuse-grace",
    );
  });

  it("회전 후 grace 를 넘긴 재등장은 reuse-theft(도난)", () => {
    expect(classifyReusedToken({ ...base, supersededAt: now - GRACE - 1 }, now, GRACE)).toBe(
      "reuse-theft",
    );
  });

  it("폐기(revoked: 로그아웃·도난)된 토큰은 항상 invalid — grace 재발급 금지", () => {
    // 로그아웃/도난으로 폐기된 토큰은 회전과 달리 재사용이 절대 불가하다(핵심 구분).
    expect(classifyReusedToken({ ...base, revokedAt: now - 5_000 }, now, GRACE)).toBe("invalid");
    // superseded 이면서 이후 폐기된 경우도 폐기가 우선.
    expect(
      classifyReusedToken(
        { ...base, supersededAt: now - 5_000, revokedAt: now - 1_000 },
        now,
        GRACE,
      ),
    ).toBe("invalid");
  });

  it("만료된 토큰은 invalid — 만료가 회전 판정보다 우선(만료 토큰은 무해)", () => {
    expect(
      classifyReusedToken(
        { ...base, expiresAt: now - 1, supersededAt: now - GRACE - 1 },
        now,
        GRACE,
      ),
    ).toBe("invalid");
  });

  it("absolute cap 을 넘긴 토큰은 invalid", () => {
    expect(
      classifyReusedToken(
        { ...base, familyExpiresAt: now - 1, supersededAt: now - 5_000 },
        now,
        GRACE,
      ),
    ).toBe("invalid");
  });

  it("회전도 폐기도 아닌데 claim 실패면 레이스 — 방어적으로 invalid", () => {
    expect(classifyReusedToken({ ...base }, now, GRACE)).toBe("invalid");
  });
});

describe("computeFamilyExpiry", () => {
  it("family 첫 로그인 시각 + capMs (절대 상한)", () => {
    expect(computeFamilyExpiry(1_000, 90_000)).toBe(91_000);
  });
});

describe("computeRefreshExpiry", () => {
  it("일반적으론 now + slidingMs (sliding 갱신)", () => {
    expect(computeRefreshExpiry(1_000, 14_000, 999_999)).toBe(15_000);
  });

  it("sliding 이 absolute cap 을 넘으면 cap 으로 조인다(무한 연장 차단)", () => {
    expect(computeRefreshExpiry(1_000, 14_000, 5_000)).toBe(5_000);
  });
});
