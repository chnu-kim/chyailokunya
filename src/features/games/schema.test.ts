import { describe, expect, it } from "vitest";
import { addGameInput, updateGameInput } from "./schema";

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

  it("posterImageUrl 의 빈 문자열·공백만은 null 로 접힌다(포스터 없음의 유일한 표현)", () => {
    for (const empty of ["", "   "]) {
      const result = addGameInput.safeParse({ ...base, posterImageUrl: empty });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.posterImageUrl).toBeNull();
    }
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
      // 날짜를 안 보내면 둘 다 null — "아직 안 한 게임"이 기본값이다.
      expect(result.data.playedAt).toBeNull();
      expect(result.data.clearedAt).toBeNull();
    }
  });

  it("categoryId 없이도 통과 — 수동 입력 게임(치지직 키 없음)", () => {
    for (const missing of [{}, { categoryId: null }, { categoryId: "" }, { categoryId: "   " }]) {
      const result = addGameInput.safeParse({
        categoryType: "GAME" as const,
        categoryValue: "손으로 넣은 게임",
        ...missing,
      });
      expect(result.success).toBe(true);
      // 빈 문자열이 그대로 저장되면 두 번째 수동 입력이 UNIQUE 로 충돌한다 — null 이어야 한다.
      if (result.success) expect(result.data.categoryId).toBeNull();
    }
  });
});

describe("날짜 입력 (addGameInput·updateGameInput 공통 계약)", () => {
  it("실재하지 않는 날짜는 거절 — 형식만 맞는 값이 새지 않는다", () => {
    for (const bad of ["2026-02-31", "2025-02-29", "2026-13-01", "2026-07-32", "2026-7-20"]) {
      expect(addGameInput.safeParse({ ...base, playedAt: bad }).success).toBe(false);
      expect(addGameInput.safeParse({ ...base, clearedAt: bad }).success).toBe(false);
      expect(updateGameInput.safeParse({ id: 1, playedAt: bad }).success).toBe(false);
    }
  });

  it("빈 문자열·공백만은 null 로 접힌다(빈 date 입력이 보내는 값)", () => {
    for (const empty of ["", "   "]) {
      const result = addGameInput.safeParse({ ...base, playedAt: empty, clearedAt: empty });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.playedAt).toBeNull();
        expect(result.data.clearedAt).toBeNull();
      }
    }
  });

  it("미래 날짜는 허용(발매 예정작을 미리 올릴 수 있다)", () => {
    expect(addGameInput.safeParse({ ...base, playedAt: "2099-01-01" }).success).toBe(true);
  });

  it("clearedAt 이 playedAt 보다 앞서면 거절, 같거나 뒤면 통과", () => {
    const bad = addGameInput.safeParse({
      ...base,
      playedAt: "2026-07-20",
      clearedAt: "2026-07-19",
    });
    expect(bad.success).toBe(false);
    // 폼이 오류를 띄울 자리를 알아야 한다 — path 는 clearedAt.
    if (!bad.success) expect(bad.error.issues[0]!.path).toEqual(["clearedAt"]);

    expect(
      addGameInput.safeParse({ ...base, playedAt: "2026-07-20", clearedAt: "2026-07-20" }).success,
    ).toBe(true);
    expect(
      addGameInput.safeParse({ ...base, playedAt: "2026-07-01", clearedAt: "2026-07-20" }).success,
    ).toBe(true);
  });

  it("playedAt 없이 clearedAt 만 있어도 통과(순서 검사 대상이 아니다)", () => {
    expect(addGameInput.safeParse({ ...base, clearedAt: "2026-07-20" }).success).toBe(true);
    expect(updateGameInput.safeParse({ id: 1, clearedAt: "2026-07-20" }).success).toBe(true);
  });
});

describe("updateGameInput", () => {
  it("id 는 양의 정수여야 한다", () => {
    for (const bad of [0, -1, 1.5, "1"]) {
      expect(updateGameInput.safeParse({ id: bad }).success).toBe(false);
    }
  });

  it("날짜를 안 보내면 둘 다 null — 지우기가 표현된다", () => {
    const result = updateGameInput.safeParse({ id: 7 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: 7, playedAt: null, clearedAt: null });
    }
  });

  it("순서 역전은 여기서도 막힌다(수정 경로로 우회 불가)", () => {
    const result = updateGameInput.safeParse({
      id: 1,
      playedAt: "2026-07-20",
      clearedAt: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });
});
