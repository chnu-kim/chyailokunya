import { describe, expect, it } from "vitest";
import { addGameInput, updateGameInput } from "./schema";

/* 쓰기 입력 경계의 상한·스킴 검증을 못박는다(감사 발견: 길이 상한 부재 + posterImageUrl
   스킴 미검증). list 가 공개·무페이지네이션이라 여기서 막지 않으면 초대형 행이 그대로
   서빙되고, poster 는 game-board 가 <img src> 로 직접 렌더한다. */

const base = { categoryId: "c1", categoryType: "GAME" as const, categoryValue: "엘든링" };

describe("addGameInput", () => {
  /* 회귀: categoryId 상한이 64였을 때 프로덕션에서 이 게임이 BAD_REQUEST/too_big 으로
     막혔다. 치지직 categoryId 는 짧은 키가 아니라 영문 원제를 옮긴 슬러그라, 원제가 긴
     게임은 64를 그냥 넘는다 — 멀쩡한 게임을 못 올렸다. 실제로 막혔던 길이대의 값을 남긴다. */
  it("원제가 긴 게임의 categoryId(64자 초과)도 통과 — 실제로 막혔던 회귀", () => {
    const longSlug = "Laytons_Mystery_Journey_Katrielle_and_the_Millionaires_Conspiracy_Deluxe";
    expect(longSlug.length).toBeGreaterThan(64);
    const result = addGameInput.safeParse({ ...base, categoryId: longSlug });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.categoryId).toBe(longSlug);
  });

  it("categoryId 가 상한(200)을 넘으면 거절 — 상한 자체는 남긴다(공개·무페이지네이션 list)", () => {
    const result = addGameInput.safeParse({ ...base, categoryId: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

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

  it("정상 치지직 category 스냅샷은 통과 — add 는 카테고리 4필드만 받는다(날짜 없음)", () => {
    const result = addGameInput.safeParse({
      ...base,
      posterImageUrl: "https://ssl.pstatic.net/cmcp/section/2024/game/poster.jpg",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categoryId).toBe("c1");
      expect(result.data.categoryValue).toBe("엘든링");
      // 클리어·플레이 날짜는 add 입력에 없다 — 플레이는 일정 정본, 클리어는 추가 뒤 편집.
      expect(result.data).not.toHaveProperty("clearedDate");
      expect(result.data).not.toHaveProperty("cleared");
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

describe("updateGameInput — 클리어 상태", () => {
  it("id 는 양의 정수, cleared 는 필수 boolean", () => {
    for (const bad of [0, -1, 1.5, "1"]) {
      expect(updateGameInput.safeParse({ id: bad, cleared: false }).success).toBe(false);
    }
    // cleared 를 빼면 "안 보냄"과 "false" 가 구분 안 돼 거절(부분 patch 아님).
    expect(updateGameInput.safeParse({ id: 1 }).success).toBe(false);
  });

  it("clearedDate 를 안 보내면 null — cleared=true 면 '깼는데 날짜 모름'", () => {
    const result = updateGameInput.safeParse({ id: 7, cleared: true, playedDate: null });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data).toEqual({ id: 7, cleared: true, clearedDate: null, playedDate: null });
  });

  it("clearedDate 의 빈 문자열·공백만은 null 로 접힌다(빈 date 입력이 보내는 값)", () => {
    for (const empty of ["", "   "]) {
      const result = updateGameInput.safeParse({
        id: 1,
        cleared: true,
        clearedDate: empty,
        playedDate: null,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.clearedDate).toBeNull();
    }
  });

  it("실재하지 않는 clearedDate 는 거절 — 형식만 맞는 값이 새지 않는다", () => {
    for (const bad of ["2026-02-31", "2025-02-29", "2026-13-01", "2026-07-32", "2026-7-20"]) {
      expect(
        updateGameInput.safeParse({ id: 1, cleared: true, clearedDate: bad, playedDate: null })
          .success,
      ).toBe(false);
    }
  });

  it("미래 clearedDate 는 허용", () => {
    expect(
      updateGameInput.safeParse({
        id: 1,
        cleared: true,
        clearedDate: "2099-01-01",
        playedDate: null,
      }).success,
    ).toBe(true);
  });

  it("안 깼는데 클리어 날짜가 있으면 거절(DB CHECK 의 Zod 짝), path 는 clearedDate", () => {
    const bad = updateGameInput.safeParse({
      id: 1,
      cleared: false,
      clearedDate: "2026-07-20",
      playedDate: null,
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]!.path).toEqual(["clearedDate"]);
  });

  it("깬 채 날짜 있음·날짜 없음은 둘 다 통과", () => {
    expect(
      updateGameInput.safeParse({
        id: 1,
        cleared: true,
        clearedDate: "2026-07-20",
        playedDate: null,
      }).success,
    ).toBe(true);
    expect(updateGameInput.safeParse({ id: 1, cleared: true, playedDate: null }).success).toBe(
      true,
    );
  });
});

describe("updateGameInput — 플레이 날짜", () => {
  /* clearedDate 와 달리 **빠뜨리면 거절**한다. playedDate 는 null 이 곧 "일정 항목을 지운다"라,
     기본값을 주면 필드를 안 실은 호출자가 조용히 날짜를 지운다 — 그 실수를 여기서 잡는다. */
  it("playedDate 를 안 보내면 거절 — '안 보냄'이 '지움'으로 읽히지 않게", () => {
    expect(updateGameInput.safeParse({ id: 1, cleared: false }).success).toBe(false);
    expect(
      updateGameInput.safeParse({ id: 1, cleared: true, clearedDate: "2026-07-20" }).success,
    ).toBe(false);
  });

  it("명시한 null 은 통과 — 그건 지우겠다는 뜻이다", () => {
    const result = updateGameInput.safeParse({ id: 1, cleared: false, playedDate: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.playedDate).toBeNull();
  });

  it("빈 문자열은 null 로 접힌다(빈 date 입력이 보내는 값)", () => {
    const result = updateGameInput.safeParse({ id: 1, cleared: false, playedDate: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.playedDate).toBeNull();
  });

  it("실재하지 않는 날짜는 거절, 미래 날짜는 허용", () => {
    expect(
      updateGameInput.safeParse({ id: 1, cleared: false, playedDate: "2026-02-31" }).success,
    ).toBe(false);
    expect(
      updateGameInput.safeParse({ id: 1, cleared: false, playedDate: "2099-01-01" }).success,
    ).toBe(true);
  });

  /* add 쪽은 기본값을 남긴다 — 새 게임엔 지울 항목이 없어 "안 보냄 = 지움" 사고가 성립하지
     않는다(seed 처럼 날짜를 모르는 호출자가 필드를 안 실어도 안전하다). */
  it("addGameInput 의 playedDate 는 선택 — 없으면 null 로 시작한다", () => {
    const result = addGameInput.safeParse({
      categoryId: "elden-ring",
      categoryType: "GAME",
      categoryValue: "엘든 링",
      posterImageUrl: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.playedDate).toBeNull();
  });
});
