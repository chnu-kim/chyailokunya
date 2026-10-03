/* 홈 세 갈래 카드(소개 · 주간 일정 · 플레이 게임)가 싣는 "그 갈래의 지금 상태" 한 줄.
   2026-10-03 홈 개편 시안 A — 일정이 푸터에만 있어 팬이 가장 자주 볼 정보가 가장 깊이 숨어
   있었고, 홈 카드는 목적지 이름만 말해 홈에서 얻는 정보가 없었다.

   값 칸이라 문장이 아니라 표기다(AGENTS.md 컨벤션). 사실만 싣는다 — 발행 여부와 마지막으로
   플레이한 게임 이름, 둘 다 저장된 값에서 그대로 온다. */
import { formatMD, type IsoDate, weekDates } from "./calendar";

export type HomeHubStatus = {
  // 이번 주 범위 표기("9.28 – 10.4"). 카드가 "이번 주"가 언제인지 말하게 한다.
  weekRange: string;
  /* 발행된 주만 "공개"다 — 초안은 공개 화면에 안 샌다(ADR-0022). 관리자도 홈에선 팬과 같은
     값을 본다: 홈은 신원을 안 읽는다. */
  scheduleState: "공개" | "준비 중";
  // 플레이 기록이 하나도 없으면 null — 그때 카드는 상태 줄을 안 그린다(빈 값을 표기로 꾸미지 않는다).
  recentGame: string | null;
};

export function homeHubStatus(input: {
  today: IsoDate;
  weekPublished: boolean;
  /* 마지막으로 플레이한 순(최근이 앞, 기록 없는 게임은 뒤)이라고 가정한다 — listGames 의 정렬이다.
     여기서 다시 정렬하지 않는 이유: 그 정렬은 발행 경계를 아는 SQL 이 정본이라(lastPlayedExpr)
     같은 규칙을 두 자리에 두면 갈라진다. */
  gamesByRecency: readonly { categoryValue: string; lastPlayed: string | null }[];
}): HomeHubStatus {
  const days = weekDates(input.today);
  return {
    weekRange: `${formatMD(days[0]!)} – ${formatMD(days[6]!)}`,
    scheduleState: input.weekPublished ? "공개" : "준비 중",
    recentGame: input.gamesByRecency.find((g) => g.lastPlayed !== null)?.categoryValue ?? null,
  };
}
