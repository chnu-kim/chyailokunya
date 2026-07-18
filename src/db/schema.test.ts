import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { games, makeDb } from "./index";

/* D1 마이그레이션 + Drizzle + 무결성 제약이 workerd 안에서 실제로 서는지 못박는다. 각 it 은
   격리 저장소라 마이그레이션된 빈 스키마에서 시작한다(setupFiles). */
describe("games 스키마 (D1 마이그레이션 스모크)", () => {
  it("행을 넣고 다시 읽는다 — status DEFAULT·타임스탬프는 앱이 채운다", async () => {
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
    expect(row!.status).toBe("played"); // CHECK 밖이 아닌 DEFAULT
    expect(typeof row!.createdAt).toBe("number"); // $defaultFn(Date.now) — 앱이 단일 진실원
    expect(row!.lastUpdatedAt).toBe(row!.createdAt);

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

  it("status CHECK 를 강제한다(enum 밖 값은 DB 가 거절)", async () => {
    const db = makeDb(env.DB);
    // enum 이 타입으로 막는 값을 캐스트로 우회해도 DB 의 CHECK 가 거절하는지 본다.
    const bad = { categoryId: "x", categoryType: "GAME", categoryValue: "A", status: "bogus" };
    await expect(db.insert(games).values(bad as typeof games.$inferInsert)).rejects.toThrow();
  });

  it("category_type CHECK 는 GAME 만 허용한다(ADR-0015)", async () => {
    const db = makeDb(env.DB);
    const bad = { categoryId: "y", categoryType: "SPORTS", categoryValue: "A" };
    await expect(db.insert(games).values(bad as typeof games.$inferInsert)).rejects.toThrow();
  });
});
