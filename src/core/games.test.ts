import { describe, expect, it } from "vitest";
import {
  ANGLE,
  axis,
  formatDate,
  hash,
  isDateOrderValid,
  isDateString,
  isGameCategory,
  PATTERNS,
  ROT,
  type ChzzkCategory,
} from "./games";

describe("isDateString", () => {
  it("정상 YYYY-MM-DD 는 통과", () => {
    expect(isDateString("2026-07-20")).toBe(true);
    expect(isDateString("2024-02-29")).toBe(true); // 윤년
    expect(isDateString("1999-12-31")).toBe(true);
  });

  it("실재하지 않는 날짜는 거절 — Date 파싱이 조용히 굴리는 값들", () => {
    // 형식만 보면 전부 통과한다. new Date('2026-02-31') 은 3/3 으로 굴러가므로
    // 되돌려 찍은 문자열 비교가 없으면 이 값들이 DB 에 들어간다.
    expect(isDateString("2026-02-31")).toBe(false);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2025-02-29")).toBe(false); // 평년
    expect(isDateString("2026-04-31")).toBe(false);
    expect(isDateString("2026-13-01")).toBe(false);
    expect(isDateString("2026-00-10")).toBe(false);
    expect(isDateString("2026-07-00")).toBe(false);
    expect(isDateString("2026-07-32")).toBe(false);
  });

  it("형식이 어긋나면 거절", () => {
    for (const bad of ["2026-7-20", "26-07-20", "2026/07/20", "2026-07-20T00:00:00Z", "", "  "]) {
      expect(isDateString(bad)).toBe(false);
    }
  });

  it("문자열이 아니면 거절", () => {
    expect(isDateString(null)).toBe(false);
    expect(isDateString(undefined)).toBe(false);
    expect(isDateString(20260720)).toBe(false);
    expect(isDateString(new Date())).toBe(false);
  });

  it("미래 날짜도 통과한다(발매 예정작을 미리 올릴 수 있다)", () => {
    expect(isDateString("2099-01-01")).toBe(true);
  });
});

describe("formatDate", () => {
  it("점 구분 표기로 바꾼다", () => {
    expect(formatDate("2026-07-20")).toBe("2026.07.20");
    expect(formatDate("1999-12-31")).toBe("1999.12.31");
  });
});

describe("isDateOrderValid", () => {
  it("클리어가 플레이보다 뒤면(또는 같으면) 참", () => {
    expect(isDateOrderValid("2026-07-01", "2026-07-20")).toBe(true);
    expect(isDateOrderValid("2026-07-20", "2026-07-20")).toBe(true); // 하루만에 클리어
  });

  it("클리어가 플레이보다 앞서면 거짓", () => {
    expect(isDateOrderValid("2026-07-20", "2026-07-19")).toBe(false);
    // 사전순 비교라 연·월 경계도 잡혀야 한다.
    expect(isDateOrderValid("2026-01-01", "2025-12-31")).toBe(false);
  });

  it("한쪽이 null 이면 비교할 게 없어 참 — 플레이 없이 클리어만 아는 경우도 허용", () => {
    expect(isDateOrderValid(null, "2026-07-20")).toBe(true);
    expect(isDateOrderValid("2026-07-20", null)).toBe(true);
    expect(isDateOrderValid(null, null)).toBe(true);
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
