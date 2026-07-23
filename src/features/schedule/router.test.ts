import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { makeDb } from "@/db";
import { createCallerFactory } from "@/features/trpc/init";
import { appRouter } from "@/features/router";
import type { Context } from "@/features/trpc/init";

/* 일정 라우터 — 주 단위 일괄 저장(전체 교체)의 서버 권위·불변식을 caller 로 직접 증명한다.
   각 it 은 격리 저장소라 마이그레이션된 빈 스키마에서 시작한다(setupFiles). */

const createCaller = createCallerFactory(appRouter);
const admin = authoritiesFor(["admin"]); // schedule:write + game:write 포함

function makeCtx(over: { authorities?: ReadonlySet<Authority> } = {}): Context {
  const authorities = over.authorities ?? new Set<Authority>();
  return { db: makeDb(env.DB), actor: null, chzzk: null, authoritiesOf: async () => authorities };
}

// 2026-07-20 은 월요일 — 주의 시작. 이 주의 7일은 07-20..07-26.
const MON = "2026-07-20";

describe("일정 라우터", () => {
  it("getWeek·saveWeek 은 schedule:write 없으면 FORBIDDEN(서버 권위)", async () => {
    const caller = createCaller(makeCtx()); // member = 빈 권한
    await expect(caller.schedule.getWeek({ weekStartDate: MON })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.schedule.saveWeek({ weekStartDate: MON, entries: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getWeek 은 빈 주를 초안(발행 안 됨)으로 준다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week).toEqual({ weekStartDate: MON, note: null, publishedAt: null, entries: [] });
  });

  it("saveWeek 은 그 주를 저장하고 getWeek 이 되읽는다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await caller.schedule.saveWeek({
      weekStartDate: MON,
      note: "이번 주는 젤다 위주",
      entries: [
        { scheduledDate: "2026-07-20", startTime: "20:00", title: "젤다" },
        { scheduledDate: "2026-07-22", startTime: null, title: "저챗" },
      ],
    });
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.note).toBe("이번 주는 젤다 위주");
    expect(week.entries.map((e) => e.title)).toEqual(["젤다", "저챗"]);
    expect(week.entries[0]!.startTime).toBe("20:00");
    expect(week.entries[1]!.startTime).toBeNull();
  });

  it("하루 안에서는 시각 있는 항목이 먼저, 시각 없는 항목은 끝으로", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await caller.schedule.saveWeek({
      weekStartDate: MON,
      entries: [
        { scheduledDate: "2026-07-20", startTime: null, title: "미정" },
        { scheduledDate: "2026-07-20", startTime: "20:00", title: "밤 게임" },
        { scheduledDate: "2026-07-20", startTime: "14:00", title: "오후 저챗" },
      ],
    });
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.entries.map((e) => e.title)).toEqual(["오후 저챗", "밤 게임", "미정"]);
  });

  it("일괄 저장은 그 주를 전체 교체한다 — 뺀 항목은 사라진다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await caller.schedule.saveWeek({
      weekStartDate: MON,
      entries: [
        { scheduledDate: "2026-07-20", title: "A" },
        { scheduledDate: "2026-07-21", title: "B" },
      ],
    });
    // 다시 저장하며 B 를 뺀다 — 전체 교체라 B 는 사라지고 C 가 생긴다.
    await caller.schedule.saveWeek({
      weekStartDate: MON,
      entries: [
        { scheduledDate: "2026-07-20", title: "A" },
        { scheduledDate: "2026-07-22", title: "C" },
      ],
    });
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.entries.map((e) => e.title)).toEqual(["A", "C"]);
  });

  it("전체 교체는 그 주만 건드린다 — 다른 주의 항목은 남는다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const nextMon = "2026-07-27";
    await caller.schedule.saveWeek({
      weekStartDate: nextMon,
      entries: [{ scheduledDate: "2026-07-28", title: "다음 주 항목" }],
    });
    // MON 주를 저장(교체)해도 다음 주는 그대로여야 한다.
    await caller.schedule.saveWeek({
      weekStartDate: MON,
      entries: [{ scheduledDate: "2026-07-20", title: "이번 주 항목" }],
    });
    const next = await caller.schedule.getWeek({ weekStartDate: nextMon });
    expect(next.entries.map((e) => e.title)).toEqual(["다음 주 항목"]);
  });

  it("발행 시각은 처음 발행 때만 찍고 재저장엔 유지, 내리면 null", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const first = await caller.schedule.saveWeek({
      weekStartDate: MON,
      published: true,
      entries: [],
    });
    expect(typeof first.publishedAt).toBe("number");
    // 재저장(계속 발행)엔 발행 시각이 안 바뀐다.
    const again = await caller.schedule.saveWeek({
      weekStartDate: MON,
      published: true,
      entries: [],
    });
    expect(again.publishedAt).toBe(first.publishedAt);
    // 발행을 내리면 초안으로 되돌아간다.
    const draft = await caller.schedule.saveWeek({
      weekStartDate: MON,
      published: false,
      entries: [],
    });
    expect(draft.publishedAt).toBeNull();
  });

  it("weekStartDate 가 월요일이 아니면 거절(주는 날짜에서 유도한다)", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    // 2026-07-21 은 화요일.
    await expect(
      caller.schedule.saveWeek({ weekStartDate: "2026-07-21", entries: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.schedule.getWeek({ weekStartDate: "2026-07-21" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("그 주에 속하지 않는 항목 날짜는 거절", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await expect(
      caller.schedule.saveWeek({
        weekStartDate: MON,
        entries: [{ scheduledDate: "2026-07-27", title: "다음 주로 샌 항목" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("없는 게임을 가리키면 FK 위반을 BAD_REQUEST 로 바꾼다(배치 전체 롤백)", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await expect(
      caller.schedule.saveWeek({
        weekStartDate: MON,
        entries: [{ scheduledDate: "2026-07-20", title: "유령 게임", gameId: 9999 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 롤백됐으면 주도 안 남는다(배치 원자성).
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.entries).toEqual([]);
  });

  it("게임에 이어 붙인 항목이 보드의 플레이 날짜를 유도한다(No-ship 이 닫는 지점)", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const game = await caller.games.add({
      categoryId: "c-zelda",
      categoryType: "GAME",
      categoryValue: "젤다",
    });
    // 추가 직후엔 일정이 없어 날짜가 없다.
    expect(game.lastPlayed).toBeNull();
    // 일정에 그 게임을 07-20 에 붙이면 보드가 그 날짜를 되유도한다.
    await caller.schedule.saveWeek({
      weekStartDate: MON,
      entries: [{ scheduledDate: "2026-07-20", title: "젤다", gameId: game.id }],
    });
    const [card] = await createCaller(makeCtx()).games.list();
    expect(card!.id).toBe(game.id);
    expect(card!.lastPlayed).toBe("2026-07-20");
  });
});
