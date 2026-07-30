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
   이 요소 자신에 transform: scale 이 있으면 캡처된 PNG 안에도 축소된 카드가 찍힌다.

   ── 카드는 모양이 **둘**이다(이슈 #122) ─────────────────────────────────────────────
   그 주에 팬아트가 걸려 있으면 요일이 7행 목록으로 서고 오른쪽에 사진지가 한 장 붙는다
   (`week-card--art`). 없으면 지금까지처럼 7열 격자가 폭을 다 쓴다 — 빈 사진지 자리를 남기지
   않는다. DOM 은 두 모양이 **같고** 방향만 CSS 가 가른다: 팬아트 유무로 마크업 골격이 갈리면
   같은 규칙(칸 여백·항목 상한 표시)을 두 벌 관리하게 된다.

   왜 목록이냐는 근거는 이슈 #122 의 결정 코멘트에 있다(요약: 7열을 유지하면 하루 칸이 108px 로
   좁아져 제목이 낱말 중간에서 꺾이고, 사진지를 좁혀도 그 선을 못 넘는다 — 실측). 읽기 화면과
   모양이 닮는 것은 결정 4 에 안 걸린다: 그 결정이 막은 것은 읽기 화면의 **DOM 을 그대로 캡처**하는
   것이다(nav·크롬이 섞이고 1200×630 이 안 잡힌다). */

import type { WeekCardData } from "@/features/schedule/card";

const EMPTY_DAY_MARK = "—";

/* `data-od-id` 를 끌 수 있다(2026-07-31). 이 카드가 **한 화면에 두 번** 뜨는 자리가 생겼다 —
   편집기의 확대 dialog 가 같은 카드를 원본 크기로 한 번 더 그린다. od-id 는 사용자가 가리킬
   요소를 짚는 이름이라(AGENTS) 같은 값이 둘이면 Playwright strict 로케이터가 **무관한 단언에서**
   깨진다. 확대본은 "같은 것을 크게 본다"일 뿐 새 대상이 아니므로 그쪽이 이름을 내려놓는다.

   지우는 게 아니라 끄는 쪽인 이유: 기본값이 켜짐이라 기존 호출부(미리보기·읽기 화면)가 한 글자도
   안 바뀌고, 새로 그리는 쪽만 자기가 사본임을 명시한다. */
export function WeekCard({
  card,
  ref,
  identified = true,
}: {
  card: WeekCardData;
  ref?: React.Ref<HTMLDivElement>;
  identified?: boolean;
}) {
  const fanart = card.fanart;
  return (
    <div
      className={fanart ? "week-card week-card--art" : "week-card"}
      {...(identified ? { "data-od-id": "week-card" } : {})}
      ref={ref}
    >
      <span className="week-card__tape week-card__tape--left" aria-hidden="true" />
      <span className="week-card__tape week-card__tape--right" aria-hidden="true" />

      <div className="week-card__head">
        <h2 className="week-card__heading">이번 주 방송</h2>
        <p className="week-card__subheading">챠이로 쿠냐</p>
        <p className="week-card__range">{card.rangeLabel}</p>
      </div>

      <div className="week-card__rule" aria-hidden="true" />

      {/* 목록·공지를 한 덩어리로 묶는다 — 팬아트가 있으면 이 덩어리가 왼쪽 열이 되고 사진지가
          오른쪽에 선다. **공지를 이 안에 두는 이유**는 사진지가 공지 띠 높이까지 쓸 수 있어야
          해서다: 공지를 이 덩어리 밖(카드 직속)에 두면 그림이 306px, 안에 두면 354px 로 그려진다
          (실측). 세로 그림은 폭보다 높이가 먼저 상한에 걸리므로 이 48px 이 그대로 크기가 된다. */}
      <div className="week-card__body">
        <div className="week-card__main">
          <ol className="week-card__days">
            {card.days.map((day, i) => {
              // 주말만 브라운 딥으로 — 핑크는 크림 위 2:1 대라 글자에 못 쓴다(week-card.css 참고).
              const isWeekend = i >= 5;
              return (
                <li
                  key={day.date}
                  className="week-card__day"
                  {...(identified ? { "data-od-id": `week-card-day-${day.date}` } : {})}
                  /* 손으로 붙인 티를 내려고 각도를 인덱스로 흔든다 — 난수를 쓰면 같은 주가 매번
                     다른 PNG 가 되어(캡처 재현성이 사라져) 옛 Satori 주석과 같은 이유로 안 쓴다.
                     **팬아트 모양(7행)에선 안 흔든다**: 700px 폭 띠를 1° 기울이면 양 끝이 6px 씩
                     들려 8px 간격의 이웃 행과 겹친다. CSS 에서 `transform: none !important` 로
                     덮지 않고 여기서 안 싣는 이유는, 인라인 스타일을 이길 방법이 !important
                     하나뿐이라 그 한 줄이 다음 사람에게 "왜 필요한가"를 안 말해 주기 때문이다. */
                  style={fanart ? undefined : { transform: `rotate(${(i % 3) - 1}deg)` }}
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
                    {day.overflow > 0 ? (
                      <p className="week-card__overflow">+{day.overflow}개</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>

          {card.note ? <p className="week-card__note">{card.note}</p> : null}
        </div>

        {/* 팬아트는 사진지 한 장으로 선다(읽기 화면과 같은 은유, 다만 부품은 카드 전용이다 —
            .polaroid 는 이 캔버스보다 작은 자리용이고 다크 재선언까지 물고 온다).

            `loading="lazy"` 를 쓰지 않는다: 미리보기는 560px 이하에서 통째로 `display: none` 이라
            lazy 면 브라우저가 안 받아 갈 수 있다. 캡처 자체는 html-to-image 가 `src` 를 직접
            fetch 하므로 무관하지만(그래서 좁은 폭에서도 PNG 는 제대로 나온다), 미리보기가 보이는
            폭에서 빈 자리로 남는 것을 막는다.

            **치수는 있으면 단다**(읽기 화면과 같은 규칙). 사진지가 그림을 감싸는 모양이라
            (schedule.css) 로드 전엔 비율을 몰라 사진지가 표기 높이로 쪼그라들었다가 그림이 오면
            늘어난다 — 속성이 그 비율을 미리 준다. 받아지는 PNG 는 캡처 전에 그림을 디코드해
            찍으므로 영향이 없고, 이건 화면의 미리보기를 위한 것이다. 처음엔 안 달았는데(자리를
            CSS 가 고정했으니 줄 이유가 없었다) 가로로 긴 그림을 고치며 사진지가 그림을 감싸게
            되면서 전제가 바뀌었다(GitHub codex 리뷰 P2). 치수는 항상 쌍이거나 없다 — 반쪽을 주면
            브라우저가 비율을 잘못 잡는데, 그 조합은 타입이 이미 막는다. */}
        {fanart && (
          <figure className="week-card__art">
            <img
              className="week-card__art-img"
              src={`/api/fanart/${fanart.imageKey}`}
              alt="팬아트"
              {...(fanart.size ?? {})}
            />
            {fanart.credit ? (
              <figcaption className="week-card__art-credit">{fanart.credit}</figcaption>
            ) : null}
          </figure>
        )}
      </div>
    </div>
  );
}
