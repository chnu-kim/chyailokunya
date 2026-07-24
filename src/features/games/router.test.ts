import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { makeDb, scheduleEntries } from "@/db";
import { createCallerFactory } from "@/features/trpc/init";
import { appRouter } from "@/features/router";
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
    });
    expect(done.cleared).toBe(true);
    expect(done.clearedDate).toBe("2026-07-20");

    // cleared=false 로 보내면 클리어가 풀린다(부분 patch 가 아니라 전체 치환). 날짜도 함께 빠진다.
    const undone = await authed.games.update({ id: row.id, cleared: false });
    expect(undone.cleared).toBe(false);
    expect(undone.clearedDate).toBeNull();
  });

  it("update 는 '깼는데 날짜 모름'을 받는다(cleared=true·date 없음)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);
    const done = await authed.games.update({ id: row.id, cleared: true });
    expect(done.cleared).toBe(true);
    expect(done.clearedDate).toBeNull();
  });

  it("update 는 없는 id 면 NOT_FOUND(삭제와 달리 조용히 성공하지 않는다)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    await expect(authed.games.update({ id: 9999, cleared: false })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("update 도 클리어 상태 검증을 통과해야 한다(수정 경로로 우회 불가)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);
    // 안 깼는데 클리어 날짜 → 거절(isClearedStateValid).
    await expect(
      authed.games.update({ id: row.id, cleared: false, clearedDate: "2026-07-20" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 실재하지 않는 날짜 → 거절.
    await expect(
      authed.games.update({ id: row.id, cleared: true, clearedDate: "2026-02-31" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("remove 는 game:delete 없으면 FORBIDDEN", async () => {
    const caller = createCaller(makeCtx());
    await expect(caller.games.remove({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("remove 는 game:delete 있으면 하드 삭제, 없는 id 는 deleted:false", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);
    expect(await authed.games.remove({ id: row.id })).toEqual({ deleted: true });
    expect(await createCaller(makeCtx()).games.list()).toEqual([]);
    expect(await authed.games.remove({ id: 9999 })).toEqual({ deleted: false });
  });
});
