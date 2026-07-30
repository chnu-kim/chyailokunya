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
    revision: 1,
    fanartImageKey: null,
    fanartCredit: null,
    fanartImageWidth: null,
    fanartImageHeight: null,
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

  describe("팬아트(이슈 #122)", () => {
    it("키가 있으면 카드 안에 담고 표기를 함께 싣는다", () => {
      const card = buildWeekCard(
        week({ fanartImageKey: "abc.png", fanartCredit: "그림 · @someone" }),
      );
      expect(card.fanart).toEqual({ imageKey: "abc.png", credit: "그림 · @someone", size: null });
    });

    it("키가 없으면 fanart 자체가 null — 표기만 남아 있어도 그렇다", () => {
      /* 저장 경계가 "표기만 있는 행"을 막지만(schema.ts), 카드는 그 불변식에 기대지 않고
         키 하나로만 판정한다 — 사진지 없이 표기만 뜨는 화면은 어떤 경로로도 못 만들어야 한다. */
      expect(buildWeekCard(week({ fanartImageKey: null })).fanart).toBeNull();
      expect(
        buildWeekCard(week({ fanartImageKey: null, fanartCredit: "그림 · @someone" })).fanart,
      ).toBeNull();
    });

    it('표기의 빈 값은 null 로 정규화한다 — 편집기(`""`)와 읽기(null)의 기준을 여기서 합친다', () => {
      /* WeekDraft.fanartCredit 은 `string`(빈 값이 `""`)이고 WeekView 는 `string | null` 이다.
         그대로 넘기면 편집기 미리보기에만 빈 표기 줄이 생겨 사진지 아래가 벌어진다. */
      expect(buildWeekCard(week({ fanartImageKey: "abc.png", fanartCredit: "" })).fanart).toEqual({
        imageKey: "abc.png",
        credit: null,
        size: null,
      });
      expect(
        buildWeekCard(week({ fanartImageKey: "abc.png", fanartCredit: "   " })).fanart,
      ).toEqual({ imageKey: "abc.png", credit: null, size: null });
    });

    it("표기의 앞뒤 공백은 떼고 싣는다", () => {
      expect(
        buildWeekCard(week({ fanartImageKey: "abc.png", fanartCredit: "  @someone  " })).fanart
          ?.credit,
      ).toBe("@someone");
    });

    it("치수는 쌍으로만 실린다 — 반쪽이면 통째로 null 이다", () => {
      /* 반쪽(폭만)을 주면 브라우저가 비율을 잘못 잡아 그림이 늘어난다. 저장 경계가 이미 쌍을
         강제하지만(ADR-0030 의 세 층), 카드는 그 불변식에 기대지 않고 여기서 한 번 더 접는다. */
      expect(
        buildWeekCard(
          week({ fanartImageKey: "abc.png", fanartImageWidth: 1200, fanartImageHeight: 1600 }),
        ).fanart?.size,
      ).toEqual({ width: 1200, height: 1600 });

      for (const half of [
        { fanartImageWidth: 1200, fanartImageHeight: null },
        { fanartImageWidth: null, fanartImageHeight: 1600 },
        { fanartImageWidth: null, fanartImageHeight: null },
      ]) {
        expect(buildWeekCard(week({ fanartImageKey: "abc.png", ...half })).fanart?.size).toBeNull();
      }
    });
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
