/* 주간표 공유 카드 — 순수 프레젠테이션(이슈 #109 작업순서 1). 카페·트위터·치지직 커뮤니티에
   PNG 로 내보내는 것이 유일한 목적이라, 읽기 화면(schedule-read.tsx)의 DOM 을 그대로 캡처하지
   않고 전용 레이아웃으로 새로 짠다(결정 4) — 읽기 화면엔 nav 등 공유에 안 맞는 크롬이 섞여
   있고, 1200×630 고정 비율(결정 18 의 종이 은유, 트위터·카페가 잘라내지 않는 값)을 지켜야
   한다.

   옛 Satori 렌더(og:image `route.tsx`, PR #107→#108 로 되돌림)의 레이아웃·색·타이포를 그대로
   평범한 CSS 로 이식했다 — Satori 는 CSS 변수를 못 읽어 색을 hex 로 복사해 썼지만, 이건 진짜
   DOM 이라 globals.css 토큰을 var() 로 그대로 참조한다(CSS 는 schedule.css).

   데이터 변환(7일 폴딩·하루 상한)은 이 컴포넌트의 일이 아니다 — `@/features/schedule/card`
   의 `buildWeekCard`(작업순서 2)가 이미 자른 값을 준다. 여기선 받은 대로 그린다. 타입도 그
   모듈이 정본이다 — features 는 app 을 모르므로(레이어 경계) 여기서 다시 정의하지 않고
   가져와 쓴다.

   `ref` 는 PNG 캡처(작업순서 3, week-card-download.tsx)가 찍을 노드를 가리킨다 — React 19 라
   forwardRef 없이 prop 으로 받는다. 미리보기를 화면 폭에 맞추는 축소는 **이 노드가 아니라
   감싸는 래퍼**에 건다: html-to-image 는 노드를 복제하며 computed style 을 그대로 베끼므로,
   이 요소 자신에 transform: scale 이 있으면 캡처된 PNG 안에도 축소된 카드가 찍힌다. */

import type { WeekCardData } from "@/features/schedule/card";

const EMPTY_DAY_MARK = "—";

export function WeekCard({ card, ref }: { card: WeekCardData; ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div className="week-card" data-od-id="week-card" ref={ref}>
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
                {/* 시각은 요일 옆에 **한 번만** 선다 — 하루의 속성이라(이슈 #117) 항목마다
                    반복하면 같은 값이 칸 안에서 여러 번 나온다. */}
                {day.time ? <span className="week-card__time">{day.time}</span> : null}
              </div>

              <div className="week-card__day-rule" aria-hidden="true" />

              <div className="week-card__entries">
                {day.rest ? (
                  /* 휴방은 "아직 안 정함"(빈 칸)과 다른 사실이라 글자로 말한다 — 카페·트위터에
                     올라간 카드에서 그 둘이 같은 모양이면 팬이 "정해지면 올라오겠지"로 읽는다. */
                  <p className="week-card__rest">휴방</p>
                ) : day.entries.length === 0 ? (
                  <p className="week-card__empty">
                    <span aria-hidden="true">{EMPTY_DAY_MARK}</span>
                    <span className="sr-only">일정 없음</span>
                  </p>
                ) : (
                  day.entries.map((entry, j) => (
                    <div key={j} className="week-card__entry">
                      <p className="week-card__entry-title">{entry.title}</p>
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
