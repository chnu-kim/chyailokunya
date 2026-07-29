import { describe, expect, it } from "vitest";
import type { ScheduleEntry } from "@/db";
import { buildWeekCard } from "./card";
import type { WeekView } from "./service";

const MON = "2026-07-20"; // 월요일

let nextId = 1;
function entry(over: Partial<ScheduleEntry> & { scheduledDate: string }): ScheduleEntry {
  return {
    id: nextId++,
    title: "제목",
    gameId: null,
    createdAt: 0,
    lastUpdatedAt: 0,
    ...over,
  };
}

function week(over: Partial<WeekView> = {}): WeekView {
  return {
    weekStartDate: MON,
    note: null,
    publishedAt: null,
    draft: false,
    days: [],
    fanartImageUrl: null,
    fanartCredit: null,
    revision: 1,
    entries: [],
    ...over,
  };
}

describe("buildWeekCard", () => {
  it("주 범위 라벨과 요일 라벨을 weekDates 순서 그대로 접는다", () => {
    const card = buildWeekCard(week());
    expect(card.rangeLabel).toBe("7.20 – 7.26");
    expect(card.days.map((d) => d.dow)).toEqual(["월", "화", "수", "목", "금", "토", "일"]);
    expect(card.days.map((d) => d.date)).toEqual([
      "7.20",
      "7.21",
      "7.22",
      "7.23",
      "7.24",
      "7.25",
      "7.26",
    ]);
  });

  it("공지는 그대로 넘긴다(null 도 그대로)", () => {
    expect(buildWeekCard(week({ note: "공지" })).note).toBe("공지");
    expect(buildWeekCard(week({ note: null })).note).toBeNull();
  });

  it("항목 없는 날은 빈 배열 · overflow 0", () => {
    const card = buildWeekCard(week());
    for (const day of card.days) {
      expect(day.entries).toEqual([]);
      expect(day.overflow).toBe(0);
    }
  });

  it("하루 여러 항목 — 정렬은 입력 순서를 그대로 믿는다(SQL 이 이미 정렬)", () => {
    const entries = [
      entry({ scheduledDate: "2026-07-21", title: "저챗" }),
      entry({ scheduledDate: "2026-07-21", title: "심야 게임" }),
    ];
    const card = buildWeekCard(week({ entries }));
    const tue = card.days[1]!;
    expect(tue.entries).toEqual([{ title: "저챗" }, { title: "심야 게임" }]);
    expect(tue.overflow).toBe(0);
  });

  it("다른 날 항목은 안 섞인다 — scheduledDate 로만 가른다", () => {
    const entries = [
      entry({ scheduledDate: "2026-07-20", title: "월요일 것" }),
      entry({ scheduledDate: "2026-07-26", title: "일요일 것" }),
    ];
    const card = buildWeekCard(week({ entries }));
    expect(card.days[0]!.entries).toEqual([{ title: "월요일 것" }]);
    expect(card.days[6]!.entries).toEqual([{ title: "일요일 것" }]);
    for (const i of [1, 2, 3, 4, 5]) expect(card.days[i]!.entries).toEqual([]);
  });

  it("상한(4)을 넘는 항목은 잘리고 overflow 로 남는다", () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      entry({ scheduledDate: "2026-07-22", title: `항목 ${i + 1}` }),
    );
    const card = buildWeekCard(week({ entries }));
    const wed = card.days[2]!;
    expect(wed.entries).toHaveLength(4);
    expect(wed.entries.map((e) => e.title)).toEqual(["항목 1", "항목 2", "항목 3", "항목 4"]);
    expect(wed.overflow).toBe(2);
  });

  it("상한과 정확히 같으면 overflow 없다 — 경계 값", () => {
    const entries = Array.from({ length: 4 }, (_, i) =>
      entry({ scheduledDate: "2026-07-23", title: `항목 ${i + 1}` }),
    );
    const card = buildWeekCard(week({ entries }));
    expect(card.days[3]!.entries).toHaveLength(4);
    expect(card.days[3]!.overflow).toBe(0);
  });

  it("weekStartDate 가 월요일이 아니어도 그 주의 월요일부터 접힌다(weekDates 의 정규화)", () => {
    // getWeekForEdit 은 이 필드를 호출자 인자 그대로 echo 한다 — 월요일이 아닌 값이 들어올 수
    // 있다. entries 도 같은 정규화(weekBounds)를 거쳐 쿼리됐으므로 목요일을 넣어도 월~일이
    // 나와야 entries 와 days 가 어긋나지 않는다.
    const entries = [entry({ scheduledDate: "2026-07-20", title: "월요일 것" })];
    const card = buildWeekCard(week({ weekStartDate: "2026-07-23" /* 목요일 */, entries }));
    expect(card.rangeLabel).toBe("7.20 – 7.26");
    expect(card.days.map((d) => d.date)).toEqual([
      "7.20",
      "7.21",
      "7.22",
      "7.23",
      "7.24",
      "7.25",
      "7.26",
    ]);
    expect(card.days[0]!.entries).toEqual([{ title: "월요일 것" }]);
  });
});
