import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { games, makeDb, scheduleEntries, scheduleWeeks } from "./index";

/* D1 마이그레이션 + Drizzle + 무결성 제약이 workerd 안에서 실제로 서는지 못박는다. 각 it 은
   격리 저장소라 마이그레이션된 빈 스키마에서 시작한다(setupFiles). */
describe("games 스키마 (D1 마이그레이션 스모크)", () => {
  it("행을 넣고 다시 읽는다 — 새 게임은 안 깬 채, 타임스탬프는 앱이 채운다", async () => {
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
    // cleared 기본 false — "아직 안 깬 게임". 플레이 날짜는 games 컬럼이 아니라 일정 정본이다.
    expect(row!.cleared).toBe(false);
    expect(row!.clearedDate).toBeNull();
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

  it("클리어 날짜는 'YYYY-MM-DD' 텍스트로 왕복한다(epoch 변환 없음)", async () => {
    const db = makeDb(env.DB);
    const [row] = await db
      .insert(games)
      .values({
        categoryId: "cat-cleared",
        categoryType: "GAME",
        categoryValue: "리틀 나이트메어",
        cleared: true,
        clearedDate: "2026-04-14",
      })
      .returning();
    // 텍스트 저장이라 타임존이 개입할 여지가 없다 — 넣은 문자열이 그대로 나온다.
    expect(row!.cleared).toBe(true);
    expect(row!.clearedDate).toBe("2026-04-14");
  });

  it("깼는데 날짜 모름 — cleared=true·clearedDate=null 은 허용한다(할로우 나이트)", async () => {
    const db = makeDb(env.DB);
    const [row] = await db
      .insert(games)
      .values({ categoryType: "GAME", categoryValue: "할로우 나이트", cleared: true })
      .returning();
    expect(row!.cleared).toBe(true);
    expect(row!.clearedDate).toBeNull();
  });

  it("CHECK 는 안 깬 게임에 클리어 날짜가 붙는 모순을 막는다(cleared=0·date≠null)", async () => {
    const db = makeDb(env.DB);
    await expect(
      db.insert(games).values({
        categoryType: "GAME",
        categoryValue: "모순",
        cleared: false,
        clearedDate: "2026-04-14",
      }),
    ).rejects.toThrow();
  });

  it("category_type CHECK 는 GAME 만 허용한다(ADR-0015)", async () => {
    const db = makeDb(env.DB);
    const bad = { categoryId: "y", categoryType: "SPORTS", categoryValue: "A" };
    await expect(db.insert(games).values(bad as typeof games.$inferInsert)).rejects.toThrow();
  });
});

/* 일정 정본(이슈 #56). 캘린더·주간표·게임 플레이 날짜가 이 항목들에서 유도된다 — 스키마가
   실제로 서는지, FK·UNIQUE·nullable 규약이 맞는지 못박는다. */
describe("일정 스키마 (D1 마이그레이션 스모크)", () => {
  it("항목을 넣고 읽는다 — start_time·game_id 는 nullable, scheduled_date 는 텍스트", async () => {
    const db = makeDb(env.DB);
    const [g] = await db
      .insert(games)
      .values({ categoryType: "GAME", categoryValue: "젤다" })
      .returning();
    const [entry] = await db
      .insert(scheduleEntries)
      .values({ scheduledDate: "2026-07-20", title: "젤다 방송", gameId: g!.id })
      .returning();
    expect(entry!.scheduledDate).toBe("2026-07-20");
    expect(entry!.startTime).toBeNull(); // 시각 미정 편성 허용(결정 8)
    expect(entry!.gameId).toBe(g!.id);

    // 자유 제목 항목(게임 없는 편성) — game_id 없이도 선다.
    const [free] = await db
      .insert(scheduleEntries)
      .values({ scheduledDate: "2026-07-21", startTime: "20:00", title: "저챗" })
      .returning();
    expect(free!.gameId).toBeNull();
    expect(free!.startTime).toBe("20:00");
  });

  it("하루에 항목이 여럿 설 수 있다 — UNIQUE 없음(오후 저챗 + 밤 게임)", async () => {
    const db = makeDb(env.DB);
    await db.insert(scheduleEntries).values({ scheduledDate: "2026-07-20", title: "저챗" });
    await db.insert(scheduleEntries).values({ scheduledDate: "2026-07-20", title: "게임" });
    const rows = await db.select().from(scheduleEntries);
    expect(rows).toHaveLength(2);
  });

  it("게임을 지우면 game_id 가 SET NULL 로 풀린다 — 방송 사실은 항목에 남는다", async () => {
    const db = makeDb(env.DB);
    const [g] = await db
      .insert(games)
      .values({ categoryType: "GAME", categoryValue: "삭제될 게임" })
      .returning();
    await db.insert(scheduleEntries).values({
      scheduledDate: "2026-07-20",
      title: "그 게임 방송",
      gameId: g!.id,
    });
    await db.delete(games).where(eq(games.id, g!.id));
    const [entry] = await db.select().from(scheduleEntries);
    expect(entry!.gameId).toBeNull(); // 항목은 자유 제목으로 자립한다
    expect(entry!.title).toBe("그 게임 방송");
  });

  it("schedule_weeks 는 week_start_date UNIQUE — 한 주 = 한 메타 행", async () => {
    const db = makeDb(env.DB);
    await db.insert(scheduleWeeks).values({ weekStartDate: "2026-07-20", note: "이번 주 공지" });
    await expect(
      db.insert(scheduleWeeks).values({ weekStartDate: "2026-07-20", note: "중복" }),
    ).rejects.toThrow();
    const [row] = await db.select().from(scheduleWeeks);
    expect(row!.publishedAt).toBeNull(); // null = 짜는 중(미발행)
  });
});
