import type { HomeHubStatus } from "@/core/home-hub";

/* 홈 카드의 상태 줄 둘. 값이 없으면 줄 자체를 안 그린다 — 조회가 실패했거나(hub null) 기록이
   없을 때 빈 칸을 표기로 꾸미지 않는다(features/home/hub). 카드 링크 안에 들어가 접근 이름의
   일부가 되므로 낱말 사이 공백을 글자로 둔다(flex gap 은 텍스트에 공백을 안 만든다). */

export function ScheduleStatus({ hub }: { hub: HomeHubStatus | null }) {
  if (!hub) return null;
  return (
    <p className="navcard__status" data-od-id="nav-card-schedule-status">
      이번 주 <span className="navcard__meta">{hub.weekRange}</span>{" "}
      <span className="navcard__value">{hub.scheduleState}</span>
    </p>
  );
}

export function RecentGameStatus({ hub }: { hub: HomeHubStatus | null }) {
  if (!hub?.recentGame) return null;
  return (
    <p className="navcard__status" data-od-id="nav-card-games-recent">
      최근 <span className="navcard__value">{hub.recentGame}</span>
    </p>
  );
}
