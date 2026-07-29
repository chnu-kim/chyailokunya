/* 공개 읽기 화면(이슈 #56 작업순서 5의 /schedule 몫). 서버 컴포넌트 — 순수 프리젠테이션이라
   클라이언트 JS 를 하나도 안 싣는다(공개 읽기는 요청마다 서버가 정본을 준다). 발행된 주만
   받는다(page.tsx 가 비관리자에게 getPublishedWeek 을 준다) — 미발행이면 week 가 null 이라
   "준비 중" 빈 상태로 떨어진다. 항목 정렬(하루 안 시각순)은 서버 getWeekForEdit 의 SQL 이 이미
   해 뒀다. 월간 캘린더는 다음 작업순서(5의 /calendar)라 여기 없다.

   PNG 다운로드(이슈 #109 작업순서 3)는 week 가 있을 때만 건다 — 없으면(미발행) 이미 위
   "아직이야…" 빈 상태가 그 사실을 말하므로, 비활성 버튼을 또 하나 얹지 않는다(WeekCardDownload
   는 그 변형도 지원하지만 이 화면에선 늘 card 가 있을 때만 쓴다). */

import { toIsoDate, WEEKDAY_LABELS, weekDates } from "@/core/calendar";
import type { GameOption } from "@/features/games/service";
import { buildWeekCard } from "@/features/schedule/card";
import type { WeekView } from "@/features/schedule/service";
import { formatMD, timeLabel, WeekNav } from "./schedule-shared";
import { WeekCardDownload } from "./week-card-download";

export function ScheduleReadView({
  weekStartDate,
  week,
  games,
  currentWeek,
  today,
}: {
  weekStartDate: string;
  week: WeekView | null;
  games: GameOption[];
  currentWeek: string;
  /* 서버가 계산한 오늘(KST). currentWeek 과 같은 todayKST() 호출에서 나온다(page.tsx) —
     주간 일정표에서 "지금 어느 칸인가"는 첫 질문인데 화면이 그걸 못 말하고 있었다.
     공유 카드에는 안 싣는다: PNG 는 며칠 뒤에도 돌아다니므로 "오늘"이 거짓이 된다. */
  today: string;
}) {
  const days = weekDates(toIsoDate(weekStartDate));
  const gamesById = new Map(games.map((g) => [g.id, g]));
  /* 하루 속성은 기본값이 아닌 날만 내려온다 — 없으면 "시각 미정 · 휴방 아님"이다(db/schema.ts). */
  const dayByDate = new Map((week?.days ?? []).map((d) => [d.scheduledDate, d]));

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
            {/* 카드가 먼저다(이슈 #56 결정 23) — 비관리자의 첫 인상은 "종이 카드" 은유가 보여야
                한다(사용자가 세 안 중 "카드+목록 병행" 채택, 2026-07-28). 목록은 그 아래 그대로
                유지한다 — 접근성 목록이 정본이고 카드는 여전히 aria-hidden(둘이 같은 내용을
                중복해서 말한다, week-card-download.tsx 주석). 편집기 쪽 카드 위치는 이번
                스코프 밖이다(발행 전 미저장 변경까지 다뤄야 해서 결이 다르다). */}
            {/* 공지가 카드보다 **위**다. 아래로 두면 카드 안 공지(week-card__note)와 200px
                안에서 같은 문장이 두 번 보인다 — 카드는 공유될 그림이라 공지를 빼면 안 되고,
                화면 쪽도 빼면 미리보기가 숨는 좁은 폭(560 아래)에서 공지를 아예 못 본다.
                순서를 "주 전체에 대한 말 → 그 주의 그림 → 그 주의 목록"으로 두면 둘이 안 붙어
                반복이 눈에 안 걸린다. */}
            {week.note && (
              <p className="sched__note" data-od-id="schedule-note">
                {week.note}
              </p>
            )}

            <WeekCardDownload card={buildWeekCard(week)} weekStartDate={weekStartDate} />

            <ol className="sched__days" data-od-id="schedule-days">
              {days.map((date, i) => {
                const day = dayByDate.get(date);
                const rest = day?.rest ?? false;
                /* 휴방인 날은 항목을 안 그린다 — 표시에서 휴방이 이긴다(이슈 #117 결정 5).
                   두 테이블이라 DB CHECK 로 공존을 못 막으므로 화면이 규칙을 세운다. */
                const entries = rest ? [] : week.entries.filter((e) => e.scheduledDate === date);
                const isToday = date === today;
                return (
                  <li
                    key={date}
                    className={isToday ? "sched-day sched-day--today" : "sched-day"}
                    data-od-id={`schedule-day-${date}`}
                    /* 보조 기술에도 오늘이 어느 칸인지 말한다 — 칩 글자만으론 시각 사용자에게만
                       전해진다. 오늘이 아닌 날엔 속성 자체를 안 단다(aria-current="false" 는
                       "이 집합에 현재 항목이 있다"는 잘못된 신호를 준다). */
                    {...(isToday ? { "aria-current": "date" as const } : {})}
                  >
                    <div className="sched-day__label">
                      <span className="sched-day__dow">{WEEKDAY_LABELS[i]!}</span>
                      <span className="sched-day__md">{formatMD(date)}</span>
                      {isToday && <span className="chip chip--ink sched-day__today">오늘</span>}
                    </div>
                    <div className="sched-day__entries">
                      {rest ? (
                        /* "휴방"과 "아직 미정"은 다른 사실이다(이슈 #117 결정 4) — 전에는 둘 다
                           "—" 라 팬이 구분을 못 했다. 값 칸이라 문장이 아니라 표기다(AGENTS). */
                        <p className="sched-day__off" data-od-id={`schedule-day-rest-${date}`}>
                          휴방
                        </p>
                      ) : entries.length === 0 ? (
                        <p className="sched-day__rest">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">일정 없음</span>
                        </p>
                      ) : (
                        entries.map((e, j) => {
                          const g = e.gameId != null ? gamesById.get(e.gameId) : undefined;
                          return (
                            <div key={e.id} className="sched-entry">
                              {/* 시각은 그날 **첫 줄에만** 선다 — 하루의 속성이라 항목마다
                                  반복하면 같은 값이 세로로 늘어선다. 뒷줄은 자리만 비워 제목이
                                  세로로 정렬되게 둔다(빈 span 이 그 폭을 지킨다). */}
                              <span className="sched-entry__time">
                                {j === 0 ? timeLabel(day?.startTime ?? null) : ""}
                              </span>
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
            <span>이번 주 일정은 아직 준비 중입니다.</span>
          </div>
        )}
      </div>
    </section>
  );
}
