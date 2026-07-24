import { describe, expect, it } from "vitest";
import {
  authoritiesFor,
  hasAuthority,
  isRole,
  ROLE_AUTHORITIES,
  type Authority,
} from "./authorities";

describe("authoritiesFor", () => {
  it("member(역할 없음)는 빈 집합", () => {
    const a = authoritiesFor([]);
    expect(a.size).toBe(0);
    expect(hasAuthority(a, "game:write")).toBe(false);
    expect(hasAuthority(a, "game:delete")).toBe(false);
    expect(hasAuthority(a, "schedule:write")).toBe(false);
    expect(hasAuthority(a, "role:manage")).toBe(false);
  });

  it("admin 은 game·schedule 쓰기·삭제는 되지만 role:manage 는 못 한다(상승 가드)", () => {
    const a = authoritiesFor(["admin"]);
    expect(hasAuthority(a, "game:write")).toBe(true);
    expect(hasAuthority(a, "game:delete")).toBe(true);
    expect(hasAuthority(a, "schedule:write")).toBe(true);
    // 핵심 불변식: admin 은 다른 admin 을 임명·강등할 수 없다.
    expect(hasAuthority(a, "role:manage")).toBe(false);
  });

  it("superadmin 만 role:manage 를 가진다", () => {
    const a = authoritiesFor(["superadmin"]);
    expect(hasAuthority(a, "role:manage")).toBe(true);
    expect(hasAuthority(a, "game:write")).toBe(true);
    expect(hasAuthority(a, "game:delete")).toBe(true);
    expect(hasAuthority(a, "schedule:write")).toBe(true);
  });

  it("여러 역할은 합집합(superadmin 이 admin 을 포섭)", () => {
    const a = authoritiesFor(["admin", "superadmin"]);
    expect([...a].sort()).toEqual(["game:delete", "game:write", "role:manage", "schedule:write"]);
  });

  it("반환 집합은 상수를 오염시키지 않는다(새 Set)", () => {
    const a = authoritiesFor(["admin"]);
    a.add("role:manage");
    // 상수는 그대로 — admin 매핑에 role:manage 가 새지 않는다.
    expect(ROLE_AUTHORITIES.admin.includes("role:manage" as Authority)).toBe(false);
  });
});

describe("isRole", () => {
  it("저장되는 역할만 인정", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("superadmin")).toBe(true);
  });

  it("member·미지·비문자열·프로토타입 키는 거절", () => {
    // member 는 역할 행이 없다는 뜻이라 저장되는 Role 이 아니다.
    expect(isRole("member")).toBe(false);
    expect(isRole("root")).toBe(false);
    expect(isRole("constructor")).toBe(false);
    expect(isRole(7)).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});
