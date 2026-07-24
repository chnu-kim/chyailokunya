/* 읽기 화면·편집기가 공유하는 프리젠테이션 조각(이슈 #56). "use client" 가 없어 양쪽에서 쓰인다
   — 읽기(서버 컴포넌트)에선 서버로, 편집기(클라이언트)에선 클라이언트 번들로 들어간다. next/link
   와 core/calendar(순수)만 끌어와 서버·클라이언트 어느 쪽에서도 안전하다. */

import Link from "next/link";
import { addWeeks, formatMD, toIsoDate } from "@/core/calendar";

/* formatMD 는 core/calendar 로 올라갔다(게임 폼도 같은 표기를 쓴다). 이 화면들이 이미 이
   이름으로 부르고 있어 여기서 그대로 다시 내보낸다 — 정의는 core 한 곳뿐이다. */
export { formatMD };

/* 하루 중 시각 라벨. '' 는 "미정"으로 — 시각 없는 편성을 빈칸으로 두면 "시각을 못 불러왔나"로
   읽힌다(결정 8: 시각 미정은 정상 상태라 그렇게 말한다). */
export function timeLabel(startTime: string | null): string {
  return startTime && startTime.trim() !== "" ? startTime : "미정";
}

/* 주 이동. 쿼리 파라미터로 주를 지정한다(?week=월요일) — 동적 세그먼트 /schedule/[week] 는
   safeReturnTo 가 고정 문자열 대조라 인증 코드를 건드려야 해서 피한다(core/auth.ts 주석·결정).
   "이번 주"는 지금 그 주가 아닐 때만 — 현재 주 판정은 서버가 한 번 계산해(page.tsx) currentWeek
   로 내려준다. 클라이언트가 todayKST 를 다시 부르면 자정 근처에서 SSR 과 갈려 하이드레이션이
   튄다. */
export function WeekNav({ weekStart, currentWeek }: { weekStart: string; currentWeek: string }) {
  const iso = toIsoDate(weekStart);
  const prev = addWeeks(iso, -1);
  const next = addWeeks(iso, 1);
  return (
    <nav className="sched-nav" aria-label="주 이동" data-od-id="schedule-week-nav">
      <Link className="sched-nav__step" href={`/schedule?week=${prev}`} rel="prev">
        <span aria-hidden="true">←</span> 지난주
      </Link>
      {weekStart !== currentWeek && (
        <Link className="sched-nav__today" href="/schedule">
          이번 주
        </Link>
      )}
      <Link className="sched-nav__step" href={`/schedule?week=${next}`} rel="next">
        다음주 <span aria-hidden="true">→</span>
      </Link>
    </nav>
  );
}
