import { describe, expect, it } from "vitest";
import {
  ANGLE,
  axis,
  hash,
  isGameCategory,
  isStatus,
  PATTERNS,
  ROT,
  STATUS,
  statusOf,
  toGameSnapshot,
  type ChzzkCategory,
} from "./games";

describe("statusOf", () => {
  it("알려진 상태를 그대로 돌려준다", () => {
    expect(statusOf("playing")).toBe(STATUS.playing);
    expect(statusOf("cleared").label).toBe("클리어");
  });

  it("프로토타입 체인 키는 played 로 떨어진다(대괄호 조회 함정)", () => {
    // 'constructor'·'toString' 은 STATUS 자기 속성이 아니라 Object 프로토타입에 있다.
    expect(statusOf("constructor")).toBe(STATUS.played);
    expect(statusOf("toString")).toBe(STATUS.played);
    expect(statusOf("__proto__")).toBe(STATUS.played);
  });

  it("모르는 상태도 played", () => {
    expect(statusOf("nope")).toBe(STATUS.played);
  });
});

describe("isStatus", () => {
  it("알려진 상태만 인정, 프로토타입 키·비문자열은 거절", () => {
    expect(isStatus("playing")).toBe(true);
    expect(isStatus("played")).toBe(true);
    expect(isStatus("constructor")).toBe(false);
    expect(isStatus("nope")).toBe(false);
    expect(isStatus(7)).toBe(false);
    expect(isStatus(null)).toBe(false);
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

  it("GAME 이 아니면 스냅샷은 null", () => {
    expect(toGameSnapshot({ ...game, categoryType: "SPORTS" })).toBeNull();
    expect(toGameSnapshot({ ...game, categoryType: "ETC" })).toBeNull();
  });

  it("4필드를 스냅샷으로 옮기고 값을 트림한다", () => {
    const snap = toGameSnapshot({ ...game, categoryValue: "  엘든링  ", categoryId: " abc123 " });
    expect(snap).toEqual({
      categoryId: "abc123",
      categoryType: "GAME",
      categoryValue: "엘든링",
      posterImageUrl: "https://img/eldenring.jpg",
    });
  });

  it("poster 의 null·빈 문자열은 null 로 정규화(카드가 이니셜 폴백을 가름)", () => {
    expect(toGameSnapshot({ ...game, posterImageUrl: null })!.posterImageUrl).toBeNull();
    expect(toGameSnapshot({ ...game, posterImageUrl: "   " })!.posterImageUrl).toBeNull();
  });

  it("식별자·이름이 비면 null(호출측이 거른다)", () => {
    expect(toGameSnapshot({ ...game, categoryId: "  " })).toBeNull();
    expect(toGameSnapshot({ ...game, categoryValue: "" })).toBeNull();
  });
});
