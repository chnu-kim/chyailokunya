import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { makeDb } from "@/db";
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

  it("add 는 game:write 있으면 저장하고 list 에 뜬다(날짜는 기본 null)", async () => {
    const caller = createCaller(makeCtx({ authorities: admin }));
    const row = await caller.games.add(eldenring);
    expect(row.id).toBeGreaterThan(0);
    expect(row.playedAt).toBeNull();
    expect(row.clearedAt).toBeNull();
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

  it("list 는 플레이 날짜 내림차순, 날짜 없는 행은 뒤로(그 안에선 추가 최신순)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    // 삽입 순서를 정렬 순서와 일부러 어긋나게 둔다 — createdAt 정렬이 남아 있으면 실패한다.
    await authed.games.add({ ...eldenring, playedAt: "2026-03-01" });
    const noDate1 = await authed.games.add({
      categoryId: "c2",
      categoryType: "GAME",
      categoryValue: "날짜 없음 1",
    });
    await authed.games.add({
      categoryId: "c3",
      categoryType: "GAME",
      categoryValue: "최근 플레이",
      playedAt: "2026-07-12",
    });
    const noDate2 = await authed.games.add({
      categoryId: "c4",
      categoryType: "GAME",
      categoryValue: "날짜 없음 2",
    });

    const list = await createCaller(makeCtx()).games.list();
    expect(list.map((g) => g.playedAt)).toEqual(["2026-07-12", "2026-03-01", null, null]);
    // SQLite 기본 정렬은 NULLS FIRST 라 이 순서가 규칙이 실제로 걸렸다는 증거다.
    // 날짜 없는 둘 사이에선 나중에 추가한 쪽이 위.
    expect(list[2]!.id).toBe(noDate2.id);
    expect(list[3]!.id).toBe(noDate1.id);
  });

  it("update 는 game:write 없으면 FORBIDDEN(서버 권위)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);
    await expect(
      createCaller(makeCtx()).games.update({ id: row.id, playedAt: "2026-07-20" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // 막혔으면 저장도 안 됐다.
    const [after] = await createCaller(makeCtx()).games.list();
    expect(after!.playedAt).toBeNull();
  });

  it("update 는 날짜를 고치고, null 로 지울 수도 있다", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);

    const dated = await authed.games.update({
      id: row.id,
      playedAt: "2026-07-01",
      clearedAt: "2026-07-20",
    });
    expect(dated.playedAt).toBe("2026-07-01");
    expect(dated.clearedAt).toBe("2026-07-20");

    // 날짜를 빼고 보내면 지워진다(부분 patch 가 아니라 전체 치환).
    const cleared = await authed.games.update({ id: row.id });
    expect(cleared.playedAt).toBeNull();
    expect(cleared.clearedAt).toBeNull();
  });

  it("update 는 없는 id 면 NOT_FOUND(삭제와 달리 조용히 성공하지 않는다)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    await expect(authed.games.update({ id: 9999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("update 도 날짜 검증을 통과해야 한다(수정 경로로 우회 불가)", async () => {
    const authed = createCaller(makeCtx({ authorities: admin }));
    const row = await authed.games.add(eldenring);
    await expect(authed.games.update({ id: row.id, playedAt: "2026-02-31" })).rejects.toMatchObject(
      {
        code: "BAD_REQUEST",
      },
    );
    await expect(
      authed.games.update({ id: row.id, playedAt: "2026-07-20", clearedAt: "2026-01-01" }),
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
