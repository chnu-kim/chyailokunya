import { describe, expect, it } from "vitest";

import { greet } from "./greeting";

describe("greet", () => {
  it("이름을 넣으면 인사에 포함한다", () => {
    expect(greet("쿠냐")).toBe("안녕, 쿠냐!");
  });

  it("공백뿐이면 이름 없이 인사한다", () => {
    expect(greet("   ")).toBe("안녕!");
  });
});
