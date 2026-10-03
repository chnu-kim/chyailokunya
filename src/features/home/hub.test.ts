import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { toIsoDate } from "@/core/calendar";
import { games, makeDb, scheduleDays, scheduleEntries, scheduleWeeks, type Db } from "@/db";
import { loadHomeHub } from "./hub";

const SAT = toIsoDate("2026-10-03"); // 이번 주 = 9.28(월) ~ 10.4(일)

async function addGame(db: Db, name: string, createdAt: number) {
  const [row] = await db
    .insert(games)
    .values({ categoryId: name, categoryType: "GAME", categoryValue: name, createdAt })
    .returning({ id: games.id });
  return row!.id;
}

describe("loadHomeHub", () => {
  it("빈 저장소 — 이번 주는 준비 중, 최근 게임은 없다", async () => {
    expect(await loadHomeHub(makeDb(env.DB), SAT)).toEqual({
      weekRange: "9.28 – 10.4",
      scheduleState: "준비 중",
      recentGame: null,
    });
  });

  it("이번 주에 발행 시각이 있으면 공개다 — 다른 주의 발행은 안 센다", async () => {
    const db = makeDb(env.DB);
    await db.insert(scheduleWeeks).values({ weekStartDate: "2026-09-21", publishedAt: 1 });
    expect((await loadHomeHub(db, SAT))!.scheduleState).toBe("준비 중");

    await db.insert(scheduleWeeks).values({ weekStartDate: "2026-09-28", publishedAt: 2 });
    expect((await loadHomeHub(db, SAT))!.scheduleState).toBe("공개");
  });

  /* 최근 게임은 보드와 같은 기준이어야 한다 — 초안 주의 항목과 휴방인 날의 항목은 안 센다
     (games/service 의 lastPlayedExpr). 기준이 갈리면 홈은 A 를, 보드 맨 위는 B 를 최근이라 부른다. */
  it("최근 게임은 보드와 같은 기준이다 — 초안 주·휴방인 날의 항목은 안 센다", async () => {
    const db = makeDb(env.DB);
    const older = await addGame(db, "지난 게임", 1);
    const drafted = await addGame(db, "초안 주 게임", 2);
    const rested = await addGame(db, "휴방 날 게임", 3);
    await addGame(db, "기록 없는 게임", 4);

    await db.insert(scheduleWeeks).values({ weekStartDate: "2026-09-28", draft: true });
    await db.insert(scheduleDays).values({ scheduledDate: "2026-09-22", rest: true });
    await db.insert(scheduleEntries).values([
      { scheduledDate: "2026-09-15", title: "지난 방송", gameId: older },
      { scheduledDate: "2026-09-29", title: "초안 방송", gameId: drafted },
      { scheduledDate: "2026-09-22", title: "쉬는 날", gameId: rested },
    ]);

    expect((await loadHomeHub(db, SAT))!.recentGame).toBe("지난 게임");
  });

  /* 행이 **있는데** 값이 없는 경우를 따로 본다 — 행이 아예 없을 때(위 빈 저장소)와 갈래가 다르다.
     주 메타 행은 청구만으로도 생기고(claimWeek), 게임은 일정 없이도 보드에 있다. */
  it("주 행이 있어도 발행 시각이 없으면 준비 중, 게임이 있어도 기록이 없으면 최근 게임은 없다", async () => {
    const db = makeDb(env.DB);
    await db.insert(scheduleWeeks).values({ weekStartDate: "2026-09-28" });
    await addGame(db, "기록 없는 게임", 1);
    expect(await loadHomeHub(db, SAT)).toEqual({
      weekRange: "9.28 – 10.4",
      scheduleState: "준비 중",
      recentGame: null,
    });
  });

  /* 상태 줄은 부가 정보다 — 조회가 던지면 홈이 500 이 아니라 상태 줄만 빠져야 한다. 그리고
     모르는 걸 "준비 중"으로 위장하지 않는다(null). */
  it("조회가 실패하면 null 을 돌려주고 던지지 않는다", async () => {
    const broken = {
      select: () => {
        throw new Error("D1 down");
      },
    } as unknown as Db;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadHomeHub(broken, SAT)).resolves.toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
