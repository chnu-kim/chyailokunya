import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { makeDb, users } from "@/db";
import { appRouter } from "@/features/router";
import { createCallerFactory, type Context } from "@/features/trpc/init";
import { OPEN_SUGGESTION_LIMIT } from "./service";

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
    await expect(
      fan.suggestions.create({ kind: "add", title: "한 개 더" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("제안함 (game:write 가 지킨다)", () => {
  it("list·pendingCount·resolve 는 권한 없으면 FORBIDDEN — 로그인만으론 못 본다", async () => {
    const userId = await makeUser();
    const fan = createCaller(makeCtx({ userId }));
    await expect(fan.suggestions.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fan.suggestions.pendingCount()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      fan.suggestions.resolve({ id: 1, resolution: "accepted" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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
