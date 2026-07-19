import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { games, makeDb } from "./index";

/* D1 마이그레이션 + Drizzle + 무결성 제약이 workerd 안에서 실제로 서는지 못박는다. 각 it 은
   격리 저장소라 마이그레이션된 빈 스키마에서 시작한다(setupFiles). */
describe("games 스키마 (D1 마이그레이션 스모크)", () => {
  it("행을 넣고 다시 읽는다 — 날짜는 nullable, 타임스탬프는 앱이 채운다", async () => {
    const db = makeDb(env.DB);
    const [row] = await db
      .insert(games)
      .values({
        categoryId: "cat-eldenring",
        categoryType: "GAME",
        categoryValue: "엘든링",
        posterImageUrl: null,
      })
      .returning();
    expect(row).toBeDefined();
    // 날짜를 안 주면 null — "아직 안 한 게임". status 컬럼은 드롭됐고 이 둘이 상태의 정본이다.
    expect(row!.playedAt).toBeNull();
    expect(row!.clearedAt).toBeNull();
    expect(typeof row!.createdAt).toBe("number"); // $defaultFn(Date.now) — 앱이 단일 진실원
    // 둘 다 삽입 시각이지만 각기 다른 Date.now() 호출이라 ms 경계에서 1ms 어긋날 수 있다 —
    // 동일성이 아니라 근접으로 본다(삽입 시엔 갱신이 없어 사실상 같은 시각).
    expect(Math.abs(row!.lastUpdatedAt - row!.createdAt)).toBeLessThanOrEqual(5);

    const all = await db.select().from(games);
    expect(all).toHaveLength(1);
  });

  it("category_id UNIQUE 를 강제한다(한 카테고리 = 보드 1회)", async () => {
    const db = makeDb(env.DB);
    await db.insert(games).values({ categoryId: "dup", categoryType: "GAME", categoryValue: "A" });
    await expect(
      db.insert(games).values({ categoryId: "dup", categoryType: "GAME", categoryValue: "B" }),
    ).rejects.toThrow();
  });

  it("category_id NULL 은 중복 가능하다 — 수동 입력 게임이 UNIQUE 에 걸리지 않는다", async () => {
    // SQLite 의 UNIQUE 는 NULL 을 서로 다르게 본다. 이 성질에 기대어 "치지직 게임은 1회,
    // 수동 입력은 몇 개든"을 인덱스 하나로 표현한다 — 깨지면 두 번째 수동 입력이 막힌다.
    const db = makeDb(env.DB);
    await db.insert(games).values({ categoryType: "GAME", categoryValue: "손입력 A" });
    await db.insert(games).values({ categoryType: "GAME", categoryValue: "손입력 B" });
    const all = await db.select().from(games);
    expect(all).toHaveLength(2);
    expect(all.every((g) => g.categoryId === null)).toBe(true);
  });

  it("날짜는 'YYYY-MM-DD' 텍스트로 왕복한다(epoch 변환 없음)", async () => {
    const db = makeDb(env.DB);
    const [row] = await db
      .insert(games)
      .values({
        categoryId: "cat-dated",
        categoryType: "GAME",
        categoryValue: "리틀 나이트메어",
        playedAt: "2026-04-11",
        clearedAt: "2026-04-14",
      })
      .returning();
    // 텍스트 저장이라 타임존이 개입할 여지가 없다 — 넣은 문자열이 그대로 나온다.
    expect(row!.playedAt).toBe("2026-04-11");
    expect(row!.clearedAt).toBe("2026-04-14");
  });

  it("category_type CHECK 는 GAME 만 허용한다(ADR-0015)", async () => {
    const db = makeDb(env.DB);
    const bad = { categoryId: "y", categoryType: "SPORTS", categoryValue: "A" };
    await expect(db.insert(games).values(bad as typeof games.$inferInsert)).rejects.toThrow();
  });
});
