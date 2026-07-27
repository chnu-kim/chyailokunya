/* 주간표 공유 카드 — 순수 프레젠테이션(이슈 #109 작업순서 1). 카페·트위터·치지직 커뮤니티에
   PNG 로 내보내는 것이 유일한 목적이라, 읽기 화면(schedule-read.tsx)의 DOM 을 그대로 캡처하지
   않고 전용 레이아웃으로 새로 짠다(결정 4) — 읽기 화면엔 nav 등 공유에 안 맞는 크롬이 섞여
   있고, 1200×630 고정 비율(결정 18 의 종이 은유, 트위터·카페가 잘라내지 않는 값)을 지켜야
   한다.

   옛 Satori 렌더(og:image `route.tsx`, PR #107→#108 로 되돌림)의 레이아웃·색·타이포를 그대로
   평범한 CSS 로 이식했다 — Satori 는 CSS 변수를 못 읽어 색을 hex 로 복사해 썼지만, 이건 진짜
   DOM 이라 globals.css 토큰을 var() 로 그대로 참조한다(CSS 는 schedule.css).

   데이터 변환(7일 폴딩·하루 상한)은 이 컴포넌트의 일이 아니다 — 작업순서 2 에서 짤
   `buildWeekCard` 가 이미 자른 값을 준다. 여기선 받은 대로 그린다. */

const EMPTY_DAY_MARK = "—";

export type WeekCardEntry = {
  time: string | null;
  title: string;
};

export type WeekCardDay = {
  dow: string;
  date: string;
  entries: WeekCardEntry[];
  /* 하루 상한을 넘겨 안 그린 항목 수. 0 이면 칩을 안 그린다 — "+0개"는 있으나 마나가 아니라
     없는 게 맞다(빈 상태를 굳이 표기하지 않는 관례). */
  overflow: number;
};

export type WeekCardData = {
  rangeLabel: string;
  note: string | null;
  days: WeekCardDay[];
};

export function WeekCard({ card }: { card: WeekCardData }) {
  return (
    <div className="week-card" data-od-id="week-card">
      <span className="week-card__tape week-card__tape--left" aria-hidden="true" />
      <span className="week-card__tape week-card__tape--right" aria-hidden="true" />

      <div className="week-card__head">
        <h2 className="week-card__heading">이번 주 방송</h2>
        <p className="week-card__subheading">챠이로 쿠냐</p>
        <p className="week-card__range">{card.rangeLabel}</p>
      </div>

      <div className="week-card__rule" aria-hidden="true" />

      <ol className="week-card__days">
        {card.days.map((day, i) => {
          // 주말만 브라운 딥으로 — 핑크는 크림 위 2:1 대라 글자에 못 쓴다(week-card.css 참고).
          const isWeekend = i >= 5;
          return (
            <li
              key={day.date}
              className="week-card__day"
              data-od-id={`week-card-day-${day.date}`}
              // 손으로 붙인 티를 내려고 각도를 인덱스로 흔든다 — 난수를 쓰면 같은 주가 매번
              // 다른 PNG 가 되어(캡처 재현성이 사라져) 옛 Satori 주석과 같은 이유로 안 쓴다.
              style={{ transform: `rotate(${(i % 3) - 1}deg)` }}
            >
              <div className="week-card__day-label">
                <span
                  className={
                    isWeekend ? "week-card__dow week-card__dow--weekend" : "week-card__dow"
                  }
                >
                  {day.dow}
                </span>
                <span className="week-card__date">{day.date}</span>
              </div>

              <div className="week-card__day-rule" aria-hidden="true" />

              <div className="week-card__entries">
                {day.entries.length === 0 ? (
                  <p className="week-card__empty">
                    <span aria-hidden="true">{EMPTY_DAY_MARK}</span>
                    <span className="sr-only">일정 없음</span>
                  </p>
                ) : (
                  day.entries.map((entry, j) => (
                    <div key={j} className="week-card__entry">
                      <p className="week-card__entry-title">{entry.title}</p>
                      {entry.time ? (
                        <span className="week-card__entry-time">{entry.time}</span>
                      ) : null}
                    </div>
                  ))
                )}
                {day.overflow > 0 ? <p className="week-card__overflow">+{day.overflow}개</p> : null}
              </div>
            </li>
          );
        })}
      </ol>

      {card.note ? <p className="week-card__note">{card.note}</p> : null}
    </div>
  );
}
