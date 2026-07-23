import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addWeeks,
  isIsoDate,
  toIsoDate,
  todayKST,
  WEEKDAY_LABELS,
  weekDates,
  weekStartOf,
  type IsoDate,
} from "./calendar";

/* 테스트 안에서만 쓰는 승격. 프로덕션 경로는 toIsoDate(검증)를 지나지만, 여기선 "이미 옳은
   리터럴"을 매번 검증시킬 이유가 없어 캐스팅으로 짧게 쓴다. */
const d = (s: string) => s as IsoDate;

describe("isIsoDate", () => {
  it("실재하는 YYYY-MM-DD 는 통과", () => {
    expect(isIsoDate("2026-07-20")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true); // 윤년
    expect(isIsoDate("1999-12-31")).toBe(true);
  });

  it("형식만 맞고 실재하지 않는 날짜는 거절", () => {
    // overflow:'reject' 가 없으면 Temporal 도 Date 처럼 말일로 붙여 통과시킨다.
    for (const bad of [
      "2026-02-31",
      "2026-02-30",
      "2025-02-29", // 평년
      "2026-04-31",
      "2026-13-01",
      "2026-00-10",
      "2026-07-00",
      "2026-07-32",
    ]) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });

  it("Temporal 이 받아 주는 확장 표기도 거절 — 형태가 하나여야 정렬·비교가 선다", () => {
    // 이 값들은 Temporal.PlainDate.from 이 멀쩡히 파싱한다. 그대로 통과시키면 DB 에
    // 사전순 정렬이 깨지는 문자열이 섞여 들어간다('+002026-…' 은 '2026-…' 보다 작다).
    for (const bad of [
      "+002026-07-20",
      "2026-07-20T00:00",
      "2026-07-20T00:00:00Z",
      "2026-07-20[Asia/Seoul]",
      "20260720",
    ]) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });

  it("형식이 어긋나거나 문자열이 아니면 거절", () => {
    for (const bad of ["2026-7-20", "26-07-20", "2026/07/20", "", "  "]) {
      expect(isIsoDate(bad)).toBe(false);
    }
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
    expect(isIsoDate(20260720)).toBe(false);
    expect(isIsoDate(new Date())).toBe(false);
  });
});

describe("toIsoDate", () => {
  it("옳은 값은 그대로 돌려준다", () => {
    expect(toIsoDate("2026-07-20")).toBe("2026-07-20");
  });

  it("틀린 값은 던진다 — 폴백으로 눙치면 버그가 정상 화면으로 위장된다", () => {
    expect(() => toIsoDate("2026-02-31")).toThrow(TypeError);
    expect(() => toIsoDate("어제")).toThrow(TypeError);
  });
});

describe("todayKST", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /* 이 두 케이스가 "KST 로 읽는다"는 도메인 약속을 못박는다. UTC 로 계산했다면 둘 다
     7-23 이 나오고, 서버(Workers·UTC)에서 자정 직후에 만든 일정이 하루 앞 주에 붙는다. */
  it("KST 자정 직전은 아직 그날", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T14:59:59Z")); // KST 23:59:59
    expect(todayKST()).toBe("2026-07-23");
  });

  it("KST 자정을 넘기면 다음 날 — UTC 로는 아직 같은 날이다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T15:00:00Z")); // KST 00:00
    expect(todayKST()).toBe("2026-07-24");
  });

  it("형식은 YYYY-MM-DD", () => {
    expect(isIsoDate(todayKST())).toBe(true);
  });
});

describe("weekStartOf", () => {
  it("월요일은 자기 자신", () => {
    expect(weekStartOf(d("2026-07-20"))).toBe("2026-07-20");
  });

  it("주 안의 어느 날이든 같은 월요일로 모인다", () => {
    // 2026-07-20(월) ~ 07-26(일)
    for (const day of [
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]) {
      expect(weekStartOf(d(day))).toBe("2026-07-20");
    }
  });

  it("일요일은 6일 전 월요일 — 주의 끝이지 시작이 아니다", () => {
    // 일요일을 주의 시작으로 보는 관습(미국식)과 갈리는 자리라 따로 못박는다.
    expect(weekStartOf(d("2026-07-26"))).toBe("2026-07-20");
    expect(weekStartOf(d("2026-07-27"))).toBe("2026-07-27"); // 다음 월요일
  });

  it("달·해를 거슬러 올라간다", () => {
    expect(weekStartOf(d("2026-08-01"))).toBe("2026-07-27"); // 토 → 7월로
    expect(weekStartOf(d("2027-01-01"))).toBe("2026-12-28"); // 금 → 전해로
    expect(weekStartOf(d("2024-03-01"))).toBe("2024-02-26"); // 윤년 2/29 를 지나
  });
});

describe("weekDates", () => {
  it("월요일부터 일요일까지 7일", () => {
    expect(weekDates(d("2026-07-20"))).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]);
  });

  it("주 시작이 아닌 날을 줘도 같은 주가 나온다 — 호출자가 weekStartOf 를 기억할 필요가 없다", () => {
    const fromMonday = weekDates(d("2026-07-20"));
    for (const day of ["2026-07-23", "2026-07-26"]) {
      expect(weekDates(d(day))).toEqual(fromMonday);
    }
  });

  it("달·해 경계를 넘는 주도 이어 붙는다", () => {
    expect(weekDates(d("2026-12-31"))).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });

  it("윤일을 건너뛰지 않는다", () => {
    expect(weekDates(d("2024-02-29"))).toContain("2024-02-29");
    expect(weekDates(d("2024-02-29"))).toEqual([
      "2024-02-26",
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
      "2024-03-02",
      "2024-03-03",
    ]);
  });
});

describe("addWeeks", () => {
  it("앞뒤로 옮긴다", () => {
    expect(addWeeks(d("2026-07-20"), 1)).toBe("2026-07-27");
    expect(addWeeks(d("2026-07-20"), -1)).toBe("2026-07-13");
    expect(addWeeks(d("2026-07-20"), 0)).toBe("2026-07-20");
  });

  it("달·해를 넘긴다", () => {
    expect(addWeeks(d("2026-12-28"), 1)).toBe("2027-01-04");
    expect(addWeeks(d("2027-01-04"), -1)).toBe("2026-12-28");
    expect(addWeeks(d("2026-07-20"), 52)).toBe("2027-07-19");
  });

  it("주 시작에 적용하면 결과도 주 시작이다 — 주 이동 UI 가 기대는 성질", () => {
    let week = weekStartOf(d("2026-07-23"));
    for (let i = 0; i < 60; i++) {
      week = addWeeks(week, 1);
      expect(weekStartOf(week)).toBe(week);
    }
  });
});

describe("WEEKDAY_LABELS", () => {
  it("weekDates 의 순서와 맞는다", () => {
    // 라벨이 따로 살면 주의 시작을 바꾸는 날 한쪽만 고쳐도 게이트가 초록이다.
    // 2026-07-20 이 월요일이라는 사실을 앵커로 둔다.
    expect(WEEKDAY_LABELS).toHaveLength(weekDates(d("2026-07-20")).length);
    expect(WEEKDAY_LABELS[0]).toBe("월");
    expect(WEEKDAY_LABELS[6]).toBe("일");
  });
});
