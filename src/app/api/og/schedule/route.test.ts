import { describe, expect, it } from "vitest";
import type { WeekCard } from "@/features/schedule/card";
import { collectFontText, EMPTY_DAY_MARK } from "./route";

/* collectFontText 는 Satori(next/og)에 넘길 폰트 서브셋의 글자 목록을 정한다 — 여기서 빠진
   글자는 렌더에서 다른 폰트로 대체되며 조용히 두부(□)로 나온다(실측으로 두 번 걸림: "…" 와
   EMPTY_DAY_MARK, AGENTS.md 주간 일정 지뢰 목록·이 파일 route.tsx 의 collectFontText 주석
   참고). 상태 코드·content-type 만 보는 e2e 는 이 결함을 못 잡으므로, "렌더가 실제로 그리는
   글자가 전부 수집됐는가"를 여기서 문자열 비교로 직접 못박는다. */

function card(over: Partial<WeekCard> = {}): WeekCard {
  return {
    rangeLabel: "7.20 – 7.26",
    note: null,
    days: Array.from({ length: 7 }, (_, i) => ({
      dow: "월",
      date: `7.${20 + i}`,
      entries: [],
      overflow: 0,
    })),
    ...over,
  };
}

describe("collectFontText — 항목 없는 날", () => {
  it("EMPTY_DAY_MARK 를 bodyText 에 담는다 — 렌더가 실제로 그리는 글자다", () => {
    const { bodyText } = collectFontText(card());
    expect(bodyText).toContain(EMPTY_DAY_MARK);
  });

  it("빈 날이 하나도 없으면 EMPTY_DAY_MARK 를 안 담는다 — 안 쓰는 글리프를 미리 담지 않는다", () => {
    const days = card().days.map((d, i) => ({
      ...d,
      entries: [{ time: "20:00", title: `항목 ${i}` }],
    }));
    const { bodyText } = collectFontText(card({ days }));
    expect(bodyText).not.toContain(EMPTY_DAY_MARK);
  });
});

describe("collectFontText — 그 밖의 렌더 문자열", () => {
  it("범위·요일·날짜·시각·제목·공지·오버플로 칩을 전부 담는다", () => {
    const days = card().days.map((d, i) => {
      if (i === 3) return { ...d, entries: [{ time: "21:00", title: "저챗" }], overflow: 2 };
      return d;
    });
    const { penText, bodyText } = collectFontText(card({ note: "공지 문구", days }));

    expect(penText).toContain("월"); // WEEKDAY_LABELS
    expect(bodyText).toContain("7.20 – 7.26"); // rangeLabel
    expect(bodyText).toContain("7.23"); // 넷째 날 date
    expect(bodyText).toContain("21:00");
    expect(bodyText).toContain("저챗");
    expect(bodyText).toContain("공지 문구");
    expect(bodyText).toContain("+2개");
  });
});
