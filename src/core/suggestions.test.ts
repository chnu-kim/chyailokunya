import { describe, expect, it } from "vitest";
import {
  diffSuggestion,
  initialPlayDateFor,
  isEmptyEditSuggestion,
  isPlayDateApplied,
  isSuggestedValuesValid,
  type CurrentValues,
  type SuggestedValues,
} from "./suggestions";

// 안 깬 게임 + 플레이 기록 하나. 대부분의 제안이 이 상태에서 출발한다.
const current: CurrentValues = { cleared: false, clearedDate: null, lastPlayed: "2026-07-11" };
const same: SuggestedValues = { cleared: false, clearedDate: null, playedDate: "2026-07-11" };

describe("diffSuggestion", () => {
  it("지금 값과 같으면 아무 변경도 없다", () => {
    expect(diffSuggestion(current, same)).toEqual([]);
  });

  it("클리어를 켜면서 날짜를 붙이면 두 줄이다", () => {
    expect(
      diffSuggestion(current, {
        cleared: true,
        clearedDate: "2026-07-20",
        playedDate: "2026-07-11",
      }),
    ).toEqual([
      { field: "cleared", from: false, to: true },
      { field: "clearedDate", from: null, to: "2026-07-20" },
    ]);
  });

  it("깬 채로 클리어한 날만 고치면 그 한 줄이다", () => {
    const cleared: CurrentValues = {
      cleared: true,
      clearedDate: "2026-07-20",
      lastPlayed: "2026-07-11",
    };
    expect(
      diffSuggestion(cleared, {
        cleared: true,
        clearedDate: "2026-07-21",
        playedDate: "2026-07-11",
      }),
    ).toEqual([{ field: "clearedDate", from: "2026-07-20", to: "2026-07-21" }]);
  });

  /* 플래그가 내려가면 날짜는 딸려서 비는 것이라(games CHECK) 별도 변경으로 세지 않는다 —
     세면 관리자가 두 줄을 읽고 같은 사실을 두 번 판단한다. */
  it("클리어를 푸는 제안은 날짜 줄을 접고 플래그 한 줄만 남긴다", () => {
    const cleared: CurrentValues = {
      cleared: true,
      clearedDate: "2026-07-20",
      lastPlayed: "2026-07-11",
    };
    expect(
      diffSuggestion(cleared, { cleared: false, clearedDate: null, playedDate: "2026-07-11" }),
    ).toEqual([{ field: "cleared", from: true, to: false }]);
  });

  it("'깼는데 날짜 모름'으로 가는 제안도 플래그 한 줄이다", () => {
    expect(
      diffSuggestion(current, { cleared: true, clearedDate: null, playedDate: "2026-07-11" }),
    ).toEqual([{ field: "cleared", from: false, to: true }]);
  });

  it("플레이한 날 변경을 센다 — 아직 기록이 없던 게임도", () => {
    expect(diffSuggestion(current, { ...same, playedDate: "2026-07-20" })).toEqual([
      { field: "playedDate", from: "2026-07-11", to: "2026-07-20" },
    ]);
    expect(
      diffSuggestion({ cleared: false, clearedDate: null, lastPlayed: null }, { ...same }),
    ).toEqual([{ field: "playedDate", from: null, to: "2026-07-11" }]);
  });

  it("플레이한 날을 비우는 제안도 변경이다 — 연결 해제를 뜻한다", () => {
    expect(diffSuggestion(current, { ...same, playedDate: null })).toEqual([
      { field: "playedDate", from: "2026-07-11", to: null },
    ]);
  });
});

describe("isEmptyEditSuggestion", () => {
  it("값도 그대로고 한마디도 없으면 아무 말도 안 하는 제안이다", () => {
    expect(isEmptyEditSuggestion(current, same, null)).toBe(true);
    expect(isEmptyEditSuggestion(current, same, "   ")).toBe(true);
  });

  /* 값으로 표현 못 하는 제보(제목 오타·포스터 오류)는 관리자도 폼으로 못 고치는 스냅샷
     필드라 글로만 전할 수 있다 — 값 변경을 필수로 두면 그 길이 막힌다. */
  it("한마디만 있어도 유효하다", () => {
    expect(isEmptyEditSuggestion(current, same, "포스터가 다른 게임이에요")).toBe(false);
  });

  it("값이 바뀌면 한마디가 없어도 유효하다", () => {
    expect(isEmptyEditSuggestion(current, { ...same, playedDate: "2026-07-20" }, null)).toBe(false);
  });
});

describe("isSuggestedValuesValid", () => {
  it("안 깬 게임에 클리어 날짜가 붙으면 거짓 — games CHECK 와 같은 판정", () => {
    expect(
      isSuggestedValuesValid({ cleared: false, clearedDate: "2026-07-20", playedDate: null }),
    ).toBe(false);
  });

  it("깬 채 날짜를 모르는 건 참", () => {
    expect(isSuggestedValuesValid({ cleared: true, clearedDate: null, playedDate: null })).toBe(
      true,
    );
  });
});

describe("isPlayDateApplied", () => {
  it("잠기지 않았으면 폼이 입력을 그대로 실었다", () => {
    expect(isPlayDateApplied("2026-07-20", "2026-07-11", false)).toBe(true);
  });

  /* 여러 날 편성이라 폼이 날짜를 잠갔는데 제안이 다른 날짜를 원했다 — 클리어만 저장됐다.
     여기서 참을 돌려주면 팬의 날짜 제안이 제안함에서 조용히 사라진다. */
  it("잠긴 채 다른 날짜를 원했으면 반영되지 않았다", () => {
    expect(isPlayDateApplied("2026-07-20", "2026-07-11", true)).toBe(false);
  });

  /* 잠겼어도 할 일이 없었으면 반영된 것이다 — 이 갈래가 없으면 여러 날 편성 게임의 클리어를
     고치는 정상 반영이 영영 "미완"으로 남아 제안이 처리되지 않는다. */
  it("잠겼어도 원하는 값이 이미 지금 값이면 반영된 것이다", () => {
    expect(isPlayDateApplied("2026-07-11", "2026-07-11", true)).toBe(true);
    expect(isPlayDateApplied("", "", true)).toBe(true);
  });
});

/* 반영 폼에 무엇을 채우는가. **팬이 본 값과 관리자 폼이 읽는 값이 서로 다른 기준**이라
   (발행 경계) 제안 스냅샷을 그대로 넣으면 팬이 못 본 날짜를 지우는 지시가 된다. */
describe("initialPlayDateFor", () => {
  it("제안 반영이 아니면 서버가 준 값을 그대로 쓴다", () => {
    expect(initialPlayDateFor(undefined, "2026-07-11", "2026-07-11")).toBe("2026-07-11");
  });

  /* **이 자리가 데이터 손실이 살던 곳이다.** 초안 주에 항목이 하나 있으면 팬 화면엔 "기록 없음"
     이라(lastPlayed 가 발행된 것만 센다) 클리어만 알려 주는 제안이 null 을 싣는데, 그 값을
     입력에 넣으면 저장이 그 초안 항목의 게임 연결을 끊는다 — 아무도 그럴 의도가 없었다. */
  it("팬이 안 고쳤으면 서버 값을 지킨다 — 팬에게 안 보이던 초안 항목이 살아남는다", () => {
    expect(initialPlayDateFor("", "", "2026-07-20")).toBe("2026-07-20");
  });

  it("팬이 고쳤으면 그 값을 싣는다", () => {
    expect(initialPlayDateFor("2026-07-21", "2026-07-11", "2026-07-11")).toBe("2026-07-21");
  });

  // 팬이 **본 날짜를 지우자고** 한 제안은 그대로 지운다 — 그건 안 보이던 값이 아니다.
  it("보이던 날짜를 비우자는 제안은 그대로 싣는다", () => {
    expect(initialPlayDateFor("", "2026-07-11", "2026-07-11")).toBe("");
  });
});
