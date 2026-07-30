import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { toIsoDate } from "@/core/calendar";
import { games, makeDb, scheduleDays, scheduleEntries, scheduleWeeks, type Db } from "@/db";
import { createCallerFactory } from "@/features/trpc/init";
import { appRouter } from "@/features/router";
import type { Context } from "@/features/trpc/init";
import { getPublishedWeek, getWeekForEdit, nextRevision, saveWeek } from "./service";

/* 일정 라우터 — 주 단위 일괄 저장(전체 교체)의 서버 권위·불변식을 caller 로 직접 증명한다.
   각 it 은 격리 저장소라 마이그레이션된 빈 스키마에서 시작한다(setupFiles). */

const createCaller = createCallerFactory(appRouter);
const admin = authoritiesFor(["admin"]); // schedule:write + game:write 포함

function makeCtx(
  over: { authorities?: ReadonlySet<Authority>; fanart?: Context["fanart"] } = {},
): Context {
  const authorities = over.authorities ?? new Set<Authority>();
  return {
    db: makeDb(env.DB),
    actor: null,
    chzzk: null,
    // 기본은 null — 바인딩 없는 환경과 같다(정리를 건너뛴다). 팬아트 정리를 재는 테스트만 스텁을 준다.
    fanart: over.fanart ?? null,
    authoritiesOf: async () => authorities,
  };
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
      // 메타도 항목도 없는 주 = 아직 아무도 안 짠 새 주라 초안으로 연다.
      draft: true,
      revision: null,
      days: [],
      fanartImageKey: null,
      fanartCredit: null,
      fanartImageWidth: null,
      fanartImageHeight: null,
      entries: [],
    });
  });

  it("saveWeek 은 그 주를 저장하고 getWeek 이 되읽는다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      note: "이번 주는 젤다 위주",
      days: [],
      entries: [
        { scheduledDate: "2026-07-20", title: "젤다" },
        { scheduledDate: "2026-07-22", title: "저챗" },
      ],
    });
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.note).toBe("이번 주는 젤다 위주");
    expect(week.entries.map((e) => e.title)).toEqual(["젤다", "저챗"]);
    // 시각은 항목이 아니라 하루에 달린다(이슈 #117) — 기본값인 날은 아예 안 실려 온다.
    expect(week.days).toEqual([]);
  });

  it("하루 안 항목은 넣은 순서를 지킨다 — core 의 entriesForDate 와 같은 규칙", async () => {
    /* 시각이 하루로 올라가(이슈 #117) 항목별 정렬 키가 사라졌다. 남은 규칙은 id 순(= 넣은 순)
       하나이고, 편집기의 entriesForDate 가 그 거울이다 — 갈리면 저장 순간 화면이 재배열된다. */
    const caller = createCaller(makeCtx({ authorities: admin }));
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [
        { scheduledDate: "2026-07-20", title: "먼저" },
        { scheduledDate: "2026-07-20", title: "다음" },
        { scheduledDate: "2026-07-20", title: "마지막" },
      ],
    });
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.entries.map((e) => e.title)).toEqual(["먼저", "다음", "마지막"]);
  });

  it("하루 시각과 휴방을 저장하고 되읽는다 — 기본값인 날은 행을 안 만든다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [
        { scheduledDate: "2026-07-20", startTime: "21:00", rest: false },
        { scheduledDate: "2026-07-21", startTime: null, rest: true },
        // 기본값(시각 없음·휴방 아님) — 서버가 걸러 행을 안 만든다.
        { scheduledDate: "2026-07-22", startTime: null, rest: false },
      ],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
    });
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(
      week.days.map((d) => ({ date: d.scheduledDate, time: d.startTime, rest: d.rest })),
    ).toEqual([
      { date: "2026-07-20", time: "21:00", rest: false },
      { date: "2026-07-21", time: null, rest: true },
    ]);
  });

  it("휴방으로 바꾼 날의 항목은 보드의 플레이 날짜에서 빠진다 — 두 공개 화면이 같은 말을 한다", async () => {
    /* /schedule 은 휴방인 날의 항목을 가린다(ADR-0027 결정 5 — 표시에서 휴방이 이긴다). 보드가
       같은 규칙을 안 따르면 주간표는 그날을 "휴방"이라 하는데 게임 보드는 같은 날짜를 그 게임의
       플레이 날짜로 띄운다 — 관리자가 한 행동은 "그날 쉬기로 했다" 하나뿐인데 두 공개 화면이
       서로 다른 말을 하게 된다(코드 리뷰가 잡은 자리). */
    const caller = createCaller(makeCtx({ authorities: admin }));
    const db = makeDb(env.DB);
    const [g] = await db
      .insert(games)
      .values({ categoryType: "GAME", categoryValue: "엘든 링" })
      .returning();

    // 먼저 평범하게 편성하고 발행한다 — 보드에 날짜가 뜬다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      published: true,
      days: [{ scheduledDate: "2026-07-22", startTime: "20:00", rest: false }],
      entries: [{ scheduledDate: "2026-07-22", title: "엘든 링", gameId: g!.id }],
    });
    expect((await createCaller(makeCtx()).games.list())[0]!.lastPlayed).toBe("2026-07-22");

    /* 그날을 휴방으로 바꾼다. 항목은 **일부러 그대로 둔다** — 표시에서만 휴방이 이기고 저장은
       보존하는 것이 결정 5 라, 이 상황이 실제로 만들어질 수 있다. */
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      published: true,
      days: [{ scheduledDate: "2026-07-22", startTime: null, rest: true }],
      entries: [{ scheduledDate: "2026-07-22", title: "엘든 링", gameId: g!.id }],
    });
    expect((await createCaller(makeCtx()).games.list())[0]!.lastPlayed).toBeNull();
  });

  it("휴방만 있는 주도 발행할 수 있다 — 항목 0 이 곧 빈 주는 아니다(결정 9)", async () => {
    /* 옛 규칙(항목 0 = 빈 주)이면 이 저장이 EmptyWeekCannotPublish 로 거절된다. 화면은 7일이
       다 정해진 주를 보여주는데 발행만 서버에서 막히는, 이 저장소가 반복해 밟은 모양이다. */
    const caller = createCaller(makeCtx({ authorities: admin }));
    const saved = await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      published: true,
      days: [{ scheduledDate: "2026-07-20", startTime: null, rest: true }],
      entries: [],
    });
    expect(saved.publishedAt).not.toBeNull();
    expect(await getPublishedWeek(makeDb(env.DB), MON)).not.toBeNull();
  });

  it("일괄 저장은 그 주를 전체 교체한다 — 뺀 항목은 사라진다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [
        { scheduledDate: "2026-07-20", title: "A" },
        { scheduledDate: "2026-07-21", title: "B" },
      ],
    });
    // 다시 저장하며 B 를 뺀다 — 전체 교체라 B 는 사라지고 C 가 생긴다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
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
      days: [],
      entries: [{ scheduledDate: "2026-07-28", title: "다음 주 항목" }],
    });
    // MON 주를 저장(교체)해도 다음 주는 그대로여야 한다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "이번 주 항목" }],
    });
    const next = await caller.schedule.getWeek({ weekStartDate: nextMon });
    expect(next.entries.map((e) => e.title)).toEqual(["다음 주 항목"]);
  });

  it("발행 시각은 처음 발행 때만 찍고 재저장엔 유지, 내리면 null", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    // 빈 주는 발행이 거절되므로(아래 "빈 주는 발행이 거절된다") 항목을 하나 채운다.
    const entry = { scheduledDate: "2026-07-20", title: "젤다" };
    const first = await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      published: true,
      days: [],
      entries: [entry],
    });
    expect(typeof first.publishedAt).toBe("number");
    // 재저장(계속 발행)엔 발행 시각이 안 바뀐다.
    const again = await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      published: true,
      days: [],
      entries: [entry],
    });
    expect(again.publishedAt).toBe(first.publishedAt);
    // 발행을 내리면 공개가 꺼진다 — 다만 "짜는 중"으로 되돌아가지는 않는다(아래 테스트).
    const unpublished = await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      published: false,
      days: [],
      entries: [entry],
    });
    expect(unpublished.publishedAt).toBeNull();
  });

  /* 적대적 리뷰 지적(2026-07-28, PR #114 2라운드) — EmptyWeekCannotPublish 를 publishWeek 에만
     걸면 saveWeek(여전히 노출된, schedule:write 권한자가 직접 부를 수 있는 뮤테이션)으로 그대로
     우회된다. saveWeek 은 전체 교체라 input.entries 가 곧 저장 후의 항목 전체이므로 DB 조회 없이
     입력만으로 판정한다. */
  it("빈 주는 saveWeek(published:true) 로도 발행이 거절된다 — publishWeek 우회 경로를 막는다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await expect(
      caller.schedule.saveWeek({
        weekStartDate: MON,
        revision: null,
        published: true,
        days: [],
        entries: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 거절됐으면 메타 자체가 안 생긴다 — DB 를 하나도 안 건드리고 막혔다는 뜻이다.
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.revision).toBeNull();
    expect(week.publishedAt).toBeNull();
  });

  /* db.batch 를 감싸 n번째 호출만 실패시킨다 — saveWeek 의 특정 단계(0단계가 못 잡는 이유로
     2단계가 실패하는 경우 등) 실패를 결정적으로 재현한다. 진짜 경합(프리검증 SELECT 와 2단계
     INSERT 사이에 다른 관리자가 참조 게임을 지움 등)은 단일 스레드 테스트로 못 만든다 — 대신
     **같은 실패 지점**을 재현한다. saveWeek 은 db.batch 를 정확히 두 번 부른다(메타·이전 항목을
     읽는 1회, 실제 쓰기 2회)는 사실에 의존하므로, 그 호출 횟수가 바뀌면 이 헬퍼를 쓰는 테스트도
     같이 고쳐야 한다. */
  function dbFailingOnNthBatch(db: Db, n: number): Db {
    let batchCalls = 0;
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "batch") {
          return (...args: Parameters<Db["batch"]>) => {
            batchCalls += 1;
            if (batchCalls === n) return Promise.reject(new Error("simulated batch failure"));
            return target.batch(...(args as Parameters<Db["batch"]>));
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Db;
  }

  /* 적대적 리뷰 지적(2026-07-28, PR #114 3~4라운드) — null revision(새/레거시 주) 청구는 한때
     "의도한 메타(note·draft·published_at)를 그대로 담아" 행을 만들었다("생성이지 변경이 아니라
     안전하다"는 논리). 그런데 프리검증(0단계) SELECT 와 2단계 batch INSERT 사이에 참조 게임이
     지워지는 것처럼 0단계가 못 잡는 이유로 2단계가 실패하면, 이미 커밋된 그 메타 행이 "발행됨·
     항목 0개·제출한 공지"인 채로 남는다(3라운드가 draft·publishedAt 을, 4라운드가 note 를 잡았다).
     서비스가 청구 행을 "메타 행이 아예 없던 상태"와 같은 뜻으로 채우게 고쳤다(saveWeek 주석
     참고) — note 가 진짜로 안 남는지까지 이 테스트가 본다(4라운드 지적: 첫 판은 note:null 만
     테스트해 이 누락을 못 잡았다). */
  it("null revision 청구 뒤 2단계가 실패해도 그 주는 발행·공지된 채로 안 남는다", async () => {
    const db = makeDb(env.DB);
    await expect(
      saveWeek(dbFailingOnNthBatch(db, 2), {
        weekStartDate: toIsoDate(MON),
        revision: null,
        note: "저장이 거절됐다는데 남으면 안 되는 공지",
        published: true,
        days: [],
        entries: [{ scheduledDate: toIsoDate(MON), title: "젤다", gameId: null }],
      }),
    ).rejects.toThrow();

    // 1단계 청구는 (실제 DB 에) 성공했더라도, 그 행은 안전한 placeholder 로 남아야 한다 —
    // 실패가 "발행됨·항목 0개·공지 있음"을 남기면 손실 0 은 지켜도 발행 경계가 샌다.
    const week = await getWeekForEdit(db, MON);
    expect(week.publishedAt).toBeNull();
    expect(week.note).toBeNull();
    expect(week.draft).toBe(true);
    expect(week.entries).toHaveLength(0);
  });

  /* 4라운드가 잡은 반대 방향 회귀 — draft placeholder 를 무조건 true 로 두면, 메타 없이 이미
     보드에 떠 있던 **레거시 주**(항목은 있고 메타는 없어 coalesce 로 draft=0 취급, ADR-0024)가
     저장 실패의 그 순간 draft=true 로 바뀌어 **보드에서 사라진다** — 저장이 실패했을 뿐인데
     이미 공개돼 있던 데이터가 없어지면 손실 0(결정 16)이 정확히 깨진다. placeholder 의 draft 는
     "메타 행이 없었을 때와 같은 값"(priorEntries.length===0)이어야 한다. */
  it("null revision 청구 뒤 2단계가 실패해도 이관된 레거시 주는 보드에서 안 사라진다", async () => {
    const db = makeDb(env.DB);
    // 마이그레이션 0007 이 만드는 모양 그대로: 항목만 있고 schedule_weeks 메타는 없다.
    await db.insert(scheduleEntries).values({ scheduledDate: MON, title: "레거시 항목" });
    const before = await getWeekForEdit(db, MON);
    expect(before.draft).toBe(false); // 메타 없음 + 항목 있음 = 확정(보드에 뜸)

    await expect(
      saveWeek(dbFailingOnNthBatch(db, 2), {
        weekStartDate: toIsoDate(MON),
        revision: null, // 메타가 없으니 편집기가 읽는 revision 도 null 이다.
        note: null,
        published: false,
        days: [],
        entries: [{ scheduledDate: toIsoDate(MON), title: "레거시 항목", gameId: null }],
      }),
    ).rejects.toThrow();

    const after = await getWeekForEdit(db, MON);
    expect(after.draft).toBe(false); // 저장이 실패했다고 갑자기 보드에서 빠지면 안 된다
    expect(after.entries.map((e) => e.title)).toEqual(["레거시 항목"]);
  });

  /* 공개 철회는 "공개를 거둔다"이지 "안 짠 것으로 되돌린다"가 아니다. 한 번 발행한 주를 내렸다고
     그 주에 플레이한 게임의 보드 날짜까지 사라지면, 관리자는 공개만 내렸는데 보드가 함께 비는
     걸 본다 — ADR-0022 가 (−)로 안고 있던 결합이다. draft 축을 유지해 그 결합을 끊는다. */
  it("발행을 내려도 보드 날짜는 산다 — 공개만 철회되고 초안으로 안 돌아간다", async () => {
    const db = makeDb(env.DB);
    const authed = createCaller(makeCtx({ authorities: admin }));
    const game = await authed.games.add({
      categoryId: "c-elden",
      categoryType: "GAME",
      categoryValue: "엘든링",
    });
    const entry = { scheduledDate: "2026-07-22", title: "엘든링", gameId: game.id };

    await saveWeekAsEditor(authed, { weekStartDate: MON, published: true, entries: [entry] });
    expect((await createCaller(makeCtx()).games.list())[0]!.lastPlayed).toBe("2026-07-22");

    const after = await saveWeekAsEditor(authed, {
      weekStartDate: MON,
      published: false,
      days: [],
      entries: [entry],
    });
    expect(after.draft).toBe(false); // 확정 상태는 유지
    expect(await getPublishedWeek(db, MON)).toBeNull(); // 공개는 꺼졌다
    expect((await createCaller(makeCtx()).games.list())[0]!.lastPlayed).toBe("2026-07-22");
  });

  /* 반대 방향 — 아직 아무도 안 짠 주를 초안으로 저장하면 보드에도 공개에도 안 뜬다(결정 13).
     위 테스트와 짝이라 둘이 함께 "draft 와 published_at 은 독립 축"을 못박는다. */
  it("새 주를 초안으로 저장하면 보드에도 공개에도 안 뜬다", async () => {
    const db = makeDb(env.DB);
    const authed = createCaller(makeCtx({ authorities: admin }));
    const game = await authed.games.add({
      categoryId: "c-elden",
      categoryType: "GAME",
      categoryValue: "엘든링",
    });

    const saved = await saveWeekAsEditor(authed, {
      weekStartDate: MON,
      published: false,
      days: [],
      entries: [{ scheduledDate: "2026-07-22", title: "엘든링", gameId: game.id }],
    });
    expect(saved.draft).toBe(true);
    expect(await getPublishedWeek(db, MON)).toBeNull();
    expect((await createCaller(makeCtx()).games.list())[0]!.lastPlayed).toBeNull();
  });

  /* 스키마가 모순 조합을 막는다 — 짜는 중인데 공개된 주는 없다. 서비스가 실수로 그 조합을
     쓰려 해도 DB 가 최종 방어선이다(games_cleared_date CHECK 와 같은 결). */
  it("짜는 중인데 공개된 주는 DB 가 거절한다(CHECK)", async () => {
    const db = makeDb(env.DB);
    await expect(
      db.insert(scheduleWeeks).values({ weekStartDate: MON, draft: true, publishedAt: 1_700_000 }),
    ).rejects.toThrow();
    // 반대 조합(확정인데 미공개)은 정상이다 — 과거 아카이브가 거기 산다.
    await expect(
      db.insert(scheduleWeeks).values({ weekStartDate: MON, draft: false, publishedAt: null }),
    ).resolves.toBeDefined();
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
        days: [],
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
        days: [],
        entries: [{ scheduledDate: "2026-07-20", title: "유령 게임", gameId: 9999 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    /* 막혔으면 주 메타도 안 생긴다 — prevalidate 가 청구 이전에 걸러 아무것도 안 썼다.
       revision 이 메타 행의 관찰 가능한 정본이다(있으면 행이 있다는 뜻). */
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.revision).toBeNull();
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
      days: [],
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
        days: [],
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
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "B 가 넣은 항목" }],
    });

    /* A 가 자기 초안을 저장한다 — 전체 교체라 그대로 통과시키면 B 의 항목이 **통째로 사라진다**.
       불러온 시점의 revision 이 지금과 달라 CONFLICT 로 거절돼야 한다. */
    await expect(
      caller.schedule.saveWeek({
        weekStartDate: MON,
        revision: opened.revision,
        days: [],
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
      days: [],
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
        days: [],
        entries: [{ scheduledDate: "2026-07-20", title: "A" }],
      }),
      caller.schedule.saveWeek({
        weekStartDate: MON,
        revision: opened.revision,
        days: [],
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

    /* 편집기가 이 주를 연다. 항목이 있는데 메타가 없으면 이관된 과거 아카이브라 **확정**으로
       열린다(draft=false) — 아직 아무도 안 짠 빈 주(draft=true)와 갈리는 자리다. */
    const loaded = await authed.schedule.getWeek({ weekStartDate: MON });
    expect(loaded.draft).toBe(false);
    expect(loaded.publishedAt).toBeNull();

    /* **발행을 켜지 않고** 저장한다. 한때는 이 경로가 손실 자리였다 — published_at NULL 인 메타가
       생기면서 그 주 항목이 보드에서 빠져 이관이 지킨 "손실 0"이 첫 편집에서 깨졌고, 그래서
       편집기가 레거시 주를 "이미 공개 중"으로 열어(발행 체크됨) 우회했다. draft 축이 생기면서
       우회가 필요 없어졌다: 서버가 기존 draft(false)를 유지하므로 공개는 안 되고 보드 날짜는
       산다. 이 테스트가 그 두 가지를 한꺼번에 못박는다. */
    await saveWeekAsEditor(authed, {
      weekStartDate: MON,
      note: loaded.note,
      published: false,
      entries: loaded.entries.map((e) => ({
        scheduledDate: e.scheduledDate,
        title: e.title,
        gameId: e.gameId,
      })),
    });
    expect((await createCaller(makeCtx()).games.list())[0]!.lastPlayed).toBe("2026-07-22");
    // 보드엔 살아 있지만 공개는 안 된다 — 과거 아카이브는 주간표로 발행된 적이 없다.
    expect(await getPublishedWeek(db, MON)).toBeNull();
  });

  it("공개 읽기(getPublishedWeek)는 발행된 주만 준다 — 초안은 null(공개 화면이 안 샌다)", async () => {
    const db = makeDb(env.DB);
    const caller = createCaller(makeCtx({ authorities: admin }));
    // 초안으로 저장 — 편집자는 getWeek 으로 보지만 공개 읽기엔 안 뜬다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      note: "짜는 중",
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
    });
    expect(await getPublishedWeek(db, MON)).toBeNull();
    // 발행하면 공개 읽기가 그 주를 준다(전체 교체라 편집기처럼 note 도 함께 다시 보낸다).
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      note: "짜는 중",
      published: true,
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
    });
    const published = await getPublishedWeek(db, MON);
    expect(published?.note).toBe("짜는 중");
    expect(published?.entries.map((e) => e.title)).toEqual(["젤다"]);
  });

  describe("publishWeek — 발행·비공개 전환 전용(이슈 #56 결정 14 개정)", () => {
    it("schedule:write 없으면 FORBIDDEN", async () => {
      const caller = createCaller(makeCtx());
      await expect(
        caller.schedule.publishWeek({ weekStartDate: MON, revision: 1, published: true }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("발행하면 publishedAt 이 서고, entries·note 는 그대로다", async () => {
      const caller = createCaller(makeCtx({ authorities: admin }));
      const saved = await saveWeekAsEditor(caller, {
        weekStartDate: MON,
        note: "이번 주는 젤다 위주",
        days: [],
        entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
      });
      expect(saved.publishedAt).toBeNull(); // saveWeek 은 published 를 안 실어 보냈다(기본 false)

      const published = await caller.schedule.publishWeek({
        weekStartDate: MON,
        revision: saved.revision!,
        published: true,
      });
      expect(typeof published.publishedAt).toBe("number");
      expect(published.draft).toBe(false);
      // entries·note 는 publishWeek 이 안 건드린다.
      expect(published.note).toBe("이번 주는 젤다 위주");
      expect(published.entries.map((e) => e.title)).toEqual(["젤다"]);
    });

    /* 적대적 리뷰 지적(2026-07-28, PR #114) — 편집기의 disabled 버튼·머신 가드(canPublish)는
       편의일 뿐 유일한 방어선이 아니다. schedule:write 권한자가 이 뮤테이션을 직접 불러
       우회하면(포지드/스테일 클라이언트) 항목이 0개인 주도 발행돼 공개 화면에 빈 "발행됨"
       상태가 샐 수 있었다 — 실제로 이 테스트를 추가하기 전엔 통과했다(entries:[] 로 저장한 뒤
       바로 publishWeek 호출이 성공). 서버가 정본으로 다시 막는다(불변식 2·3). */
    it("빈 주는 발행이 거절된다 — UI 가드를 우회한 직접 호출도 서버가 막는다", async () => {
      const caller = createCaller(makeCtx({ authorities: admin }));
      const saved = await saveWeekAsEditor(caller, { weekStartDate: MON, entries: [] });
      await expect(
        caller.schedule.publishWeek({
          weekStartDate: MON,
          revision: saved.revision!,
          published: true,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      // 거절됐으면 revision 도 발행 상태도 안 바뀐다 — 실패가 아무 흔적을 안 남긴다.
      const after = await caller.schedule.getWeek({ weekStartDate: MON });
      expect(after.publishedAt).toBeNull();
      expect(after.revision).toBe(saved.revision);
    });

    it("재발행해도 최초 발행 시각이 유지된다", async () => {
      const caller = createCaller(makeCtx({ authorities: admin }));
      // 빈 주는 발행 자체가 거절되므로(아래 "빈 주는 발행이 거절된다") 항목 하나를 채운다.
      const saved = await saveWeekAsEditor(caller, {
        weekStartDate: MON,
        days: [],
        entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
      });
      const first = await caller.schedule.publishWeek({
        weekStartDate: MON,
        revision: saved.revision!,
        published: true,
      });
      const again = await caller.schedule.publishWeek({
        weekStartDate: MON,
        revision: first.revision!,
        published: true,
      });
      expect(again.publishedAt).toBe(first.publishedAt);
    });

    it("비공개로 전환하면 공개만 꺼지고 확정(draft=false) 상태와 entries 는 그대로다", async () => {
      const caller = createCaller(makeCtx({ authorities: admin }));
      const saved = await saveWeekAsEditor(caller, {
        weekStartDate: MON,
        days: [],
        entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
      });
      const published = await caller.schedule.publishWeek({
        weekStartDate: MON,
        revision: saved.revision!,
        published: true,
      });
      const unpublished = await caller.schedule.publishWeek({
        weekStartDate: MON,
        revision: published.revision!,
        published: false,
      });
      expect(unpublished.publishedAt).toBeNull();
      expect(unpublished.draft).toBe(false); // "안 짠 것으로" 안 돌아간다(ADR-0024)
      expect(unpublished.entries.map((e) => e.title)).toEqual(["젤다"]);
    });

    it("stale revision 이면 CONFLICT — 남의 발행·저장을 안 덮는다", async () => {
      const caller = createCaller(makeCtx({ authorities: admin }));
      const saved = await saveWeekAsEditor(caller, { weekStartDate: MON, entries: [] });
      // 다른 곳에서 먼저 저장해 revision 이 이미 올라갔다.
      await saveWeekAsEditor(caller, {
        weekStartDate: MON,
        days: [],
        entries: [{ scheduledDate: "2026-07-20", title: "새로 넣은 항목" }],
      });
      await expect(
        caller.schedule.publishWeek({
          weekStartDate: MON,
          revision: saved.revision!,
          published: true,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    /* 리뷰 지적(2026-07-28, PR #114 6라운드) — stale 한 발행 요청이 "빈 주" 검사에 먼저 걸리면
       CONFLICT 대신 BAD_REQUEST 를 받는다. 다른 관리자가 그 사이 항목을 전부 지우고 저장했다면
       사용자는 "다른 곳에서 먼저 바꿨다"를 알아야지 "요청이 잘못됐다"로 오독하면 안 된다 —
       CAS(신원) 확인이 빈 주 검사보다 먼저여야 한다. */
    it("stale 한 발행 요청 + 그 사이 항목이 전부 지워짐 — BAD_REQUEST 가 아니라 CONFLICT", async () => {
      const caller = createCaller(makeCtx({ authorities: admin }));
      const saved = await saveWeekAsEditor(caller, {
        weekStartDate: MON,
        days: [],
        entries: [{ scheduledDate: "2026-07-20", title: "곧 지워질 항목" }],
      });
      // 다른 곳에서 그 사이 항목을 전부 지우고 저장했다 — 지금 이 주는 실제로 비어 있다.
      await saveWeekAsEditor(caller, { weekStartDate: MON, entries: [] });

      await expect(
        caller.schedule.publishWeek({
          weekStartDate: MON,
          revision: saved.revision!, // 항목이 있던 시절의 낡은 revision
          published: true,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("weekStartDate 가 월요일이 아니면 거절", async () => {
      const caller = createCaller(makeCtx({ authorities: admin }));
      await expect(
        caller.schedule.publishWeek({
          weekStartDate: "2026-07-21",
          revision: 1,
          published: true,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
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
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다", gameId: game.id }],
    });
    const [card] = await createCaller(makeCtx()).games.list();
    expect(card!.id).toBe(game.id);
    expect(card!.lastPlayed).toBe("2026-07-20");
  });
});

/* 팬아트 저장 계약(ADR-0028). 바이트는 Route Handler 가 맡고(e2e/fanart.spec 이 증명) 여기선
   **키가 주 메타에 어떻게 붙고 떨어지는가**를 잰다 — 저장 규약(undefined/null/문자열)과 버려진
   객체 정리가 그 둘이다. */
describe("팬아트", () => {
  const KEY_A = "0189d1f0-3a4b-7c8d-9e0f-1a2b3c4d5e6f.png";
  const KEY_B = "0189d1f0-3a4b-7c8d-9e0f-aaaabbbbcccc.webp";

  /* R2 대신 "무엇이 올라와 있나"를 집합으로 들고 지운 키를 모으는 스텁. 구조적 타이핑이라
     어댑터가 필요 없다(service 의 FanartObjectStore). 기본은 **아무거나 있다고 답한다** —
     대부분의 테스트가 재려는 건 존재 확인이 아니라 조합·정리라, 매번 업로드를 흉내 내게 하면
     의도가 흐려진다. 존재 확인을 재는 테스트만 `present` 를 좁혀 준다. */
  function fanartSpy(present?: Set<string>) {
    const deleted: string[] = [];
    return {
      deleted,
      store: {
        delete: async (key: string) => void deleted.push(key),
        head: async (key: string) => (present ? (present.has(key) ? {} : null) : {}),
      },
    };
  }

  it("키와 표기를 저장하고 되읽는다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
      fanartImageKey: KEY_A,
      fanartCredit: "그린 사람",
    });
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    // 저장되는 값은 URL 이 아니라 키 조각이다 — 화면이 /api/fanart/${key} 로 조립한다.
    expect(week.fanartImageKey).toBe(KEY_A);
    expect(week.fanartCredit).toBe("그린 사람");
  });

  it("안 보낸 저장은 기존 팬아트를 그대로 둔다 — 옛 클라이언트가 값을 지우지 않는다", async () => {
    /* 전체 교체 뮤테이션에 새 필드를 더할 때의 일반 규칙이다. `.default(null)` 을 줬다면 이
       필드를 모르는 탭(배포 중 열려 있던 편집기)의 저장이 팬아트를 NULL 로 덮었다. */
    const caller = createCaller(makeCtx({ authorities: admin }));
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
      fanartImageKey: KEY_A,
      fanartCredit: "그린 사람",
    });
    // 팬아트 두 칸을 아예 안 싣고 저장한다(옛 클라이언트가 보내는 모양 그대로).
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [{ scheduledDate: "2026-07-21", title: "저챗" }],
    });
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.fanartImageKey).toBe(KEY_A);
    expect(week.fanartCredit).toBe("그린 사람");
  });

  it("키를 바꾸면 옛 객체를 치우고, 지우면 표기도 함께 사라진다", async () => {
    const spy = fanartSpy();
    const caller = createCaller(makeCtx({ authorities: admin, fanart: spy.store }));
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
      fanartImageKey: KEY_A,
      fanartCredit: "그린 사람",
    });
    expect(spy.deleted).toEqual([]); // 처음 붙일 땐 버려지는 게 없다

    // 다른 그림으로 교체 — 옛 객체는 이제 아무도 안 가리킨다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
      fanartImageKey: KEY_B,
    });
    // prefix 는 코드가 붙인다 — DB 엔 조각만 산다(core/fanart).
    expect(spy.deleted).toEqual([`fanart/${KEY_A}`]);

    // 명시적으로 지우면(null) 그 객체도 치운다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
      fanartImageKey: null,
      fanartCredit: null,
    });
    expect(spy.deleted).toEqual([`fanart/${KEY_A}`, `fanart/${KEY_B}`]);
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.fanartImageKey).toBeNull();
    expect(week.fanartCredit).toBeNull();
  });

  it("같은 키를 다시 저장하면 아무것도 안 지운다 — 지금 걸려 있는 그림이다", async () => {
    const spy = fanartSpy();
    const caller = createCaller(makeCtx({ authorities: admin, fanart: spy.store }));
    const base = {
      weekStartDate: MON,
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
      fanartImageKey: KEY_A,
    };
    await saveWeekAsEditor(caller, base);
    await saveWeekAsEditor(caller, { ...base, fanartCredit: "그린 사람" });
    expect(spy.deleted).toEqual([]);
    expect((await caller.schedule.getWeek({ weekStartDate: MON })).fanartImageKey).toBe(KEY_A);
  });

  it("그림을 내리면 작가 표기도 함께 사라진다 — 표기만 남으면 DB CHECK 가 저장을 죽인다", async () => {
    /* 지움 요청이 키만 싣고 표기를 생략해도(화면이 그렇게 보낸다) 서버가 조합을 맞춘다.
       안 맞추면 batch 가 CHECK 로 실패하는데, 그때는 이미 revision 이 올라 편집기가 이유 없는
       CONFLICT 에 빠진다(적대적 리뷰·코드 리뷰가 같이 잡은 자리). */
    const caller = createCaller(makeCtx({ authorities: admin }));
    const entries = [{ scheduledDate: "2026-07-20", title: "젤다" }];
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: KEY_A,
      fanartCredit: "그린 사람",
    });
    // 표기는 안 싣고 그림만 내린다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: null,
    });
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.fanartImageKey).toBeNull();
    expect(week.fanartCredit).toBeNull();
  });

  it("그림을 바꾸면 옛 작가 표기를 안 물려준다 — 잘못된 귀속이 값 소실보다 나쁘다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const entries = [{ scheduledDate: "2026-07-20", title: "젤다" }];
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: KEY_A,
      fanartCredit: "처음 그린 사람",
    });
    // 새 그림만 싣는다(표기 생략) — 옛 이름이 새 그림에 붙으면 안 된다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: KEY_B,
    });
    let week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.fanartImageKey).toBe(KEY_B);
    expect(week.fanartCredit).toBeNull();

    // 새 표기를 함께 보내면 그 값이 쓰인다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: KEY_A,
      fanartCredit: "다른 사람",
    });
    week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.fanartCredit).toBe("다른 사람");
  });

  it("표기만 보냈는데 걸린 그림이 없으면 거절하고 revision 을 안 올린다", async () => {
    /* 청구 뒤로 미루면 거절이 그 주를 stale 하게 만들어, 편집기가 멀쩡한 폼을 들고도 다음
       저장에서 CONFLICT 를 받는다. 그래서 revision 이 그대로인지도 함께 잰다. */
    const caller = createCaller(makeCtx({ authorities: admin }));
    const entries = [{ scheduledDate: "2026-07-20", title: "젤다" }];
    await saveWeekAsEditor(caller, { weekStartDate: MON, days: [], entries });
    const before = await caller.schedule.getWeek({ weekStartDate: MON });

    await expect(
      caller.schedule.saveWeek({
        weekStartDate: MON,
        revision: before.revision,
        days: [],
        entries,
        // 그림은 안 싣고(= 유지, 그런데 지금 걸린 게 없다) 표기만 보낸다.
        fanartCredit: "그린 사람",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const after = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(after.revision).toBe(before.revision);
  });

  it("같은 키를 다른 주가 아직 쓰면 안 지운다 — 남의 그림이 깨진다", async () => {
    const spy = fanartSpy();
    const caller = createCaller(makeCtx({ authorities: admin, fanart: spy.store }));
    const NEXT_MON = "2026-07-27";
    // 두 주가 같은 그림을 건다(스키마가 막지 않는다 — UNIQUE 가 아니다).
    for (const week of [MON, NEXT_MON]) {
      await saveWeekAsEditor(caller, {
        weekStartDate: week,
        days: [],
        entries: [{ scheduledDate: week, title: "젤다" }],
        fanartImageKey: KEY_A,
      });
    }
    // 한쪽에서 내려도 다른 주가 아직 가리키므로 객체는 살아 있어야 한다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [{ scheduledDate: MON, title: "젤다" }],
      fanartImageKey: null,
    });
    expect(spy.deleted).toEqual([]);

    // 마지막 참조가 사라지면 그때 지운다.
    await saveWeekAsEditor(caller, {
      weekStartDate: NEXT_MON,
      days: [],
      entries: [{ scheduledDate: NEXT_MON, title: "젤다" }],
      fanartImageKey: null,
    });
    expect(spy.deleted).toEqual([`fanart/${KEY_A}`]);
  });

  it("그림 없이 작가 표기만은 거절한다 — 화면엔 아무것도 안 뜨는데 값만 남는다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await expect(
      saveWeekAsEditor(caller, {
        weekStartDate: MON,
        days: [],
        entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
        fanartImageKey: null,
        fanartCredit: "그린 사람",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("올라와 있지 않은 그림은 못 건다 — 형식만 맞는 키를 믿지 않는다", async () => {
    /* 형식 검증만 하고 저장하면 **발행된 주가 404 나는 그림을 영구히 가리킨다**(적대적 리뷰
       no-ship). 위조 클라이언트뿐 아니라, ADR-0028 이 후속으로 적어 둔 고아 정리가 "업로드했지만
       아직 저장 안 한" 객체를 지우는 순간 평범한 조작에서도 열리는 상태다.

       거절이 **revision 을 안 올리는지**도 함께 잰다 — 청구 뒤로 미루면 실패가 그 주를 stale 하게
       만들어 편집기가 멀쩡한 폼을 들고도 다음 저장에서 CONFLICT 를 받는다. */
    const spy = fanartSpy(new Set([`fanart/${KEY_A}`])); // A 만 올라와 있다
    const caller = createCaller(makeCtx({ authorities: admin, fanart: spy.store }));
    const entries = [{ scheduledDate: "2026-07-20", title: "젤다" }];
    await saveWeekAsEditor(caller, { weekStartDate: MON, days: [], entries });
    const before = await caller.schedule.getWeek({ weekStartDate: MON });

    await expect(
      caller.schedule.saveWeek({
        weekStartDate: MON,
        revision: before.revision,
        days: [],
        entries,
        fanartImageKey: KEY_B, // 형식은 완벽하지만 올린 적이 없다
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await caller.schedule.getWeek({ weekStartDate: MON })).revision).toBe(before.revision);

    // 올라와 있는 키는 그대로 통과한다 — 확인이 정상 경로를 막지 않는다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: KEY_A,
    });
    expect((await caller.schedule.getWeek({ weekStartDate: MON })).fanartImageKey).toBe(KEY_A);
  });

  it("이미 걸린 키를 다시 보내면 저장소에 다시 묻지 않는다", async () => {
    /* 편집기는 전체 교체라 같은 키를 매 저장마다 다시 싣는다 — 그때마다 R2 왕복을 더하면
       평범한 저장이 비싸진다. 그 사이 객체가 사라졌다면 화면이 깨진 것으로 드러나고, 그건
       이 검사가 막으려던 "우리가 방금 만든 잘못된 참조"와는 다른 사고다. */
    const present = new Set([`fanart/${KEY_A}`]);
    const spy = fanartSpy(present);
    const caller = createCaller(makeCtx({ authorities: admin, fanart: spy.store }));
    const entries = [{ scheduledDate: "2026-07-20", title: "젤다" }];
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: KEY_A,
    });

    // 객체가 사라져도(정리·수동 삭제) 같은 키를 다시 보내는 저장은 통과한다.
    present.clear();
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: KEY_A,
      fanartCredit: "그린 사람",
    });
    expect((await caller.schedule.getWeek({ weekStartDate: MON })).fanartCredit).toBe("그린 사람");
  });

  it("업로드가 낸 키가 아닌 값은 거절한다 — 외부 주소가 이 칸에 못 들어온다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    for (const bad of ["https://example.com/a.png", "../secret", `fanart/${KEY_A}`]) {
      await expect(
        saveWeekAsEditor(caller, {
          weekStartDate: MON,
          days: [],
          entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
          // 위조 클라이언트가 보낼 수 있는 값 — Zod 경계가 형식으로 거른다(core/fanart 가 정본).
          fanartImageKey: bad,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  /* 치수(읽기 화면의 자리 예약). 표기와 같은 규약을 따르지만 **한 쌍**이라는 조건이 더 붙는다 —
     반쪽 조합은 DB CHECK 가 batch 를 죽인다(그 시점엔 revision 이 이미 올라 편집기가 이유 없는
     CONFLICT 를 본다). 아래가 그 조합들을 하나씩 못박는다. */
  it("치수를 함께 저장하고 되읽는다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
      fanartImageKey: KEY_A,
      fanartImageWidth: 1200,
      fanartImageHeight: 1600,
    });
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.fanartImageWidth).toBe(1200);
    expect(week.fanartImageHeight).toBe(1600);
  });

  it("치수 없이 그림만 저장하는 것은 정상이다 — 브라우저가 못 읽은 파일이 그 경로다", async () => {
    /* 치수를 필수로 걸면 그때 저장이 통째로 막혀 "그림은 올라갔는데 어느 주에도 걸 수 없다"가
       된다. 예약 없이 그리는 저하가 맞다(db/schema.ts 의 nullable 근거) — 그 저하 경로가 실제로
       열려 있는지 여기서 못박는다. */
    const caller = createCaller(makeCtx({ authorities: admin }));
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries: [{ scheduledDate: "2026-07-20", title: "젤다" }],
      fanartImageKey: KEY_A,
      fanartImageWidth: null,
      fanartImageHeight: null,
    });
    const week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.fanartImageKey).toBe(KEY_A);
    expect(week.fanartImageWidth).toBeNull();
    expect(week.fanartImageHeight).toBeNull();
  });

  it("안 보낸 저장은 기존 치수를 유지하고, 그림을 내리면 치수도 사라진다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const entries = [{ scheduledDate: "2026-07-20", title: "젤다" }];
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: KEY_A,
      fanartImageWidth: 800,
      fanartImageHeight: 600,
    });
    // 팬아트 칸을 아예 안 싣는다(이 필드를 모르는 옛 클라이언트가 보내는 모양).
    await saveWeekAsEditor(caller, { weekStartDate: MON, days: [], entries });
    let week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.fanartImageWidth).toBe(800);
    expect(week.fanartImageHeight).toBe(600);

    // 그림을 내린다 — 치수는 가리킬 그림이 없어져 함께 사라진다(표기와 같은 규칙).
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: null,
    });
    week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.fanartImageWidth).toBeNull();
    expect(week.fanartImageHeight).toBeNull();
  });

  it("그림을 바꾸면 옛 치수를 안 물려준다 — 예약한 자리와 비율이 어긋난다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const entries = [{ scheduledDate: "2026-07-20", title: "젤다" }];
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: KEY_A,
      fanartImageWidth: 800,
      fanartImageHeight: 600,
    });
    // 새 그림만 싣는다(치수 생략) — 세로 긴 그림에 가로 비율이 붙으면 화면이 튄다.
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: KEY_B,
    });
    let week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.fanartImageWidth).toBeNull();
    expect(week.fanartImageHeight).toBeNull();

    // 새 치수를 함께 보내면 그 값이 쓰인다(화면이 하는 일이다).
    await saveWeekAsEditor(caller, {
      weekStartDate: MON,
      days: [],
      entries,
      fanartImageKey: KEY_A,
      fanartImageWidth: 1200,
      fanartImageHeight: 1600,
    });
    week = await caller.schedule.getWeek({ weekStartDate: MON });
    expect(week.fanartImageWidth).toBe(1200);
    expect(week.fanartImageHeight).toBe(1600);
  });

  it("반쪽 치수·그림 없는 치수·상한 초과는 경계에서 거절한다", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const entries = [{ scheduledDate: "2026-07-20", title: "젤다" }];
    const bad: Parameters<typeof saveWeekAsEditor>[1][] = [
      // 폭만 — 예약 계산이 성립하지 않는다.
      { weekStartDate: MON, days: [], entries, fanartImageKey: KEY_A, fanartImageWidth: 800 },
      // 높이만.
      { weekStartDate: MON, days: [], entries, fanartImageKey: KEY_A, fanartImageHeight: 600 },
      // 한쪽만 null — "함께 있거나 함께 없다"를 깬다.
      {
        weekStartDate: MON,
        days: [],
        entries,
        fanartImageKey: KEY_A,
        fanartImageWidth: 800,
        fanartImageHeight: null,
      },
      // 그림을 지우면서 치수를 싣는다 — 가리킬 그림이 없다.
      {
        weekStartDate: MON,
        days: [],
        entries,
        fanartImageKey: null,
        fanartImageWidth: 800,
        fanartImageHeight: 600,
      },
      // 상한 초과 — 거대한 정수가 img 속성에 실리면 그림 한 장이 화면을 밀어낸다.
      {
        weekStartDate: MON,
        days: [],
        entries,
        fanartImageKey: KEY_A,
        fanartImageWidth: 20001,
        fanartImageHeight: 600,
      },
      // 0 이하 — 비율 계산이 깨진다(DB CHECK 와 같은 규칙).
      {
        weekStartDate: MON,
        days: [],
        entries,
        fanartImageKey: KEY_A,
        fanartImageWidth: 0,
        fanartImageHeight: 600,
      },
    ];
    for (const input of bad) {
      await expect(saveWeekAsEditor(caller, input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
});
