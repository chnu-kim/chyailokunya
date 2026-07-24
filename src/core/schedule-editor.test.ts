import { describe, expect, it } from "vitest";
import {
  addEntry,
  draftEntryInputs,
  entriesForDate,
  isWeekDirty,
  makeDraftEntry,
  newEntryKey,
  removeEntry,
  updateEntry,
  type WeekDraft,
} from "./schedule-editor";

/* 주간 편집기 순수 전이. DOM 없이 "더하면·빼면·고치면 무엇이 되는가"를 못박는다(이슈 #56). */

const MON = "2026-07-20"; // 월요일
const WED = "2026-07-22";

function draft(over: Partial<WeekDraft> = {}): WeekDraft {
  return { note: "", published: false, entries: [], ...over };
}

function entry(key: string, over: Partial<ReturnType<typeof makeDraftEntry>> = {}) {
  return { ...makeDraftEntry(key, MON), ...over };
}

describe("newEntryKey", () => {
  it("seq 로 충돌 없는 안정 키를 낸다", () => {
    expect(newEntryKey(0)).toBe("new-0");
    expect(newEntryKey(3)).not.toBe(newEntryKey(4));
  });
});

describe("항목 전이", () => {
  it("addEntry 는 원본을 안 건드리고 새 배열을 낸다", () => {
    const d0 = draft();
    const d1 = addEntry(d0, entry("new-0", { title: "젤다" }));
    expect(d0.entries).toHaveLength(0); // 불변
    expect(d1.entries.map((e) => e.title)).toEqual(["젤다"]);
  });

  it("removeEntry 는 그 키만 뺀다", () => {
    const d = draft({ entries: [entry("a", { title: "A" }), entry("b", { title: "B" })] });
    expect(removeEntry(d, "a").entries.map((e) => e.title)).toEqual(["B"]);
  });

  it("updateEntry 는 지목한 항목의 필드만 바꾸고 key 는 못 바꾼다", () => {
    const d = draft({ entries: [entry("a", { title: "A" }), entry("b", { title: "B" })] });
    const next = updateEntry(d, "b", { title: "B2", startTime: "20:00" });
    expect(next.entries[1]).toMatchObject({ key: "b", title: "B2", startTime: "20:00" });
    expect(next.entries[0]!.title).toBe("A"); // 남은 건 그대로
  });
});

describe("entriesForDate — 하루 안 정렬(서버 ORDER BY 짝)", () => {
  it("시각 있는 항목 먼저(오름차순), 미정은 끝", () => {
    const d = draft({
      entries: [
        entry("a", { scheduledDate: MON, startTime: "", title: "미정" }),
        entry("b", { scheduledDate: MON, startTime: "20:00", title: "밤" }),
        entry("c", { scheduledDate: MON, startTime: "14:00", title: "오후" }),
      ],
    });
    expect(entriesForDate(d, MON).map((e) => e.title)).toEqual(["오후", "밤", "미정"]);
  });

  it("다른 날 항목은 안 섞이고, 같은 시각은 더한 순서를 지킨다(안정 정렬)", () => {
    const d = draft({
      entries: [
        entry("a", { scheduledDate: WED, startTime: "10:00", title: "수요일" }),
        entry("b", { scheduledDate: MON, startTime: "10:00", title: "먼저" }),
        entry("c", { scheduledDate: MON, startTime: "10:00", title: "나중" }),
      ],
    });
    expect(entriesForDate(d, MON).map((e) => e.title)).toEqual(["먼저", "나중"]);
  });
});

describe("draftEntryInputs — 저장 페이로드", () => {
  it("제목 trim·시각 '' → null, 빈 제목은 버린다", () => {
    const d = draft({
      entries: [
        entry("a", { title: "  젤다  ", startTime: "20:00", gameId: 3 }),
        entry("b", { title: "저챗", startTime: "" }),
        entry("c", { title: "   " }), // 빈 제목 → 버려진다
      ],
    });
    expect(draftEntryInputs(d)).toEqual([
      { scheduledDate: MON, startTime: "20:00", title: "젤다", gameId: 3 },
      { scheduledDate: MON, startTime: null, title: "저챗", gameId: null },
    ]);
  });
});

describe("isWeekDirty — 저장하면 달라지는가", () => {
  it("같은 값이면 깨끗(순서·key 무관, 빈 항목 무시)", () => {
    const a = draft({
      note: "공지",
      entries: [
        entry("db-1", { title: "젤다", startTime: "20:00", scheduledDate: MON }),
        entry("db-2", { title: "저챗", scheduledDate: WED }),
      ],
    });
    const b = draft({
      note: "공지",
      entries: [
        entry("new-9", { title: "저챗", scheduledDate: WED }), // 순서 뒤바뀜·다른 key
        entry("new-8", { title: "젤다", startTime: "20:00", scheduledDate: MON }),
        entry("new-7", { title: "  " }), // 빈 항목 — 저장에 안 실려 무시
      ],
    });
    expect(isWeekDirty(a, b)).toBe(false);
  });

  it("note·published·항목 내용이 바뀌면 dirty", () => {
    const base = draft({ note: "공지", entries: [entry("a", { title: "젤다" })] });
    expect(isWeekDirty(base, draft({ note: "다른 공지", entries: base.entries }))).toBe(true);
    expect(isWeekDirty(base, { ...base, published: true })).toBe(true);
    expect(
      isWeekDirty(base, draft({ note: "공지", entries: [entry("a", { title: "메트로이드" })] })),
    ).toBe(true);
  });
});
