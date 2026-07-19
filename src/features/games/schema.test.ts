import { describe, expect, it } from "vitest";
import { addGameInput } from "./schema";

/* 쓰기 입력 경계의 상한·스킴 검증을 못박는다(감사 발견: 길이 상한 부재 + posterImageUrl
   스킴 미검증). list 가 공개·무페이지네이션이라 여기서 막지 않으면 초대형 행이 그대로
   서빙되고, poster 는 game-board 가 <img src> 로 직접 렌더한다. */

const base = { categoryId: "c1", categoryType: "GAME" as const, categoryValue: "엘든링" };

describe("addGameInput", () => {
  it("categoryValue 가 상한(200)을 넘으면 거절", () => {
    const result = addGameInput.safeParse({ ...base, categoryValue: "가".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("categoryValue 가 상한(200) 이내면 통과", () => {
    const result = addGameInput.safeParse({ ...base, categoryValue: "가".repeat(200) });
    expect(result.success).toBe(true);
  });

  it("posterImageUrl 이 https 가 아니면 거절(img src 로 렌더되므로 스킴 강제)", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,x", "http://x.test/a.png"]) {
      const result = addGameInput.safeParse({ ...base, posterImageUrl: bad });
      expect(result.success).toBe(false);
    }
  });

  it("posterImageUrl 이 null 이면 허용(포스터 없음)", () => {
    const result = addGameInput.safeParse({ ...base, posterImageUrl: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.posterImageUrl).toBeNull();
  });

  it("정상 치지직 category 스냅샷은 통과", () => {
    const result = addGameInput.safeParse({
      ...base,
      posterImageUrl: "https://ssl.pstatic.net/cmcp/section/2024/game/poster.jpg",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categoryId).toBe("c1");
      expect(result.data.categoryValue).toBe("엘든링");
      expect(result.data.status).toBe("played");
    }
  });
});
