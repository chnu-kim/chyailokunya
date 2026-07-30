import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { gameSuggestions, makeDb, users } from "@/db";
import { appRouter } from "@/features/router";
import { createCallerFactory, type Context } from "@/features/trpc/init";
import { INBOX_LIMIT, OPEN_SUGGESTION_LIMIT } from "./service";

/* 팬 제안의 인가 경계를 caller 로 직접 증명한다(ADR-0025). 이 라우터는 인가가 두 층이라 —
   쓰기는 로그인만, 읽기·처리는 game:write — 어느 한 층이 새면 팬이 남의 제안을 읽거나 관리자
   아닌 사람이 제안을 처리한다. UI 버튼 숨김은 편의일 뿐이고 방어선은 여기다(불변식 3). */

const createCaller = createCallerFactory(appRouter);
const admin = authoritiesFor(["admin"]); // game:write + game:delete

function makeCtx(
  over: { authorities?: ReadonlySet<Authority>; userId?: number; channelId?: string } = {},
): Context {
  const authorities = over.authorities ?? new Set<Authority>();
  return {
    db: makeDb(env.DB),
    // userId 를 안 주면 비로그인이다 — authenticatedProcedure 가 여기서 갈린다.
    actor:
      over.userId === undefined
        ? null
        : { channelId: over.channelId ?? "ch-" + over.userId, userId: over.userId },
    chzzk: null,
    fanart: null,
    authoritiesOf: async () => authorities,
  };
}

// 제안엔 작성자 FK 가 필수라 users 행을 먼저 만든다(로그인 이력이 있어야 제안할 수 있다).
async function makeUser(): Promise<number> {
  const [row] = await makeDb(env.DB).insert(users).values({}).returning();
  return row!.id;
}

async function makeGame(): Promise<number> {
  const caller = createCaller(makeCtx({ authorities: admin }));
  const row = await caller.games.add({
    categoryId: "c-" + Math.random().toString(36).slice(2),
    categoryType: "GAME",
    categoryValue: "젤다의 전설",
  });
  return row.id;
}

const edit = (gameId: number) =>
  ({ kind: "edit", gameId, cleared: true, clearedDate: "2026-07-20" }) as const;

describe("제안 접수 (로그인만 요구한다)", () => {
  it("비로그인은 UNAUTHORIZED — 권한이 아니라 신원이 없어서다", async () => {
    const gameId = await makeGame();
    await expect(createCaller(makeCtx()).suggestions.create(edit(gameId))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  /* 이 테스트가 이 기능의 핵심 계약이다 — 권한이 **빈 집합인** 사람이 통과해야 한다.
     여기에 authority 를 걸면 member 역할이 없는 이 앱에선 아무도 제안을 못 낸다. */
  it("역할 없는 팬(빈 권한)도 제안을 낼 수 있다", async () => {
    const gameId = await makeGame();
    const userId = await makeUser();
    const row = await createCaller(makeCtx({ userId })).suggestions.create(edit(gameId));
    expect(row.status).toBe("pending");
    expect(row.gameId).toBe(gameId);
    expect(row.proposedCleared).toBe(true);
    expect(row.proposedClearedDate).toBe("2026-07-20");
  });

  it("게임 없이 추가 요청을 낸다 — 이름만 든다", async () => {
    const userId = await makeUser();
    const row = await createCaller(makeCtx({ userId })).suggestions.create({
      kind: "add",
      title: "새로 나온 인디게임",
      note: "이것도 해주세요!",
    });
    expect(row.kind).toBe("add");
    expect(row.gameId).toBeNull();
    expect(row.proposedTitle).toBe("새로 나온 인디게임");
  });

  it("같은 게임에 미처리 제안이 있으면 CONFLICT — 처리되면 다시 낼 수 있다", async () => {
    const gameId = await makeGame();
    const userId = await makeUser();
    const fan = createCaller(makeCtx({ userId }));
    const first = await fan.suggestions.create(edit(gameId));
    await expect(fan.suggestions.create(edit(gameId))).rejects.toMatchObject({ code: "CONFLICT" });

    const adminId = await makeUser();
    await createCaller(makeCtx({ authorities: admin, userId: adminId })).suggestions.resolve({
      id: first.id,
      resolution: "rejected",
    });
    // 부분 UNIQUE 라 처리된 제안은 제약 밖 — 한 번 거절당한 사람이 영영 못 내면 안 된다.
    await expect(fan.suggestions.create(edit(gameId))).resolves.toBeDefined();
  });

  it("다른 사람은 같은 게임에 각자 제안을 낼 수 있다", async () => {
    const gameId = await makeGame();
    const a = await makeUser();
    const b = await makeUser();
    await createCaller(makeCtx({ userId: a })).suggestions.create(edit(gameId));
    await expect(
      createCaller(makeCtx({ userId: b })).suggestions.create(edit(gameId)),
    ).resolves.toBeDefined();
  });

  it("지금 값과 똑같고 한마디도 없으면 BAD_REQUEST(소음 차단)", async () => {
    const gameId = await makeGame(); // 안 깬 채, 일정 없음
    const userId = await makeUser();
    await expect(
      createCaller(makeCtx({ userId })).suggestions.create({
        kind: "edit",
        gameId,
        cleared: false,
        clearedDate: null,
        playedDate: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  /* 값으로 표현 못 하는 제보(제목 오타·포스터 오류)는 관리자도 폼으로 못 고치는 스냅샷 필드라
     글로만 전할 수 있다 — 값 변경을 필수로 두면 그 길이 막힌다. */
  it("값이 그대로여도 한마디가 있으면 접수한다", async () => {
    const gameId = await makeGame();
    const userId = await makeUser();
    await expect(
      createCaller(makeCtx({ userId })).suggestions.create({
        kind: "edit",
        gameId,
        cleared: false,
        note: "포스터가 다른 게임이에요",
      }),
    ).resolves.toBeDefined();
  });

  it("없는 게임엔 NOT_FOUND", async () => {
    const userId = await makeUser();
    await expect(
      createCaller(makeCtx({ userId })).suggestions.create(edit(9999)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("안 깬 채 클리어 날짜만 있는 제안은 입력 경계가 막는다(games CHECK 의 짝)", async () => {
    const gameId = await makeGame();
    const userId = await makeUser();
    await expect(
      createCaller(makeCtx({ userId })).suggestions.create({
        kind: "edit",
        gameId,
        cleared: false,
        clearedDate: "2026-07-20",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("열어 둔 제안이 상한을 넘으면 TOO_MANY_REQUESTS(도배 차단)", async () => {
    const userId = await makeUser();
    const fan = createCaller(makeCtx({ userId }));
    // 추가 요청은 대상이 없어 게임당 제약이 안 걸린다 — 도배 경로가 정확히 여기다.
    for (let i = 0; i < OPEN_SUGGESTION_LIMIT; i++) {
      await fan.suggestions.create({ kind: "add", title: "게임 " + i });
    }
    await expect(fan.suggestions.create({ kind: "add", title: "한 개 더" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });
});

describe("제안함 (game:write 가 지킨다)", () => {
  it("list·pendingCount·resolve 는 권한 없으면 FORBIDDEN — 로그인만으론 못 본다", async () => {
    const userId = await makeUser();
    const fan = createCaller(makeCtx({ userId }));
    await expect(fan.suggestions.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fan.suggestions.pendingCount()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fan.suggestions.resolve({ id: 1, resolution: "accepted" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("미처리 제안을 최신순으로 주고 작성자 표시명을 싣는다", async () => {
    const gameId = await makeGame();
    const userId = await makeUser();
    await createCaller(makeCtx({ userId })).suggestions.create({
      ...edit(gameId),
      note: "7/20 방송에서 엔딩 봤어요",
    });

    const adminId = await makeUser();
    const list = await createCaller(
      makeCtx({ authorities: admin, userId: adminId }),
    ).suggestions.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.gameId).toBe(gameId);
    expect(list[0]!.note).toBe("7/20 방송에서 엔딩 봤어요");
    expect(list[0]!.proposed).toEqual({
      cleared: true,
      clearedDate: "2026-07-20",
      playedDate: null,
    });
    // oauth_accounts 행이 없는 신원이라 표시명은 null — 조인 실패가 아니라 값이 없는 것이다.
    expect(list[0]!.authorName).toBeNull();
  });

  it("처리하면 목록에서 빠지고, 두 번째 처리는 멱등하게 resolved:false", async () => {
    const gameId = await makeGame();
    const userId = await makeUser();
    const row = await createCaller(makeCtx({ userId })).suggestions.create(edit(gameId));

    const adminId = await makeUser();
    const boss = createCaller(makeCtx({ authorities: admin, userId: adminId }));
    expect(await boss.suggestions.pendingCount()).toBe(1);
    expect(await boss.suggestions.resolve({ id: row.id, resolution: "accepted" })).toEqual({
      resolved: true,
    });
    expect(await boss.suggestions.list()).toEqual([]);
    expect(await boss.suggestions.pendingCount()).toBe(0);

    /* 제안함을 열어 둔 사이 다른 관리자가 먼저 처리한 경우 — 목표 상태는 이미 달성됐으므로
       손쓸 수 없는 오류를 띄우지 않는다(removeGame 의 deleted:false 와 같은 판단). */
    expect(await boss.suggestions.resolve({ id: row.id, resolution: "rejected" })).toEqual({
      resolved: false,
    });
  });
});

describe("내 제안", () => {
  it("비로그인은 UNAUTHORIZED", async () => {
    await expect(createCaller(makeCtx()).suggestions.mine()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("내가 낸 것만 보인다 — 처리 상태와 함께", async () => {
    const gameId = await makeGame();
    const mine = await makeUser();
    const other = await makeUser();
    const row = await createCaller(makeCtx({ userId: mine })).suggestions.create(edit(gameId));
    await createCaller(makeCtx({ userId: other })).suggestions.create({
      kind: "add",
      title: "남의 요청",
    });

    const list = await createCaller(makeCtx({ userId: mine })).suggestions.mine();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(row.id);
    expect(list[0]!.status).toBe("pending");

    // 처리되면 상태가 바뀐 채로 계속 보인다 — 반영됐는지 모르면 같은 제보를 다시 낸다.
    const adminId = await makeUser();
    await createCaller(makeCtx({ authorities: admin, userId: adminId })).suggestions.resolve({
      id: row.id,
      resolution: "accepted",
    });
    const after = await createCaller(makeCtx({ userId: mine })).suggestions.mine();
    expect(after[0]!.status).toBe("accepted");
  });
});

/* 제안함은 한 번에 INBOX_LIMIT 까지만 준다(적대적 리뷰 4라운드가 연 자리). 그 상한이 **처리하면
   다음 것이 올라온다**는 약속 위에 서 있으므로 — 화면이 그렇게 적어 둔다 — 그 약속이 서버에서
   실제로 성립하는지 여기서 못박는다. 안 그러면 큐가 넘친 상황에서 관리자가 큐를 못 비운다. */
describe("제안함 상한", () => {
  it("최신순 상한까지만 주고, 하나를 처리하면 다음 것이 채워진다", async () => {
    const db = makeDb(env.DB);
    const gameId = await makeGame();

    /* 상한보다 하나 많게 심는다. 트리거가 작성자당 미처리 20건을 막으므로 작성자를 나눈다 —
       추가 요청(대상 없음)이라 게임당 UNIQUE 에도 안 걸린다. createdAt 을 손으로 박아 정렬이
       결정적이게 한다(값이 클수록 최신이라 목록 앞에 온다). */
    const total = OPEN_SUGGESTION_LIMIT * 6; // 120 > INBOX_LIMIT(100)
    for (let i = 0; i < total; i++) {
      if (i % OPEN_SUGGESTION_LIMIT === 0) await makeUser();
      const authorUserId = await currentUserId(db);
      await db.insert(gameSuggestions).values({
        kind: "add",
        authorUserId,
        proposedTitle: "게임 " + i,
        createdAt: 1_700_000_000_000 + i,
      });
    }

    const boss = createCaller(makeCtx({ authorities: admin, userId: await currentUserId(db) }));
    const first = await boss.suggestions.list();
    expect(first).toHaveLength(INBOX_LIMIT);
    // 전체 수는 상한과 무관하게 정확하다 — 배지가 이 값을 쓰고, 화면이 둘을 견줘 "더 있다"를 말한다.
    expect(await boss.suggestions.pendingCount()).toBe(total);

    /* 목록 맨 끝(가장 오래된 축)을 처리하면, 상한 밖에 있던 다음 것이 그 자리에 올라와야 한다.
       올라오지 않으면 관리자는 목록을 다 처리해도 남은 20건에 영영 못 닿는다. */
    const dropped = first[first.length - 1]!;
    await boss.suggestions.resolve({ id: dropped.id, resolution: "rejected" });

    const second = await boss.suggestions.list();
    expect(second).toHaveLength(INBOX_LIMIT);
    expect(second.some((i) => i.id === dropped.id)).toBe(false);
    // 방금 빈 자리를 상한 밖에 있던 줄이 채웠다 — 처리 전 목록엔 없던 id 다.
    const before = new Set(first.map((i) => i.id));
    expect(second.some((i) => !before.has(i.id))).toBe(true);
  });
});

// 방금 만든 users 행 중 가장 최근 것. 위 루프가 작성자를 20건마다 갈아 끼우는 데 쓴다.
async function currentUserId(db: ReturnType<typeof makeDb>): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users);
  return rows[rows.length - 1]!.id;
}
