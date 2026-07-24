import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { makeDb, scheduleEntries } from "@/db";
import { createCallerFactory } from "@/features/trpc/init";
import { appRouter } from "@/features/router";
import type { Context } from "@/features/trpc/init";
import { getPublishedWeek, nextRevision } from "./service";

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

type Caller = ReturnType<typeof createCaller>;
type SaveInput = Parameters<Caller["schedule"]["saveWeek"]>[0];

/* 편집기가 하는 일 그대로 — 그 주를 불러와 revision 을 얻고 그걸로 저장한다. saveWeek 이
   낙관적 동시성 토큰을 요구하게 된 뒤로 대부분의 테스트는 "경합 없는 정상 경로"를 원하므로
   여기로 몬다(경합 자체는 전용 테스트가 revision 을 손으로 어긋내 본다).
   getWeek 이 schedule:write 를 요구하므로 **권한 있는 caller 로만** 쓴다. */
async function saveWeekAsEditor(caller: Caller, input: Omit<SaveInput, "revision">) {
  const { revision } = await caller.schedule.getWeek({ weekStartDate: input.weekStartDate });
  return caller.schedule.saveWeek({ ...input, revision });
}

describe("nextRevision — CAS 토큰은 단조 증가", () => {
  it("now 가 크면 now, 아니면 old+1 로 무조건 커진다(같은 ms·시계 역행 방어)", () => {
    expect(nextRevision(1000, 2000)).toBe(2000); // 정상: 벽시계 전진
    expect(nextRevision(1000, 1000)).toBe(1001); // 같은 ms 충돌: 그래도 값이 바뀐다
    expect(nextRevision(5000, 3000)).toBe(5001); // 시계 역행: 여전히 strictly greater
    // 어느 경우든 결과가 입력보다 크다 = stale revision 이 다음 CAS 를 못 통과한다.
    expect(nextRevision(1000, 1000)).toBeGreaterThan(1000);
    expect(nextRevision(5000, 3000)).toBeGreaterThan(5000);
  });
});

describe("일정 라우터", () => {
  it("getWeek·saveWeek 은 schedule:write 없으면 FORBIDDEN(서버 권위)", async () => {
    const caller = createCaller(makeCtx()); // member = 빈 권한
    await expect(caller.schedule.getWeek({ weekStartDate: MON })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.schedule.saveWeek({ weekStartDate: MON, revision: null, entries: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getWeek 은 빈 주를 초안(발행 안 됨)으로 준다 — 메타 행도 아직 없다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week).toEqual({
      weekStartDate: MON,
      note: null,
      publishedAt: null,
      hasMeta: false,
      revision: null,
      entries: [],
    });
  });

  it("saveWeek 은 그 주를 저장하고 getWeek 이 되읽는다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await saveWeekAsEditor(caller, {
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
    await saveWeekAsEditor(caller, {
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
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      entries: [
        { scheduledDate: "2026-07-20", title: "A" },
        { scheduledDate: "2026-07-21", title: "B" },
      ],
    });
    // 다시 저장하며 B 를 뺀다 — 전체 교체라 B 는 사라지고 C 가 생긴다.
    await saveWeekAsEditor(caller, {
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
    await saveWeekAsEditor(caller, {
      weekStartDate: nextMon,
      entries: [{ scheduledDate: "2026-07-28", title: "다음 주 항목" }],
    });
    // MON 주를 저장(교체)해도 다음 주는 그대로여야 한다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      entries: [{ scheduledDate: "2026-07-20", title: "이번 주 항목" }],
    });
    const next = await caller.schedule.getWeek({ weekStartDate: nextMon });
    expect(next.entries.map((e) => e.title)).toEqual(["다음 주 항목"]);
  });

  it("발행 시각은 처음 발행 때만 찍고 재저장엔 유지, 내리면 null", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const first = await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      published: true,
      entries: [],
    });
    expect(typeof first.publishedAt).toBe("number");
    // 재저장(계속 발행)엔 발행 시각이 안 바뀐다.
    const again = await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      published: true,
      entries: [],
    });
    expect(again.publishedAt).toBe(first.publishedAt);
    // 발행을 내리면 초안으로 되돌아간다.
    const draft = await saveWeekAsEditor(caller, {
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
      caller.schedule.saveWeek({ weekStartDate: "2026-07-21", revision: null, entries: [] }),
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
        revision: null,
        entries: [{ scheduledDate: "2026-07-27", title: "다음 주로 샌 항목" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("없는 게임을 가리키면 BAD_REQUEST — 메타를 만들기 전에 prevalidate 가 막는다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await expect(
      caller.schedule.saveWeek({
        weekStartDate: MON,
        revision: null,
        entries: [{ scheduledDate: "2026-07-20", title: "유령 게임", gameId: 9999 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 막혔으면 주 메타도 안 생긴다 — prevalidate 가 청구 이전에 걸러 아무것도 안 썼다.
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.hasMeta).toBe(false);
    expect(week.entries).toEqual([]);
  });

  it("저장이 실패해도(없는 게임) 이미 발행된 주의 메타는 한 글자도 안 바뀐다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const game = await authed.games.add({
      categoryId: "c-real",
      categoryType: "GAME",
      categoryValue: "젤다",
    });
    // 발행된 주를 세운다(공지·발행 시각·revision 이 다 박힌다).
    const before = await saveWeekAsEditor(authed, {
      weekStartDate: MON,
      note: "지켜야 할 공지",
      published: true,
      entries: [{ scheduledDate: "2026-07-20", title: "젤다", gameId: game.id }],
    });
    expect(before.publishedAt).not.toBeNull();

    /* 그 주를 다시 저장하는데 없는 게임을 섞는다 — publishedAt 은 공개 가시성·보드 날짜를
       지배하므로(ADR-0022), 실패가 메타를 건드리면 "실패했다는데 발행 상태가 바뀐" 결과가 된다.
       prevalidate 가 메타 청구 이전에 막아 그 주의 메타가 그대로여야 한다. */
    await expect(
      authed.schedule.saveWeek({
        weekStartDate: MON,
        revision: before.revision,
        note: "덮어써지면 안 되는 새 공지",
        published: false,
        entries: [
          { scheduledDate: "2026-07-20", title: "젤다", gameId: game.id },
          { scheduledDate: "2026-07-21", title: "유령", gameId: 9999 },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const after = await authed.schedule.getWeek({ weekStartDate: MON });
    expect(after.note).toBe("지켜야 할 공지"); // 공지 안 바뀜
    expect(after.publishedAt).toBe(before.publishedAt); // 발행 시각 안 바뀜(내려가지도 않음)
    expect(after.revision).toBe(before.revision); // revision 안 바뀜(다음 정상 저장이 안 막힘)
    expect(after.entries.map((e) => e.title)).toEqual(["젤다"]); // 항목도 그대로
  });

  it("stale revision 으로 저장하면 CONFLICT — 남의 항목을 덮어쓰지 않는다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    // 관리자 A 가 주를 연다(이 시점의 revision 을 손에 쥔다).
    const opened = await caller.schedule.getWeek({ weekStartDate: MON });

    // 그 사이 관리자 B 가 먼저 저장한다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      entries: [{ scheduledDate: "2026-07-20", title: "B 가 넣은 항목" }],
    });

    /* A 가 자기 초안을 저장한다 — 전체 교체라 그대로 통과시키면 B 의 항목이 **통째로 사라진다**.
       불러온 시점의 revision 이 지금과 달라 CONFLICT 로 거절돼야 한다. */
    await expect(
      caller.schedule.saveWeek({
        weekStartDate: MON,
        revision: opened.revision,
        entries: [{ scheduledDate: "2026-07-21", title: "A 가 넣은 항목" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 거절됐으면 B 의 저장이 그대로 남아 있어야 한다(A 가 아무것도 못 지웠다).
    const after = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(after.entries.map((e) => e.title)).toEqual(["B 가 넣은 항목"]);

    // 새로고침해 최신 revision 을 다시 잡으면 정상 저장된다(막힌 게 아니라 덮어쓰기만 막혔다).
    const reopened = await caller.schedule.getWeek({ weekStartDate: MON });
    const ok = await caller.schedule.saveWeek({
      weekStartDate: MON,
      revision: reopened.revision,
      entries: [{ scheduledDate: "2026-07-21", title: "A 가 다시 넣은 항목" }],
    });
    expect(ok.entries.map((e) => e.title)).toEqual(["A 가 다시 넣은 항목"]);
  });

  it("같은 revision 으로 **동시에** 저장하면 하나만 통과한다(검사가 쓰기 조건이라서)", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    // 둘 다 같은 시점의 주를 열었다(= 같은 revision 을 쥔다). 아직 메타가 없어 null.
    const opened = await caller.schedule.getWeek({ weekStartDate: MON });

    /* 두 저장을 **동시에** 띄운다. 읽고→비교하고→쓰는 방식이면 둘 다 같은 revision 을 읽고
       통과해 나중 것이 앞의 것을 통째로 지운다 — 이 테스트가 그 창을 겨냥한다. 조건부 청구면
       정확히 하나만 매치하고 진 쪽은 항목을 건드리기 전에 CONFLICT 로 멈춘다. */
    const results = await Promise.allSettled([
      caller.schedule.saveWeek({
        weekStartDate: MON,
        revision: opened.revision,
        entries: [{ scheduledDate: "2026-07-20", title: "A" }],
      }),
      caller.schedule.saveWeek({
        weekStartDate: MON,
        revision: opened.revision,
        entries: [{ scheduledDate: "2026-07-21", title: "B" }],
      }),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.status === "rejected" && failed[0]!.reason).toMatchObject({
      code: "CONFLICT",
    });

    // 이긴 쪽의 항목만 남는다 — 진 쪽이 아무것도 지우지 못했다.
    const after = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(after.entries).toHaveLength(1);
    const winner = ok[0]!.status === "fulfilled" ? ok[0]!.value : null;
    expect(after.entries[0]!.title).toBe(winner!.entries[0]!.title);
  });

  it("이관된 레거시 주(메타 없음)를 편집기 기본값대로 저장해도 보드 날짜가 안 사라진다", async () => {
    const db = makeDb(env.DB);
    const authed = createCaller(makeCtx({ authorities: admin }));
    const game = await authed.games.add({
      categoryId: "c-legacy",
      categoryType: "GAME",
      categoryValue: "엘든링",
    });
    /* 마이그레이션 0007 이 만드는 모양 그대로: 항목만 있고 schedule_weeks 메타는 없다.
       이 상태에서 보드는 발행 경계의 "메타 없음 = 레거시" 갈래로 날짜를 센다(ADR-0022). */
    await db.insert(scheduleEntries).values({
      scheduledDate: "2026-07-22",
      title: "엘든링",
      gameId: game.id,
    });
    expect((await createCaller(makeCtx()).games.list())[0]!.lastPlayed).toBe("2026-07-22");

    // 편집기가 이 주를 연다 — 메타가 없으므로 hasMeta 로 그걸 알 수 있어야 한다.
    const loaded = await authed.schedule.getWeek({ weekStartDate: MON });
    expect(loaded.hasMeta).toBe(false);
    expect(loaded.publishedAt).toBeNull();

    /* 편집기의 발행 기본값은 `publishedAt !== null || !hasMeta` 다 — 레거시 주는 "이미 공개 중"
       으로 열린다. 그 기본값 그대로 저장했을 때 날짜가 살아 있어야 한다. hasMeta 를 안 보고
       published:false 로 저장하면 published_at NULL 인 메타가 생겨 **여기서 날짜가 사라진다**
       (이관이 지킨 "손실 0"이 첫 편집에서 깨지는 경로 — 이 테스트가 그 회귀를 막는다). */
    const published = loaded.publishedAt !== null || !loaded.hasMeta;
    await saveWeekAsEditor(authed, {
      weekStartDate: MON,
      note: loaded.note,
      published,
      entries: loaded.entries.map((e) => ({
        scheduledDate: e.scheduledDate,
        startTime: e.startTime,
        title: e.title,
        gameId: e.gameId,
      })),
    });
    expect((await createCaller(makeCtx()).games.list())[0]!.lastPlayed).toBe("2026-07-22");
  });

  it("공개 읽기(getPublishedWeek)는 발행된 주만 준다 — 초안은 null(공개 화면이 안 샌다)", async () => {
    const db = makeDb(env.DB);
    const caller = createCaller(makeCtx({ authorities: admin }));
    // 초안으로 저장 — 편집자는 getWeek 으로 보지만 공개 읽기엔 안 뜬다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      note: "짜는 중",
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
    });
    expect(await getPublishedWeek(db, MON)).toBeNull();
    // 발행하면 공개 읽기가 그 주를 준다(전체 교체라 편집기처럼 note 도 함께 다시 보낸다).
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      note: "짜는 중",
      published: true,
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
    });
    const published = await getPublishedWeek(db, MON);
    expect(published?.note).toBe("짜는 중");
    expect(published?.entries.map((e) => e.title)).toEqual(["젤다"]);
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
    // 일정에 그 게임을 07-20 에 붙이고 **발행**하면 보드가 그 날짜를 되유도한다. 발행이 곧
    // 공개 경계라, 초안으로만 저장하면 아직 보드에 안 뜬다(ADR-0022, games 라우터 테스트가 증명).
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      published: true,
      entries: [{ scheduledDate: "2026-07-20", title: "젤다", gameId: game.id }],
    });
    const [card] = await createCaller(makeCtx()).games.list();
    expect(card!.id).toBe(game.id);
    expect(card!.lastPlayed).toBe("2026-07-20");
  });
});
