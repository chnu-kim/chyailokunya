import { describe, expect, it } from "vitest";
import {
  ANGLE,
  axis,
  coerce,
  hash,
  parseGames,
  PATTERNS,
  ROT,
  seeds,
  STATUS,
  statusOf,
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

describe("coerce", () => {
  it("객체가 아니면 null", () => {
    expect(coerce(null, 0)).toBeNull();
    expect(coerce("nope", 0)).toBeNull();
    expect(coerce(42, 0)).toBeNull();
  });

  it("이름이 비면 null(공백만도 null)", () => {
    expect(coerce({ name: "" }, 0)).toBeNull();
    expect(coerce({ name: "   " }, 0)).toBeNull();
    expect(coerce({ genre: "RPG" }, 0)).toBeNull();
  });

  it("이름을 트림하고 빈 필드는 '—' 로 채운다", () => {
    const g = coerce({ name: "  스타듀 밸리  " }, 3);
    expect(g).not.toBeNull();
    expect(g!.name).toBe("스타듀 밸리");
    expect(g!.genre).toBe("—");
    expect(g!.platform).toBe("—");
    expect(g!.status).toBe("played");
  });

  it("id 가 없으면 인덱스·이름 길이로 만든다", () => {
    const g = coerce({ name: "엘든링" }, 5);
    expect(g!.id).toBe("g-5-3");
  });

  it("프로토타입 체인 상태값은 played 로 정규화된다", () => {
    expect(coerce({ name: "x", status: "constructor" }, 0)!.status).toBe("played");
    expect(coerce({ name: "x", status: "playing" }, 0)!.status).toBe("playing");
    // 비문자열 status 도 안전하게 played
    expect(coerce({ name: "x", status: 7 }, 0)!.status).toBe("played");
  });
});

describe("parseGames", () => {
  it("null·빈 문자열이면 시드 8장(지울 것 없음)", () => {
    expect(parseGames(null)).toEqual({ games: seeds(), clear: false });
    expect(parseGames("")).toEqual({ games: seeds(), clear: false });
  });

  it("JSON 이 아니면 시드 + 클리어", () => {
    const r = parseGames("not json{");
    expect(r.games).toHaveLength(8);
    expect(r.clear).toBe(true);
  });

  it("배열이 아닌 JSON(객체·null·숫자)은 시드 + 클리어", () => {
    expect(parseGames('{"a":1}').clear).toBe(true);
    expect(parseGames("null").clear).toBe(true);
    expect(parseGames("0").clear).toBe(true);
    expect(parseGames('{"a":1}').games).toHaveLength(8);
  });

  it("빈 배열은 시드가 아니라 빈 배열 그대로(사용자가 다 지웠다)", () => {
    expect(parseGames("[]")).toEqual({ games: [], clear: false });
  });

  it("레코드가 있었는데 전부 걸러지면 손상으로 보고 시드 + 클리어", () => {
    const r = parseGames('[{"foo":1},{"name":""}]');
    expect(r.games).toHaveLength(8);
    expect(r.clear).toBe(true);
  });

  it("유효한 레코드만 남기고 손상 레코드는 조용히 버린다", () => {
    const r = parseGames('[{"name":"엘든링","status":"played"},{"foo":1}]');
    expect(r.clear).toBe(false);
    expect(r.games).toHaveLength(1);
    expect(r.games[0]!.name).toBe("엘든링");
  });
});

describe("hash / axis", () => {
  it("hash 는 결정적이고 음이 아니다", () => {
    expect(hash("seed-0")).toBe(hash("seed-0"));
    expect(hash("seed-0")).toBeGreaterThanOrEqual(0);
  });

  it("axis 는 0..n-1 범위 안", () => {
    for (const g of seeds()) {
      const p = axis(g.id, "pat", PATTERNS);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(PATTERNS);
      expect(axis(g.id, "rot", ROT.length)).toBeLessThan(ROT.length);
      expect(axis(g.id, "ang", ANGLE.length)).toBeLessThan(ANGLE.length);
    }
  });

  it("소금이 축을 퍼뜨린다 — seed-0..7 이 한 종으로 붕괴하지 않는다", () => {
    // 소금 없이 한 해시를 나눠 쓰면 패턴이 1종으로 붕괴했다(끝 글자만 다른 id).
    const pats = new Set(seeds().map((g) => axis(g.id, "pat", PATTERNS)));
    const angs = new Set(seeds().map((g) => axis(g.id, "ang", ANGLE.length)));
    expect(pats.size).toBeGreaterThanOrEqual(2);
    expect(angs.size).toBeGreaterThanOrEqual(3);
  });
});
