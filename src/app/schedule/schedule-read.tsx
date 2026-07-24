/* 공개 읽기 화면(이슈 #56 작업순서 5의 /schedule 몫). 서버 컴포넌트 — 순수 프리젠테이션이라
   클라이언트 JS 를 하나도 안 싣는다(공개 읽기는 요청마다 서버가 정본을 준다). 발행된 주만
   받는다(page.tsx 가 비관리자에게 getPublishedWeek 을 준다) — 미발행이면 week 가 null 이라
   "준비 중" 빈 상태로 떨어진다. 항목 정렬(하루 안 시각순)은 서버 getWeekForEdit 의 SQL 이 이미
   해 뒀다. 월간 캘린더·PNG 공유 카드는 다음 작업순서(5의 /calendar·7)라 여기 없다. */

import { toIsoDate, WEEKDAY_LABELS, weekDates } from "@/core/calendar";
import type { GameOption } from "@/features/games/service";
import type { WeekView } from "@/features/schedule/service";
import { formatMD, timeLabel, WeekNav } from "./schedule-shared";

export function ScheduleReadView({
  weekStartDate,
  week,
  games,
  currentWeek,
}: {
  weekStartDate: string;
  week: WeekView | null;
  games: GameOption[];
  currentWeek: string;
}) {
  const days = weekDates(toIsoDate(weekStartDate));
  const gamesById = new Map(games.map((g) => [g.id, g]));

  return (
    <section className="sched" data-od-id="schedule">
      <div className="wrap">
        <header className="sched__head">
          <div className="sched__heading">
            <h1 className="sched__title" data-od-id="schedule-title">
              주간 일정
            </h1>
            <p className="sched__range">
              {formatMD(days[0]!)} – {formatMD(days[6]!)}
            </p>
          </div>
          <WeekNav weekStart={weekStartDate} currentWeek={currentWeek} />
        </header>

        {week ? (
          <>
            {week.note && (
              <p className="sched__note" data-od-id="schedule-note">
                {week.note}
              </p>
            )}
            <ol className="sched__days" data-od-id="schedule-days">
              {days.map((date, i) => {
                const entries = week.entries.filter((e) => e.scheduledDate === date);
                return (
                  <li key={date} className="sched-day" data-od-id={`schedule-day-${date}`}>
                    <div className="sched-day__label">
                      <span className="sched-day__dow">{WEEKDAY_LABELS[i]!}</span>
                      <span className="sched-day__md">{formatMD(date)}</span>
                    </div>
                    <div className="sched-day__entries">
                      {entries.length === 0 ? (
                        <p className="sched-day__rest">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">일정 없음</span>
                        </p>
                      ) : (
                        entries.map((e) => {
                          const g = e.gameId != null ? gamesById.get(e.gameId) : undefined;
                          return (
                            <div key={e.id} className="sched-entry">
                              <span className="sched-entry__time">{timeLabel(e.startTime)}</span>
                              {g?.posterImageUrl && (
                                <img
                                  className="sched-entry__poster"
                                  src={g.posterImageUrl}
                                  alt=""
                                  loading="lazy"
                                  width={30}
                                  height={40}
                                />
                              )}
                              <span className="sched-entry__title">{e.title}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <div className="sched__empty" data-od-id="schedule-empty">
            <span className="t-hand">아직이야…</span>
            <span>이번 주 일정은 아직 준비 중이에요.</span>
          </div>
        )}
      </div>
    </section>
  );
}
