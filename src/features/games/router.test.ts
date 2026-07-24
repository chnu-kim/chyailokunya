import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { makeDb, scheduleEntries, scheduleWeeks } from "@/db";
import { createCallerFactory } from "@/features/trpc/init";
import { appRouter } from "@/features/router";
import { getPublishedWeek } from "@/features/schedule/service";
import type { Context } from "@/features/trpc/init";

/* tRPC 프로시저를 HTTP·세션 없이 caller 로 직접 부른다(ADR-0008·이슈 #5 완료기준). 쓰기의
   "서버 권위"는 여기서 증명한다 — 주입한 authorities 로 인가가 갈린다. 각 it 은 격리 저장소라
   마이그레이션된 빈 스키마에서 시작한다. */

const createCaller = createCallerFactory(appRouter);
const admin = authoritiesFor(["admin"]); // game:write + game:delete

function makeCtx(over: { authorities?: ReadonlySet<Authority> } = {}): Context {
  const authorities = over.authorities ?? new Set<Authority>();
  return { db: makeDb(env.DB), actor: null, chzzk: null, authoritiesOf: async () => authorities };
}

const eldenring = { categoryId: "c1", categoryType: "GAME", categoryValue: "엘든링" } as const;

describe("games 라우터", () => {
  it("list 는 공개 — 인가 없이도 읽힌다(빈 보드)", async () => {
    const caller = createCaller(makeCtx());
    expect(await caller.games.list()).toEqual([]);
  });

  it("add 는 game:write 없으면 FORBIDDEN(서버 권위)", async () => {
    const caller = createCaller(makeCtx()); // member = 빈 권한
    await expect(caller.games.add(eldenring)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // 막혔으면 저장도 안 됐다.
    expect(await createCaller(makeCtx()).games.list()).toEqual([]);
  });

  it("add 는 game:write 있으면 저장하고 list 에 뜬다(새 게임은 안 깬 채·일정 없음)", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const row = await caller.games.add(eldenring);
    expect(row.id).toBeGreaterThan(0);
    expect(row.cleared).toBe(false);
    expect(row.clearedDate).toBeNull();
    expect(row.lastPlayed).toBeNull(); // 일정 항목이 없으니 유도된 플레이 날짜도 없다
    expect(typeof row.createdAt).toBe("number");

    const list = await createCaller(makeCtx()).games.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.categoryValue).toBe("엘든링");
  });

  /* 추가 폼이 클리어를 받는다(이 보드는 이미 한 방송을 기록하는 자리라 소급 입력이 정상
     경로다 — addGameInput 주석). 안 보내면 default(false) 로 떨어지는 건 위 테스트가 본다. */
  it("add 는 이미 깬 게임을 클리어 상태 그대로 올린다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const row = await caller.games.add({ ...eldenring, cleared: true, clearedDate: "2026-03-01" });
    expect(row.cleared).toBe(true);
    expect(row.clearedDate).toBe("2026-03-01");
  });

  it("add 도 '깼는데 날짜 모름'을 받는다(cleared=true·date 없음)", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const row = await caller.games.add({ ...eldenring, cleared: true });
    expect(row.cleared).toBe(true);
    expect(row.clearedDate).toBeNull();
  });

  it("add 도 클리어 상태 검증을 통과해야 한다(추가 경로로 우회 불가)", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    // 안 깼는데 클리어 날짜만 있는 모순 — DB CHECK 이전에 입력 경계가 막는다.
    await expect(
      caller.games.add({ ...eldenring, cleared: false, clearedDate: "2026-03-01" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await createCaller(makeCtx()).games.list()).toEqual([]);
  });

  it("같은 category_id 재추가는 CONFLICT(한 카테고리 = 보드 1회)", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await caller.games.add({ categoryId: "dup", categoryType: "GAME", categoryValue: "A" });
    await expect(
      caller.games.add({ categoryId: "dup", categoryType: "GAME", categoryValue: "B" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("categoryType 이 GAME 이 아니면 입력 검증(BAD_REQUEST)에서 막힌다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await expect(
      // @ts-expect-error 입력 Zod 가 GAME 리터럴만 받는다(ADR-0015)
      caller.games.add({ categoryId: "x", categoryType: "SPORTS", categoryValue: "축구" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("categoryValue 가 공백만이면 거절(빈 카드 방지)", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await expect(
      caller.games.add({ categoryId: "x", categoryType: "GAME", categoryValue: "   " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("categoryId 를 trim 하고, 공백만이면 null(수동 입력)로 접는다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    // 공백만인 categoryId 는 더 이상 거절이 아니다 — 치지직 키가 없는 수동 입력과 같은 뜻이다.
    // ''를 그대로 저장하면 두 번째 수동 입력이 UNIQUE 로 충돌하므로 null 로 접는 게 핵심.
    const manual = await caller.games.add({
      categoryId: "   ",
      categoryType: "GAME",
      categoryValue: "x",
    });
    expect(manual.categoryId).toBeNull();
    // ' abc ' 는 'abc' 로 정규화 저장되고, 'abc' 재추가는 UNIQUE 충돌 — 패딩으로 못 우회한다.
    const row = await caller.games.add({
      categoryId: " abc ",
      categoryType: "GAME",
      categoryValue: "  엘든 링  ",
    });
    expect(row.categoryId).toBe("abc");
    expect(row.categoryValue).toBe("엘든 링");
    await expect(
      caller.games.add({ categoryId: "abc", categoryType: "GAME", categoryValue: "다른 값" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("수동 입력 — categoryId 없이 추가되고, 여러 개 넣어도 UNIQUE 에 안 걸린다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const a = await caller.games.add({ categoryType: "GAME", categoryValue: "직접 넣은 게임" });
    expect(a.categoryId).toBeNull();
    // 치지직 키가 없는 게임이 둘 이상일 수 있다 — NULL 중복 허용에 기댄다.
    const b = await caller.games.add({ categoryType: "GAME", categoryValue: "또 직접 넣은 게임" });
    expect(b.categoryId).toBeNull();
    expect(await createCaller(makeCtx()).games.list()).toHaveLength(2);
  });

  it("list 는 유도된 플레이 날짜 내림차순, 일정 없는 행은 뒤로(그 안에선 추가 최신순)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const db = makeDb(env.DB);
    // 삽입 순서를 정렬 순서와 일부러 어긋나게 둔다 — createdAt 정렬이 남아 있으면 실패한다.
    const elden = await authed.games.add(eldenring);
    const noDate1 = await authed.games.add({
      categoryId: "c2",
      categoryType: "GAME",
      categoryValue: "일정 없음 1",
    });
    const recent = await authed.games.add({
      categoryId: "c3",
      categoryType: "GAME",
      categoryValue: "최근 플레이",
    });
    const noDate2 = await authed.games.add({
      categoryId: "c4",
      categoryType: "GAME",
      categoryValue: "일정 없음 2",
    });

    // 플레이 날짜의 정본은 일정이다 — 항목을 심어 유도를 검증한다. eldenring 은 항목이 둘이라
    // lastPlayed = MAX(scheduled_date) = 2026-03-01(더 이른 항목 2026-01-01 이 아니다).
    await db.insert(scheduleEntries).values([
      { scheduledDate: "2026-01-01", title: "엘든 첫날", gameId: elden.id },
      { scheduledDate: "2026-03-01", title: "엘든 이어서", gameId: elden.id },
      { scheduledDate: "2026-07-12", title: "최근 방송", gameId: recent.id },
    ]);

    const list = await createCaller(makeCtx()).games.list();
    expect(list.map((g) => g.lastPlayed)).toEqual(["2026-07-12", "2026-03-01", null, null]);
    // 일정 없는 둘 사이에선 나중에 추가한 쪽이 위(created_at DESC).
    expect(list[2]!.id).toBe(noDate2.id);
    expect(list[3]!.id).toBe(noDate1.id);
  });

  it("보드 날짜는 발행 경계를 통과한 항목만 유도한다 — 초안 주는 숨고, 발행하면 뜬다(ADR-0022)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const db = makeDb(env.DB);
    const game = await authed.games.add(eldenring);
    // 2026-07-20 은 월요일. 그 주에 이 게임을 붙여 **초안(미발행)** 으로 저장한다.
    // revision 은 낙관적 동시성 토큰 — 아직 그 주 메타가 없으므로 null 이 맞다.
    const saved = await authed.schedule.saveWeek({
      weekStartDate: "2026-07-20",
      revision: null,
      entries: [{ scheduledDate: "2026-07-22", title: "엘든링", gameId: game.id }],
    });
    // 초안 주의 항목은 보드 날짜에 안 센다 — 관리자가 짜는 중인 편성이 미래 날짜로 새면 안 된다.
    const draft = await createCaller(makeCtx()).games.list();
    expect(draft[0]!.lastPlayed).toBeNull();

    // 같은 주를 발행하면 그 항목이 보드 날짜로 뜬다(발행이 곧 공개 경계).
    // 이어 저장이라 방금 저장이 돌려준 revision 을 그대로 잇는다(편집기가 하는 일과 같다).
    await authed.schedule.saveWeek({
      weekStartDate: "2026-07-20",
      revision: saved.revision,
      published: true,
      entries: [{ scheduledDate: "2026-07-22", title: "엘든링", gameId: game.id }],
    });
    const published = await createCaller(makeCtx()).games.list();
    expect(published[0]!.lastPlayed).toBe("2026-07-22");

    // 주 메타가 아예 없는 항목(이관된 과거 아카이브·직접 심은 데이터)은 발행과 무관하게 센다 —
    // LEFT JOIN 이라 손실이 없다(결정 16). 더 이른 날이라 MAX 는 그대로 07-22.
    await db.insert(scheduleEntries).values({
      scheduledDate: "2026-03-01",
      title: "아카이브",
      gameId: game.id,
    });
    const withLegacy = await createCaller(makeCtx()).games.list();
    expect(withLegacy[0]!.lastPlayed).toBe("2026-07-22");
  });

  it("update 는 game:write 없으면 FORBIDDEN(서버 권위)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);
    await expect(
      createCaller(makeCtx()).games.update({
        id: row.id,
        cleared: true,
        clearedDate: "2026-07-20",
        playedDate: null,
        playedDateWas: null,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // 막혔으면 저장도 안 됐다.
    const [after] = await createCaller(makeCtx()).games.list();
    expect(after!.cleared).toBe(false);
  });

  it("update 는 클리어를 고치고, 해제(false)할 수도 있다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);

    const done = await authed.games.update({
      id: row.id,
      cleared: true,
      clearedDate: "2026-07-20",
      playedDate: null,
      playedDateWas: null,
    });
    expect(done.cleared).toBe(true);
    expect(done.clearedDate).toBe("2026-07-20");

    // cleared=false 로 보내면 클리어가 풀린다(부분 patch 가 아니라 전체 치환). 날짜도 함께 빠진다.
    const undone = await authed.games.update({
      id: row.id,
      cleared: false,
      playedDate: null,
      playedDateWas: null,
    });
    expect(undone.cleared).toBe(false);
    expect(undone.clearedDate).toBeNull();
  });

  it("update 는 '깼는데 날짜 모름'을 받는다(cleared=true·date 없음)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);
    const done = await authed.games.update({
      id: row.id,
      cleared: true,
      playedDate: null,
      playedDateWas: null,
    });
    expect(done.cleared).toBe(true);
    expect(done.clearedDate).toBeNull();
  });

  it("update 는 없는 id 면 NOT_FOUND(삭제와 달리 조용히 성공하지 않는다)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    await expect(
      authed.games.update({ id: 9999, cleared: false, playedDate: null, playedDateWas: null }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("update 도 클리어 상태 검증을 통과해야 한다(수정 경로로 우회 불가)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);
    // 안 깼는데 클리어 날짜 → 거절(isClearedStateValid).
    await expect(
      authed.games.update({
        id: row.id,
        cleared: false,
        clearedDate: "2026-07-20",
        playedDate: null,
        playedDateWas: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 실재하지 않는 날짜 → 거절.
    await expect(
      authed.games.update({
        id: row.id,
        cleared: true,
        clearedDate: "2026-02-31",
        playedDate: null,
        playedDateWas: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("remove 는 game:delete 없으면 FORBIDDEN", async () => {
    const caller = createCaller(makeCtx());
    await expect(caller.games.remove({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  /* ── 플레이 날짜 = 일정 항목 ────────────────────────────────────────────────────
     게임 폼이 날짜를 다루지만 정본은 여전히 schedule_entries 다. 여기서 증명하는 건 그
     "입구"가 정본을 올바르게 건드리는가다. */

  it("add 에 날짜를 주면 일정 항목이 서고 보드 날짜로 유도된다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-22" });
    expect(row.lastPlayed).toBe("2026-07-22");

    // 정본은 games 컬럼이 아니라 일정 항목이다 — 실제로 그 행이 섰는지 본다.
    const db = makeDb(env.DB);
    const entries = await db.select().from(scheduleEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.scheduledDate).toBe("2026-07-22");
    expect(entries[0]!.title).toBe("엘든링"); // NOT NULL 이라 게임 제목을 싣는다
    expect(entries[0]!.startTime).toBeNull(); // 시각은 /schedule 소관
  });

  /* last_insert_rowid() 회귀. **이 가정이 깨지면 항목이 엉뚱한 게임에 붙는 조용한 오염이라**
     타입도 게이트도 못 잡는다 — 게임을 둘 만들어 "두 번째 항목이 두 번째 게임에 붙었나"를
     직접 본다(한 개만 있으면 id 가 우연히 맞아도 통과한다). */
  it("add 의 일정 항목은 방금 넣은 게임에 붙는다(last_insert_rowid)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const first = await authed.games.add({ ...eldenring, playedDate: "2026-07-20" });
    const second = await authed.games.add({
      categoryId: "c2",
      categoryType: "GAME",
      categoryValue: "젤다",
      playedDate: "2026-07-22",
    });
    expect(second.id).not.toBe(first.id);

    const db = makeDb(env.DB);
    const entries = await db.select().from(scheduleEntries);
    const byGame = new Map(entries.map((e) => [e.gameId, e.scheduledDate]));
    expect(byGame.get(first.id)).toBe("2026-07-20");
    expect(byGame.get(second.id)).toBe("2026-07-22");
  });

  it("add 가 실패하면 일정 항목도 안 남는다(한 batch 라 함께 롤백)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    await authed.games.add(eldenring);
    // 같은 category_id 재추가 → UNIQUE 위반. 항목 INSERT 가 앞 문과 한 batch 라 함께 죽는다.
    await expect(
      authed.games.add({ ...eldenring, playedDate: "2026-07-22" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const db = makeDb(env.DB);
    expect(await db.select().from(scheduleEntries)).toEqual([]);
  });

  it("update 로 날짜를 옮기면 항목이 UPDATE 된다 — 시각·제목은 보존", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-20" });

    /* /schedule 에서 시각·제목을 손봐 둔 상태를 만든다. 게임 폼이 날짜만 옮길 때 이게 살아야
       한다 — 지우고 새로 넣으면 "20:00 2회차"가 조용히 사라진다. */
    const db = makeDb(env.DB);
    await db
      .update(scheduleEntries)
      .set({ startTime: "20:00", title: "엘든링 2회차" })
      .where(eq(scheduleEntries.gameId, row.id));

    const moved = await authed.games.update({
      id: row.id,
      cleared: false,
      clearedDate: null,
      playedDate: "2026-07-23",
      playedDateWas: "2026-07-20",
    });
    expect(moved.lastPlayed).toBe("2026-07-23");

    const entries = await db.select().from(scheduleEntries);
    expect(entries).toHaveLength(1); // 새로 만든 게 아니라 옮긴 것
    expect(entries[0]!.scheduledDate).toBe("2026-07-23");
    expect(entries[0]!.startTime).toBe("20:00");
    expect(entries[0]!.title).toBe("엘든링 2회차");
  });

  it("update 에 날짜를 비우면 항목이 지워지지 않고 연결만 풀린다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-20" });
    const cleared = await authed.games.update({
      id: row.id,
      cleared: false,
      clearedDate: null,
      playedDate: null,
      playedDateWas: "2026-07-20",
    });
    expect(cleared.lastPlayed).toBeNull();

    /* 행은 남는다 — "그날 방송이 있었다"는 사실은 이 게임과 독립이다. 게임을 **삭제**해도
       항목이 ON DELETE SET NULL 로 남는데 날짜만 비운 게 더 파괴적이면 앞뒤가 안 맞는다. */
    const entries = await makeDb(env.DB).select().from(scheduleEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.gameId).toBeNull();
    expect(entries[0]!.scheduledDate).toBe("2026-07-20");
    // 연결이 풀렸으니 편집 조회에도 더는 안 잡힌다(그 게임의 항목이 아니다).
    expect(await authed.games.playDates({ id: row.id })).toEqual([]);
  });

  /* 적대적 리뷰가 지목한 최악의 경로: /schedule 에서 시각·자유 제목까지 짜 둔 항목을 게임
     폼에서 날짜만 비웠을 때. 게임 폼이 만든 행인지 일정에서 짠 행인지 구분할 표식이 없으므로,
     지우는 순간 어느 쪽이든 날아간다 — 그래서 아예 안 지운다. */
  it("일정에서 짠 항목(시각·자유 제목)도 날짜를 비워 잃지 않는다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-20" });
    const db = makeDb(env.DB);
    await db
      .update(scheduleEntries)
      .set({ startTime: "20:00", title: "엘든링 2회차 · 마지막 보스" })
      .where(eq(scheduleEntries.gameId, row.id));

    await authed.games.update({
      id: row.id,
      cleared: false,
      clearedDate: null,
      playedDate: null,
      playedDateWas: "2026-07-20",
    });

    const entries = await db.select().from(scheduleEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.startTime).toBe("20:00");
    expect(entries[0]!.title).toBe("엘든링 2회차 · 마지막 보스");
    expect(entries[0]!.gameId).toBeNull();
  });

  it("update 는 날짜 없던 게임에 항목을 새로 만든다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring); // 날짜 없이 추가
    const dated = await authed.games.update({
      id: row.id,
      cleared: false,
      clearedDate: null,
      playedDate: "2026-07-22",
      playedDateWas: null,
    });
    expect(dated.lastPlayed).toBe("2026-07-22");
    const entries = await makeDb(env.DB).select().from(scheduleEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.gameId).toBe(row.id);
  });

  it("여러 날 편성이면 날짜 변경을 거절한다(폼 잠금의 서버 짝)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-20" });
    const db = makeDb(env.DB);
    // /schedule 에서 둘째 날을 더한 상태("월·화 젤다").
    await db
      .insert(scheduleEntries)
      .values({ scheduledDate: "2026-07-21", title: "엘든링", gameId: row.id });

    await expect(
      authed.games.update({
        id: row.id,
        cleared: false,
        clearedDate: null,
        playedDate: "2026-07-25",
        playedDateWas: "2026-07-20",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // null(지우기)도 막는다 — 여러 날을 한 입력으로 지우는 건 폼이 표현하지 못한 의도다.
    await expect(
      authed.games.update({
        id: row.id,
        cleared: false,
        clearedDate: null,
        playedDate: null,
        playedDateWas: "2026-07-20",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // 거절된 저장은 일정을 안 건드렸다.
    const dates = (await db.select().from(scheduleEntries)).map((e) => e.scheduledDate).sort();
    expect(dates).toEqual(["2026-07-20", "2026-07-21"]);
  });

  /* 잠긴 폼의 정상 저장 = playedDate 를 **아예 안 싣는다**. 초판은 "기존 날짜를 되보내면 통과"
     였는데, 잠긴 폼엔 되보낼 값이 하나로 정해지지 않아(날짜가 여럿이다) 실제로는 빈 값이
     나갔고 그게 삭제 시도로 거절돼 **클리어 수정이 통째로 막혔다**(codex 리뷰). 서버 규약만
     테스트하고 폼이 보내는 값을 안 봐서 놓친 자리라, e2e 가 실제 페이로드를 따로 지킨다. */
  it("여러 날이어도 playedDate 를 안 실으면 클리어만 고칠 수 있다(잠긴 폼의 정상 저장)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-20" });
    const db = makeDb(env.DB);
    await db
      .insert(scheduleEntries)
      .values({ scheduledDate: "2026-07-21", title: "엘든링", gameId: row.id });

    const done = await authed.games.update({
      id: row.id,
      cleared: true,
      clearedDate: "2026-07-21",
      // playedDate 없음 = 일정을 안 건드린다.
    });
    expect(done.cleared).toBe(true);

    /* 통과했다고 항목을 건드리면 안 된다 — 필드가 없는데 entries[0] 를 UPDATE/DELETE 하면
       "클리어만 고치는" 저장이 가장 이른 날을 조용히 옮기거나 지운다. 두 날이 그대로여야 한다. */
    const dates = (await db.select().from(scheduleEntries)).map((e) => e.scheduledDate).sort();
    expect(dates).toEqual(["2026-07-20", "2026-07-21"]);
  });

  /* 항목이 하나인 게임도 같은 규약을 따른다 — 필드가 없으면 안 건드린다. 이게 안 서면 잠기지
     않은 폼이 클리어만 고치려 할 때(값을 안 실었을 때) 멀쩡한 날짜가 지워진다. */
  it("항목이 하나여도 playedDate 를 안 실으면 그 항목이 그대로 남는다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-20" });
    const done = await authed.games.update({ id: row.id, cleared: true, clearedDate: null });
    expect(done.cleared).toBe(true);
    expect(done.lastPlayed).toBe("2026-07-20");
    expect(await authed.games.playDates({ id: row.id })).toEqual(["2026-07-20"]);
  });

  it("playDates 는 game:write 를 요구한다(초안 주의 날짜라 공개 아님)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-20" });
    await expect(createCaller(makeCtx()).games.playDates({ id: row.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await authed.games.playDates({ id: row.id })).toEqual(["2026-07-20"]);
  });

  /* 발행 경계와의 관계. 보드 표시(lastPlayed)는 발행된 항목만 세지만, 편집용 playDates 는
     초안까지 센다 — 안 그러면 폼이 "0개"로 보고 새로 만들어 발행 순간 날짜가 둘이 된다. */
  it("초안 주의 항목은 보드에 안 뜨지만 편집 조회엔 잡힌다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-22" });
    expect(row.lastPlayed).toBe("2026-07-22"); // 게임 폼이 청구한 주는 발행된 채 선다

    /* 관리자가 /schedule 에서 그 주의 발행을 내린 상태를 만든다 — claimWeek 이 이미 메타를
       만들어 뒀으므로 INSERT 가 아니라 UPDATE 다. 초안으로 내려가면 그 주 항목은 보드에서 빠진다. */
    const db = makeDb(env.DB);
    await db
      .update(scheduleWeeks)
      .set({ publishedAt: null })
      .where(eq(scheduleWeeks.weekStartDate, "2026-07-20"));

    const [listed] = await createCaller(makeCtx()).games.list();
    expect(listed!.lastPlayed).toBeNull(); // 보드에선 숨는다
    expect(await authed.games.playDates({ id: row.id })).toEqual(["2026-07-22"]); // 편집엔 보인다
  });

  /* ── 게임 폼이 메타 없는 주를 청구한다 ────────────────────────────────────────────
     대가를 알고 고른 동작이다(claimWeek 주석): 그 주가 /schedule 에 뜬다. 대신 stale 편집기가
     그 항목을 조용히 지우는 손실 경로가 닫힌다. 항목 자체는 이미 보드에 공개돼 있었으므로
     새 정보가 새는 게 아니고, saveWeek 도 레거시 주를 저장하면 같은 일을 한다. */
  it("게임 폼이 날짜를 넣으면 그 주를 발행된 채로 청구한다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    await authed.games.add({ ...eldenring, playedDate: "2026-07-22" });

    const week = await getPublishedWeek(makeDb(env.DB), "2026-07-20");
    expect(week).not.toBeNull();
    expect(week!.entries).toHaveLength(1);
    // revision 이 생겼다 = 편집기의 CAS 가 이 쓰기를 볼 수 있다.
    expect(week!.publishedAt).not.toBeNull();
  });

  /* **초안 주는 안 건드린다** — 관리자가 짜는 중인 편성이 먼저 새지 않는다는 결정 13 의 핵심.
     청구는 UPDATE 경로라 published_at 을 그대로 둔다. */
  it("초안 주에 날짜를 넣어도 발행되지 않는다(결정 13)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);
    // 편집기가 그 주를 **초안**으로 세운다.
    await authed.schedule.saveWeek({
      weekStartDate: "2026-07-20",
      revision: null,
      published: false,
      entries: [],
    });

    await authed.games.update({
      id: row.id,
      cleared: false,
      clearedDate: null,
      playedDate: "2026-07-22",
      playedDateWas: null,
    });

    // 여전히 초안이라 공개되지 않는다 — 보드에도 안 뜬다.
    expect(await getPublishedWeek(makeDb(env.DB), "2026-07-20")).toBeNull();
    const [listed] = await createCaller(makeCtx()).games.list();
    expect(listed!.lastPlayed).toBeNull();
  });

  it("이미 발행된 주는 게임 폼이 건드려도 발행 상태가 유지된다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);
    // 편집기가 그 주를 발행 상태로 세운다.
    await authed.schedule.saveWeek({
      weekStartDate: "2026-07-20",
      revision: null,
      published: true,
      entries: [],
    });

    await authed.games.update({
      id: row.id,
      cleared: false,
      clearedDate: null,
      playedDate: "2026-07-22",
      playedDateWas: null,
    });

    const published = await getPublishedWeek(makeDb(env.DB), "2026-07-20");
    expect(published).not.toBeNull();
    expect(published!.entries).toHaveLength(1); // 게임 폼이 넣은 항목이 그 주에 선다
  });

  /* ── 편집기의 낙관적 동시성 ────────────────────────────────────────────────────────
     saveWeek 은 그 주를 **통째로 교체**하면서 revision CAS 로 "그 사이 바뀌었으면 거절"을
     보장한다. 게임 폼이 그 계약 밖에서 쓰면 열어 둔 편집기가 stale 인 채 CAS 를 통과해 방금
     넣은 날짜를 지운다 — 사용자에겐 "분명 넣었는데 사라졌다"로만 보인다(적대적 리뷰 3라운드).
     그래서 **메타가 있는 주는** 게임 폼의 쓰기도 revision 을 올린다(claimWeek). */
  it("메타 있는 주: 게임 폼이 날짜를 옮기면 stale 편집기 저장이 CONFLICT 로 막힌다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-22" });
    // 편집기가 그 주를 연다 — 게임 폼의 청구로 메타가 이미 서 있어 revision 이 있다.
    const opened = await authed.schedule.getWeek({ weekStartDate: "2026-07-20" });
    expect(opened.revision).not.toBeNull();

    // 그 사이 게임 폼이 **같은 주 안에서** 날짜를 옮긴다.
    await authed.games.update({
      id: row.id,
      cleared: false,
      clearedDate: null,
      playedDate: "2026-07-23",
      playedDateWas: "2026-07-22",
    });

    await expect(
      authed.schedule.saveWeek({
        weekStartDate: "2026-07-20",
        revision: opened.revision,
        entries: [],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  /* 거짓 충돌을 안 만든다. 항목이 하나인 게임은 폼이 그 날짜를 입력에 채워 두므로 클리어만
     고친 저장도 같은 값을 실어 온다 — 그걸 일정 변경으로 취급하면 revision 이 올라가 열어 둔
     편집기가 **원인 없는 CONFLICT** 를 받는다. revision 은 파괴적 전체 교체를 막는 마지막
     방어선이라 거짓 경보가 섞이면 진짜 경합의 신호가 흐려진다(적대적 리뷰 5라운드). */
  it("날짜가 그대로면 주 revision 을 안 올린다 — 클리어만 고친 저장", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-22" });
    const opened = await authed.schedule.getWeek({ weekStartDate: "2026-07-20" });

    // 폼이 하는 그대로 — 같은 날짜를 되실어 클리어만 켠다.
    await authed.games.update({
      id: row.id,
      cleared: true,
      clearedDate: null,
      playedDate: "2026-07-22",
      playedDateWas: "2026-07-22",
    });

    // revision 이 그대로라 열어 둔 편집기가 계속 저장할 수 있다.
    const after = await authed.schedule.getWeek({ weekStartDate: "2026-07-20" });
    expect(after.revision).toBe(opened.revision);
    await authed.schedule.saveWeek({
      weekStartDate: "2026-07-20",
      revision: opened.revision,
      published: true,
      entries: [{ scheduledDate: "2026-07-22", title: "엘든링", gameId: row.id }],
    });
  });

  /* ── 폼이 열린 뒤 일정이 딴 데서 바뀌면 덮어쓰지 않는다 ──────────────────────────────
     폼은 열릴 때 날짜를 로컬 상태로 읽는다. 그 사이 다른 관리자가 그 항목을 옮기면, 그 stale
     한 값을 그대로 쓰는 순간 **남의 일정 작업이 조용히 되돌아간다**(적대적 리뷰 6라운드).
     precondition(playedDateWas)이 그걸 CONFLICT 로 막는다 — saveWeek 의 revision 과 같은 결. */
  it("폼이 읽은 날짜가 낡았으면 CONFLICT — 남의 일정 변경을 되돌리지 않는다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-22" });

    // 폼이 2026-07-22 를 읽고 열린 사이, 다른 관리자가 그 항목을 옮긴다.
    await makeDb(env.DB)
      .update(scheduleEntries)
      .set({ scheduledDate: "2026-07-25" })
      .where(eq(scheduleEntries.gameId, row.id));

    await expect(
      authed.games.update({
        id: row.id,
        cleared: true,
        clearedDate: null,
        playedDate: "2026-07-22",
        playedDateWas: "2026-07-22", // 폼이 열릴 때 읽은 값 — 이제 낡았다
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 거절됐으니 남의 변경이 그대로 살아 있다.
    expect(await authed.games.playDates({ id: row.id })).toEqual(["2026-07-25"]);
  });

  it("항목이 사라진 뒤의 저장도 CONFLICT — was 가 null 이 아닌데 지금은 없다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-22" });
    // 다른 관리자가 그 항목의 게임 연결을 풀었다.
    await makeDb(env.DB)
      .update(scheduleEntries)
      .set({ gameId: null })
      .where(eq(scheduleEntries.gameId, row.id));

    await expect(
      authed.games.update({
        id: row.id,
        cleared: false,
        clearedDate: null,
        playedDate: "2026-07-23",
        playedDateWas: "2026-07-22",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  /* 날짜를 다른 주로 옮기면 주가 둘이다 — 옛 주와 새 주. 한쪽만 올리면 다른 쪽 편집기가
     그대로 통과해 지운다. 둘 다 메타가 있는 경우로 세워 그걸 본다. */
  it("주를 건너뛰어 옮기면 옛 주·새 주 편집기가 둘 다 CONFLICT 로 막힌다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-22" });
    /* 셋업이 없다. 옛 주는 add 가 청구해 revision 이 서 있고, 새 주는 아래 이동이 청구한다 —
       그 순간 메타가 생겨 revision=null 로 열어 둔 편집기의 청구가 0행이 된다. */
    const oldWeek = await authed.schedule.getWeek({ weekStartDate: "2026-07-20" });
    const newWeek = await authed.schedule.getWeek({ weekStartDate: "2026-07-27" });

    // 다음 주로 옮긴다.
    await authed.games.update({
      id: row.id,
      cleared: false,
      clearedDate: null,
      playedDate: "2026-07-29",
      playedDateWas: "2026-07-22",
    });

    for (const [label, week] of [
      ["옛 주", oldWeek],
      ["새 주", newWeek],
    ] as const) {
      await expect(
        authed.schedule.saveWeek({
          weekStartDate: week.weekStartDate,
          revision: week.revision,
          entries: [],
        }),
        label,
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
  });

  /* **메타 없는 주도 보호된다.** 한때 이 자리에 "못 막는다(알고 수용한 한계)"가 있었다 —
     claimWeek 이 메타를 안 만들던 시절이라 올릴 revision 이 없었고, 그래서 관리자가 방금 넣은
     날짜가 stale 편집기 저장에 조용히 지워졌다. 그 수용은 "main 에도 있던 한계"라는 **틀린
     근거** 위에 있었다: main 의 saveWeek 은 revision=null 청구로 메타를 만들어 편집기끼리는
     서로를 막았고, 보호 밖에 있던 건 게임 폼이라는 새 경로뿐이었다(적대적 리뷰 8라운드가
     "knowingly leaves a data-loss path"로 되짚었다). 근거를 바로잡고 청구하는 쪽으로 돌렸다. */
  it("메타 없던 주도 stale 편집기 저장을 CONFLICT 로 막는다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const opened = await authed.schedule.getWeek({ weekStartDate: "2026-07-20" });
    expect(opened.revision).toBeNull();

    const row = await authed.games.add({ ...eldenring, playedDate: "2026-07-22" });

    // 게임 폼이 그 주를 청구했으므로 stale 편집기의 null 청구가 0행이 돼 거절된다.
    await expect(
      authed.schedule.saveWeek({
        weekStartDate: "2026-07-20",
        revision: opened.revision,
        entries: [],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // 거절됐으니 관리자가 넣은 날짜가 살아 있다.
    expect(await authed.games.playDates({ id: row.id })).toEqual(["2026-07-22"]);
  });

  it("remove 는 game:delete 있으면 하드 삭제, 없는 id 는 deleted:false", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);
    expect(await authed.games.remove({ id: row.id })).toEqual({ deleted: true });
    expect(await createCaller(makeCtx()).games.list()).toEqual([]);
    expect(await authed.games.remove({ id: 9999 })).toEqual({ deleted: false });
  });
});
