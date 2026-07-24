import { describe, expect, it } from "vitest";
import {
  ANGLE,
  axis,
  formatDate,
  hash,
  isClearedStateValid,
  isGameCategory,
  PATTERNS,
  ROT,
  type ChzzkCategory,
} from "./games";

/* 날짜 형식 검증(isDateString) 테스트는 calendar.test.ts 로 옮겼다 — 함수가 isIsoDate 로
   그리 이사했다. 미래 날짜 허용까지 그쪽이 이어 검증한다. */

describe("formatDate", () => {
  it("점 구분 표기로 바꾼다", () => {
    expect(formatDate("2026-07-20")).toBe("2026.07.20");
    expect(formatDate("1999-12-31")).toBe("1999.12.31");
  });
});

describe("isClearedStateValid", () => {
  it("깬 게임엔 날짜가 있든 없든 참 — 없으면 '깼는데 날짜 모름'(할로우 나이트)", () => {
    expect(isClearedStateValid(true, "2026-05-02")).toBe(true);
    expect(isClearedStateValid(true, null)).toBe(true);
  });

  it("안 깬 게임에 클리어 날짜가 붙으면 거짓(DB CHECK 의 도메인 짝)", () => {
    expect(isClearedStateValid(false, "2026-05-02")).toBe(false);
  });

  it("안 깼고 날짜도 없으면 참 — 기본 상태", () => {
    expect(isClearedStateValid(false, null)).toBe(true);
  });
});

describe("hash / axis", () => {
  // D1 의 surrogate 정수 PK 를 문자열로 쓴다(카드 id). '1'..'8' 은 끝 글자만 다르다.
  const ids = Array.from({ length: 8 }, (_, i) => String(i + 1));

  it("hash 는 결정적이고 음이 아니다", () => {
    expect(hash("1")).toBe(hash("1"));
    expect(hash("1")).toBeGreaterThanOrEqual(0);
  });

  it("axis 는 0..n-1 범위 안", () => {
    for (const id of ids) {
      const p = axis(id, "pat", PATTERNS);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(PATTERNS);
      expect(axis(id, "rot", ROT.length)).toBeLessThan(ROT.length);
      expect(axis(id, "ang", ANGLE.length)).toBeLessThan(ANGLE.length);
    }
  });

  it("소금이 축을 퍼뜨린다 — 끝자리만 다른 id 가 한 종으로 붕괴하지 않는다", () => {
    // 소금 없이 한 해시를 >>3·>>6 으로 나눠 쓰면 상위 비트가 같아 축이 붕괴했다(실측:
    // 끝자리만 다른 8개가 패턴 1종·각도 2종). 축마다 소금을 달리 주면 고르게 퍼진다.
    const pats = new Set(ids.map((id) => axis(id, "pat", PATTERNS)));
    const angs = new Set(ids.map((id) => axis(id, "ang", ANGLE.length)));
    expect(pats.size).toBeGreaterThanOrEqual(2);
    expect(angs.size).toBeGreaterThanOrEqual(3);
  });
});

describe("치지직 category 매핑", () => {
  const game: ChzzkCategory = {
    categoryType: "GAME",
    categoryId: "abc123",
    categoryValue: "엘든링",
    posterImageUrl: "https://img/eldenring.jpg",
  };

  it("isGameCategory 는 GAME 만 참", () => {
    expect(isGameCategory(game)).toBe(true);
    expect(isGameCategory({ ...game, categoryType: "SPORTS" })).toBe(false);
    expect(isGameCategory({ ...game, categoryType: "ETC" })).toBe(false);
  });
});
