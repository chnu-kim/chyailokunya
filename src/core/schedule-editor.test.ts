import { describe, expect, it } from "vitest";
import {
  addEntry,
  dayOf,
  DEFAULT_START_TIME,
  draftDayInputs,
  draftHasContent,
  setDay,
  draftEntryInputs,
  entriesForDate,
  firstBlankTitleEntry,
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
  return {
    note: "",
    published: false,
    entries: [],
    days: {},
    fanartImageKey: null,
    fanartCredit: "",
    ...over,
  };
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

describe("makeDraftEntry", () => {
  it("항목은 시각을 안 든다 — 시각은 하루의 속성이다", () => {
    expect(makeDraftEntry("new-0", MON)).toEqual({
      key: "new-0",
      scheduledDate: MON,
      title: "",
      gameId: null,
    });
  });
});

describe("하루 속성 — 시각·휴방", () => {
  it("키가 없는 날은 기본값(시각 미정·휴방 아님)이다", () => {
    expect(dayOf(draft(), MON)).toEqual({ startTime: "", rest: false });
  });

  it("setDay 는 원본을 안 건드리고 그 날짜만 바꾼다", () => {
    const d0 = draft();
    const d1 = setDay(d0, MON, { startTime: "21:00" });
    expect(d0.days).toEqual({}); // 불변
    expect(dayOf(d1, MON).startTime).toBe("21:00");
    expect(dayOf(d1, WED)).toEqual({ startTime: "", rest: false });
  });

  it("기본값으로 되돌아가면 키를 지운다 — 켰다 끈 휴방이 dirty 로 남으면 안 된다", () => {
    const on = setDay(draft(), MON, { rest: true });
    expect(Object.keys(on.days)).toEqual([MON]);
    const off = setDay(on, MON, { rest: false });
    expect(off.days).toEqual({});
    expect(isWeekDirty(off, draft())).toBe(false);
  });

  it("그날 첫 항목을 더하면 시각 기본값이 선다(결정 20 승계)", () => {
    const d = addEntry(draft(), makeDraftEntry("new-0", MON));
    expect(dayOf(d, MON).startTime).toBe(DEFAULT_START_TIME);
  });

  it("이미 정해 둔 시각은 두 번째 항목이 안 되돌린다", () => {
    const d0 = setDay(draft(), MON, { startTime: "22:00" });
    const d1 = addEntry(d0, makeDraftEntry("new-0", MON));
    expect(dayOf(d1, MON).startTime).toBe("22:00");
  });

  it("휴방인 날엔 시각을 안 세운다 — 쉬는 날의 시작 시각은 뜻이 안 맞는다", () => {
    const d = addEntry(setDay(draft(), MON, { rest: true }), makeDraftEntry("new-0", MON));
    expect(dayOf(d, MON).startTime).toBe("");
  });
});

describe("휴방을 켜는 순간 빈 항목을 지운다 — 결정 30(라이브 저장 차단 해소)", () => {
  it("제목도 게임도 없는 자리표시자만 지운다 — 제목이 채워진 항목은 잠긴 채 보존된다", () => {
    const d0 = draft({
      entries: [
        entry("blank", { title: "  " }), // 공백만, 게임도 없음 — 지워진다
        entry("filled", { title: "젤다" }), // 채워짐 — 보존
      ],
    });
    const d1 = setDay(d0, MON, { rest: true });
    expect(d1.entries.map((e) => e.key)).toEqual(["filled"]);
  });

  /* codex adversarial-review 지적(2026-07-31) — 초판은 title 만 보고 지웠는데, 제목 입력이
     title 필드만 patch 하므로(schedule-editor.tsx) 게임을 연결한 뒤 제목만 지우는 조합이
     실제로 가능하다. 그 항목까지 지우면 게임 연결이 화면 신호 없이 사라진다 — "빈 항목"은
     제목이 아니라 **내용**(제목 또는 게임)이 없는가로 판단해야 한다. */
  it("제목은 비었어도 게임이 연결된 항목은 지우지 않는다 — 게임 연결도 내용이다", () => {
    const d0 = draft({ entries: [entry("linked", { title: "", gameId: 7 })] });
    const d1 = setDay(d0, MON, { rest: true });
    expect(d1.entries.map((e) => e.key)).toEqual(["linked"]);
  });

  it("다른 날 항목은 안 건드린다", () => {
    const d0 = draft({ entries: [entry("other", { scheduledDate: WED, title: "" })] });
    const d1 = setDay(d0, MON, { rest: true });
    expect(d1.entries.map((e) => e.key)).toEqual(["other"]);
  });

  it("이미 휴방인 날에 다시 rest:true 를 보내도 멱등이다(전이가 아니라 유지)", () => {
    const on = setDay(draft(), MON, { rest: true });
    const onAgain = setDay(on, MON, { rest: true });
    expect(onAgain.entries).toEqual(on.entries);
  });

  it("휴방을 끄는 전이는 지우지 않는다 — 지우는 대상은 '켜는' 전이뿐이다", () => {
    const d0 = draft({ entries: [entry("blank", { title: "" })] });
    const on = setDay(d0, MON, { rest: true }); // 켜는 전이 — 지워진다
    expect(on.entries).toHaveLength(0);
    const off = setDay(on, MON, { rest: false });
    // 이미 지워졌으니 끄는 전이에서 새로 지울 것도 없다 — 빈 배열 그대로.
    expect(off.entries).toHaveLength(0);
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
    const next = updateEntry(d, "b", { title: "B2", gameId: 7 });
    expect(next.entries[1]).toMatchObject({ key: "b", title: "B2", gameId: 7 });
    expect(next.entries[0]!.title).toBe("A"); // 남은 건 그대로
  });
});

describe("entriesForDate — 하루 안 정렬(서버 ORDER BY 짝)", () => {
  /* 시각이 하루로 올라가(이슈 #117) 항목별 정렬 키가 사라졌다 — 남은 규칙은 "먼저 더한 게
     먼저" 하나이고, 서버 getWeekForEdit 의 `날짜 · id` 와 같은 뜻이다. */
  it("다른 날 항목은 안 섞이고, 더한 순서를 지킨다", () => {
    const d = draft({
      entries: [
        entry("a", { scheduledDate: WED, title: "수요일" }),
        entry("b", { scheduledDate: MON, title: "먼저" }),
        entry("c", { scheduledDate: MON, title: "나중" }),
      ],
    });
    expect(entriesForDate(d, MON).map((e) => e.title)).toEqual(["먼저", "나중"]);
    expect(entriesForDate(d, WED).map((e) => e.title)).toEqual(["수요일"]);
  });
});

describe("firstBlankTitleEntry — 저장 전 가드", () => {
  it("빈 항목이 없으면 null", () => {
    const d = draft({ entries: [entry("a", { title: "젤다" }), entry("b", { title: "저챗" })] });
    expect(firstBlankTitleEntry(d)).toBeNull();
  });

  it("공백만 있는 제목도 빈 항목으로 잡는다", () => {
    const d = draft({ entries: [entry("a", { title: "  " })] });
    expect(firstBlankTitleEntry(d)?.key).toBe("a");
  });

  it("여러 개 중 먼저 더한 것 하나만 돌려준다", () => {
    const d = draft({
      entries: [
        entry("a", { title: "젤다" }),
        entry("b", { title: "" }),
        entry("c", { title: "" }),
      ],
    });
    expect(firstBlankTitleEntry(d)?.key).toBe("b");
  });

  /* 결정 30 — 휴방인 날도 이 가드를 안 건너뛴다(초판은 건너뛰게 했다가 codex adversarial-review
     지적으로 되돌렸다). setDay 가 "아직 아무것도 아닌" 자리표시자는 휴방을 켜는 순간 이미
     지우므로, 정상 경로로 휴방인 날에 남는 빈 제목 항목은 **게임은 연결됐지만 제목만 지운**
     항목뿐이다 — 그 항목을 가드가 안 잡으면 draftEntryInputs 가 title 만 보고 걸러내 게임
     연결이 화면 신호 없이 사라진다. 휴방이어도 삭제는 결정 27 부터 열려 있으므로, 가드가
     막아도 막다른 골목이 아니라 "지워야 한다"는 정확한 안내다. */
  it("휴방인 날도 안 건너뛴다 — 게임은 연결됐지만 제목만 지운 항목은 계속 걸린다", () => {
    const d = draft({
      days: { [MON]: { startTime: "", rest: true } },
      entries: [entry("linked", { title: "", gameId: 7 })],
    });
    expect(firstBlankTitleEntry(d)?.key).toBe("linked");
  });
});

describe("draftEntryInputs — 저장 페이로드", () => {
  it("제목 trim, 빈 제목은 버린다", () => {
    const d = draft({
      entries: [
        entry("a", { title: "  젤다  ", gameId: 3 }),
        entry("b", { title: "저챗" }),
        entry("c", { title: "   " }), // 빈 제목 → 버려진다
      ],
    });
    expect(draftEntryInputs(d)).toEqual([
      { scheduledDate: MON, title: "젤다", gameId: 3 },
      { scheduledDate: MON, title: "저챗", gameId: null },
    ]);
  });
});

describe("draftDayInputs — 하루 저장 페이로드", () => {
  it("기본값인 날은 빼고, 시각 '' 는 null 로 접고, 날짜순으로 낸다", () => {
    let d = draft();
    d = setDay(d, WED, { rest: true });
    d = setDay(d, MON, { startTime: "21:00" });
    expect(draftDayInputs(d)).toEqual([
      { scheduledDate: MON, startTime: "21:00", rest: false },
      { scheduledDate: WED, startTime: null, rest: true },
    ]);
  });
});

describe("draftHasContent — 발행 가능 여부의 판단축", () => {
  it("항목도 휴방도 없으면 비었다", () => {
    expect(draftHasContent(draft())).toBe(false);
    // 시각만 정한 날은 "정해 둔 것"이 아니다 — 그 시각에 무엇을 할지가 아직 없다.
    expect(draftHasContent(setDay(draft(), MON, { startTime: "19:00" }))).toBe(false);
  });

  it("휴방만 있어도 짠 주다 — 항목 0 이라고 빈 주가 아니다(결정 9)", () => {
    expect(draftHasContent(setDay(draft(), MON, { rest: true }))).toBe(true);
  });

  it("제목이 빈 항목만 있으면 비었다 — 저장에 안 실리는 값이다", () => {
    expect(draftHasContent(draft({ entries: [entry("a", { title: "  " })] }))).toBe(false);
  });
});

describe("isWeekDirty — 저장하면 달라지는가", () => {
  it("같은 값이면 깨끗(key 무관, 빈 항목 무시)", () => {
    const a = draft({
      note: "공지",
      entries: [
        entry("db-1", { title: "젤다", scheduledDate: MON }),
        entry("db-2", { title: "저챗", scheduledDate: WED }),
      ],
    });
    const b = draft({
      note: "공지",
      entries: [
        entry("new-8", { title: "젤다", scheduledDate: MON }), // 다른 key, 같은 순서
        entry("new-9", { title: "저챗", scheduledDate: WED }),
        entry("new-7", { title: "  " }), // 빈 항목 — 저장에 안 실려 무시
      ],
    });
    expect(isWeekDirty(a, b)).toBe(false);
  });

  it("같은 날 항목의 순서만 바뀌어도 dirty — 순서가 저장되는 값이다", () => {
    /* 시각이 하루로 올라가기 전에는 하루 안 정렬을 시각이 결정해 배열 순서가 저장 결과에
       안 남았다. 이제는 순서가 곧 표시·저장 순서라(entriesForDate·서버 ORDER BY 가 둘 다
       입력 순), 순서만 바꾼 편집이 dirty 로 안 잡히면 저장 버튼이 잠긴 채 새 순서를 영영
       못 남긴다(코드 리뷰 지적). */
    const a = draft({
      entries: [
        entry("a", { title: "저챗", scheduledDate: MON }),
        entry("b", { title: "젤다", scheduledDate: MON }),
      ],
    });
    const b = draft({
      entries: [
        entry("b", { title: "젤다", scheduledDate: MON }),
        entry("a", { title: "저챗", scheduledDate: MON }),
      ],
    });
    expect(isWeekDirty(a, b)).toBe(true);
  });

  it("note·published·항목 내용이 바뀌면 dirty", () => {
    const base = draft({ note: "공지", entries: [entry("a", { title: "젤다" })] });
    expect(isWeekDirty(base, draft({ note: "다른 공지", entries: base.entries }))).toBe(true);
    expect(isWeekDirty(base, { ...base, published: true })).toBe(true);
    expect(
      isWeekDirty(base, draft({ note: "공지", entries: [entry("a", { title: "메트로이드" })] })),
    ).toBe(true);
  });

  it("팬아트 둘이 다 dirty 에 든다 — 하나라도 빼면 그림을 올려도 저장 버튼이 안 열린다", () => {
    /* 업로드는 그 자체로 아무 주에도 안 걸린다(저장이 반영한다) — 그래서 이 판정이 안 잡으면
       올린 객체가 어디에도 안 걸린 채 고아로 남는다. 하루 속성이 겪은 자리와 같다(이슈 #117).
       **치수는 draft 에 없다**: 저장에 안 실리므로(ADR-0030) 이 판정의 대상이 아니다. */
    const KEY = "0189d1f0-3a4b-7c8d-9e0f-1a2b3c4d5e6f.png";
    const base = draft();
    expect(isWeekDirty(draft({ fanartImageKey: KEY }), base)).toBe(true);
    expect(isWeekDirty(draft({ fanartImageKey: KEY, fanartCredit: "그린 사람" }), base)).toBe(true);

    // 표기는 note 와 같은 trim 정규형이라 공백만 다른 값은 dirty 가 아니다.
    expect(
      isWeekDirty(draft({ fanartImageKey: KEY, fanartCredit: "  그린 사람  " }), {
        ...base,
        fanartImageKey: KEY,
        fanartCredit: "그린 사람",
      }),
    ).toBe(false);
  });
});
