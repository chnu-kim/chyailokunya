import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { gameSuggestions, games, makeDb, scheduleEntries, scheduleWeeks, users } from "./index";

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
    expect(entry!.gameId).toBe(g!.id);

    // 자유 제목 항목(게임 없는 편성) — game_id 없이도 선다.
    const [free] = await db
      .insert(scheduleEntries)
      .values({ scheduledDate: "2026-07-21", title: "저챗" })
      .returning();
    expect(free!.gameId).toBeNull();
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

/* 팬 수정 제안(ADR-0025). 이 테이블은 CHECK 가 넷이라 "저장 가능한 모양"이 곧 도메인 규칙이다 —
   그 규칙이 실제 D1 에서 서는지 못박는다(타입만으로는 SQL 값 검사를 보증 못 한다). */
describe("제안 스키마 (D1 마이그레이션 스모크)", () => {
  // 제안엔 작성자가 필수라 헬퍼로 뽑는다. users 는 신원 앵커라 컬럼이 타임스탬프뿐이다.
  async function seed(db: ReturnType<typeof makeDb>) {
    const [author] = await db.insert(users).values({}).returning();
    const [game] = await db
      .insert(games)
      .values({ categoryType: "GAME", categoryValue: "젤다의 전설" })
      .returning();
    return { authorId: author!.id, gameId: game!.id };
  }

  it("수정 제안을 넣고 읽는다 — 기본값은 미처리(pending)·안 깬 상태", async () => {
    const db = makeDb(env.DB);
    const { authorId, gameId } = await seed(db);
    const [row] = await db
      .insert(gameSuggestions)
      .values({ kind: "edit", gameId, authorUserId: authorId, note: "7/20 에 엔딩 봤어요" })
      .returning();
    expect(row!.status).toBe("pending");
    expect(row!.proposedCleared).toBe(false);
    expect(row!.resolvedAt).toBeNull();
    expect(row!.proposedTitle).toBeNull();
  });

  it("추가 요청은 대상 없이 이름만 든다", async () => {
    const db = makeDb(env.DB);
    const { authorId } = await seed(db);
    const [row] = await db
      .insert(gameSuggestions)
      .values({ kind: "add", authorUserId: authorId, proposedTitle: "새로 나온 인디게임" })
      .returning();
    expect(row!.gameId).toBeNull();
    expect(row!.proposedTitle).toBe("새로 나온 인디게임");
  });

  /* 종류마다 채워지는 자리가 다르다 — 섞인 행이 저장되면 제안함이 무엇을 그릴지 화면에서 갈린다. */
  it("종류와 안 맞는 모양은 거절한다(shape CHECK)", async () => {
    const db = makeDb(env.DB);
    const { authorId, gameId } = await seed(db);
    // 수정 제안인데 대상이 없다.
    await expect(
      db.insert(gameSuggestions).values({ kind: "edit", authorUserId: authorId }),
    ).rejects.toThrow();
    // 수정 제안인데 새 이름을 들고 있다.
    await expect(
      db
        .insert(gameSuggestions)
        .values({ kind: "edit", gameId, authorUserId: authorId, proposedTitle: "딴 이름" }),
    ).rejects.toThrow();
    // 추가 요청인데 대상 게임이 있다.
    await expect(
      db
        .insert(gameSuggestions)
        .values({ kind: "add", gameId, authorUserId: authorId, proposedTitle: "이름" }),
    ).rejects.toThrow();
    // 추가 요청인데 이름이 없다.
    await expect(
      db.insert(gameSuggestions).values({ kind: "add", authorUserId: authorId }),
    ).rejects.toThrow();
  });

  it("안 깬 채 클리어 날짜만 있는 제안을 거절한다(games CHECK 의 짝)", async () => {
    const db = makeDb(env.DB);
    const { authorId, gameId } = await seed(db);
    await expect(
      db.insert(gameSuggestions).values({
        kind: "edit",
        gameId,
        authorUserId: authorId,
        proposedCleared: false,
        proposedClearedDate: "2026-07-20",
      }),
    ).rejects.toThrow();
    // 깬 채 날짜를 모르는 제안은 통과한다 — 그 표현을 살리는 게 플래그를 날짜와 독립으로 둔 이유.
    const [ok] = await db
      .insert(gameSuggestions)
      .values({ kind: "edit", gameId, authorUserId: authorId, proposedCleared: true })
      .returning();
    expect(ok!.proposedClearedDate).toBeNull();
  });

  /* "처리됐다"와 "처리 흔적이 있다"가 어긋나면 제안함 목록과 감사가 다른 집합을 본다. */
  it("처리 상태와 처리 흔적이 어긋나면 거절한다(resolution CHECK)", async () => {
    const db = makeDb(env.DB);
    const { authorId, gameId } = await seed(db);
    // 미처리인데 처리 시각이 있다.
    await expect(
      db
        .insert(gameSuggestions)
        .values({ kind: "edit", gameId, authorUserId: authorId, resolvedAt: Date.now() }),
    ).rejects.toThrow();
    // 처리됐는데 처리자가 없다.
    await expect(
      db.insert(gameSuggestions).values({
        kind: "edit",
        gameId,
        authorUserId: authorId,
        status: "accepted",
        resolvedAt: Date.now(),
      }),
    ).rejects.toThrow();
    // 둘 다 갖추면 통과한다.
    const [ok] = await db
      .insert(gameSuggestions)
      .values({
        kind: "edit",
        gameId,
        authorUserId: authorId,
        status: "rejected",
        resolvedAt: Date.now(),
        resolvedByUserId: authorId,
      })
      .returning();
    expect(ok!.status).toBe("rejected");
  });

  it("한 사람이 한 게임에 미처리 제안 하나 — 처리되면 다시 낼 수 있다", async () => {
    const db = makeDb(env.DB);
    const { authorId, gameId } = await seed(db);
    const [first] = await db
      .insert(gameSuggestions)
      .values({ kind: "edit", gameId, authorUserId: authorId })
      .returning();
    await expect(
      db.insert(gameSuggestions).values({ kind: "edit", gameId, authorUserId: authorId }),
    ).rejects.toThrow();

    /* 부분 인덱스라 처리된 제안은 제약 밖으로 빠진다 — 이력이 쌓이는 걸 막지 않는다.
       (막으면 한 번 거절당한 사람은 그 게임에 영영 제보를 못 한다.) */
    await db
      .update(gameSuggestions)
      .set({ status: "rejected", resolvedAt: Date.now(), resolvedByUserId: authorId })
      .where(eq(gameSuggestions.id, first!.id));
    await db.insert(gameSuggestions).values({ kind: "edit", gameId, authorUserId: authorId });
    expect(await db.select().from(gameSuggestions)).toHaveLength(2);
  });

  it("추가 요청은 여러 건 낼 수 있다 — 대상이 없어 그 제약이 성립하지 않는다", async () => {
    const db = makeDb(env.DB);
    const { authorId } = await seed(db);
    await db
      .insert(gameSuggestions)
      .values({ kind: "add", authorUserId: authorId, proposedTitle: "게임 A" });
    await db
      .insert(gameSuggestions)
      .values({ kind: "add", authorUserId: authorId, proposedTitle: "게임 B" });
    expect(await db.select().from(gameSuggestions)).toHaveLength(2);
  });

  /* 게임이 보드에서 사라지면 반영할 대상이 없다. SET NULL 이면 shape CHECK 를 깨서 게임 삭제
     자체가 실패하므로 CASCADE 여야 한다 — 그 사실을 여기서 못박는다. */
  it("게임을 지우면 그 게임의 제안도 함께 사라진다(CASCADE)", async () => {
    const db = makeDb(env.DB);
    const { authorId, gameId } = await seed(db);
    await db.insert(gameSuggestions).values({ kind: "edit", gameId, authorUserId: authorId });
    await db.delete(games).where(eq(games.id, gameId));
    expect(await db.select().from(gameSuggestions)).toHaveLength(0);
  });
});

/* 도배 상한의 **진짜 방어선**(마이그레이션 0010 의 BEFORE INSERT 트리거). 앱 쪽 검사는
   count → insert 두 왕복이라 동시 요청 앞에서 통째로 뚫린다 — 그래서 여기선 앱을 거치지 않고
   db 에 직접 넣어, 판정이 쓰기 연산 자체에 붙어 있는지를 본다(그게 경합에서도 서는 유일한 이유). */
describe("제안 도배 상한 (트리거)", () => {
  // 마이그레이션 0010 의 RAISE 조건과 같은 값. 갈리면 이 테스트가 먼저 빨개진다.
  const LIMIT = 20;

  async function seedAuthor(db: ReturnType<typeof makeDb>): Promise<number> {
    const [row] = await db.insert(users).values({}).returning();
    return row!.id;
  }

  it("미처리 제안이 상한에 닿으면 그다음 INSERT 를 DB 가 거절한다", async () => {
    const db = makeDb(env.DB);
    const authorId = await seedAuthor(db);
    for (let i = 0; i < LIMIT; i++) {
      await db
        .insert(gameSuggestions)
        .values({ kind: "add", authorUserId: authorId, proposedTitle: "게임 " + i });
    }
    await expect(
      db
        .insert(gameSuggestions)
        .values({ kind: "add", authorUserId: authorId, proposedTitle: "한 개 더" }),
    ).rejects.toThrow();
    expect(await db.select().from(gameSuggestions)).toHaveLength(LIMIT);
  });

  it("상한은 **작성자별**이고 처리된 제안은 안 센다", async () => {
    const db = makeDb(env.DB);
    const a = await seedAuthor(db);
    const b = await seedAuthor(db);
    for (let i = 0; i < LIMIT; i++) {
      await db
        .insert(gameSuggestions)
        .values({ kind: "add", authorUserId: a, proposedTitle: "A" + i });
    }
    // 남의 상한이 내 제안을 막으면 한 사람이 사이트 전체의 제안을 잠글 수 있다.
    await expect(
      db.insert(gameSuggestions).values({ kind: "add", authorUserId: b, proposedTitle: "B" }),
    ).resolves.toBeDefined();

    /* 처리하면 자리가 난다 — 안 그러면 상한에 닿은 사람은 관리자가 무엇을 하든 영영 못 낸다.
       status 를 보는 조건이 트리거에 실제로 들어 있는지가 여기서 갈린다. */
    const [first] = await db
      .select()
      .from(gameSuggestions)
      .where(eq(gameSuggestions.authorUserId, a));
    await db
      .update(gameSuggestions)
      .set({ status: "rejected", resolvedAt: Date.now(), resolvedByUserId: a })
      .where(eq(gameSuggestions.id, first!.id));
    await expect(
      db.insert(gameSuggestions).values({ kind: "add", authorUserId: a, proposedTitle: "다시" }),
    ).resolves.toBeDefined();
  });
});
