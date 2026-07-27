import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ImageResponse } from "next/og";
import { resolveWeekParam } from "@/core/calendar";
import { makeDb } from "@/db";
import { buildWeekCard, type WeekCard } from "@/features/schedule/card";
import { getPublishedWeek } from "@/features/schedule/service";

/* 주간표 PNG(이슈 #56 작업순서 7) — /schedule 의 og:image 겸용(결정 15). 스파이크(#57)가
   더미 데이터로 확인한 넷(배포 계약·workerd 렌더·한글 글리프·번들 한도)을 통과한 뒤, 이제
   `schedule_entries` 실데이터를 그린다. 스파이크의 `OG_SCHEDULE_SPIKE` 게이트는 여기서 걷어
   낸다 — 더 이상 더미가 아니므로 프로덕션에 살려 둘 이유가 없다. */

// og:image 겸용이라 1200×630 고정이다(결정 15). 이 비율을 벗어나면 트위터·카페
// 카드가 임의로 잘라내 요일 칸이 통째로 사라진다.
const WIDTH = 1200;
const HEIGHT = 630;

// 라이트 테마 토큰의 사본. Satori 는 CSS 변수를 모른다 — globals.css 를 읽어올 수단이
// 없어 값을 복사하는 수밖에 없고, 그래서 여기가 토큰 정본에서 갈라질 수 있는 유일한
// 자리다. globals.css 의 :root 를 고치면 이 표도 같이 고친다.
const T = {
  paper: "#ffffff",
  cream: "#f4eee9", // --thumb-paper
  ink: "#181818", // --brand-ink
  brown: "#76554b", // --brand-brown
  brownDeep: "#604830", // --brand-brown-deep
  muted: "#6f5a5a", // --fg-muted (크림 위 AA)
  pinkSoft: "#f0d8d8", // --brand-pink-soft
  pink: "#e0a8b0", // --brand-pink
  rule: "#dfe3ea", // --brand-line
  tape: "rgba(214, 196, 168, 0.72)", // --tape-amber
  thumbEdge: "#e3d8cf", // --thumb-edge
} as const;

const PEN = "Nanum Pen Script"; // --font-hand 의 한글 페이스
const BODY = "Gothic A1"; // --font-body 의 첫 스택

const HEADING = "이번 주 방송";
const SUBHEADING = "챠이로 쿠냐";

/* 받아 둔 서브셋 바이너리를 isolate 가 사는 동안 재사용한다. 스파이크 시절엔 문구가 상수라
   캐시 키(요청 URL)가 영원히 하나였지만, 실데이터는 주마다 제목·공지가 달라 글리프 집합이
   요청마다 바뀐다 — 그래서 이 맵은 이제 "며칠 동안 같은 주를 반복 조회하는 크롤러" 정도만
   구한다(콜드 스타트마다 다시 받는 것도 스파이크와 같다). 응답 자체를 엣지에서 캐싱해 Satori
   재실행 자체를 줄이는 몫은 아래 Cache-Control 이 진다(이슈 #56 미결 정리 — 작업순서 7). */
const fontCache = new Map<string, ArrayBuffer>();

/** Satori 에 넘길 폰트 바이너리를 Google Fonts 에서 받는다. 스파이크 주석(로직 그대로) —
 * 한글 완성형 한 벌은 1~2MB 라 Worker 번들에 못 넣으므로 CSS2 API 의 `text=` 로 그릴 글자만
 * 서브셋해 받는다. **서브셋에서 빠진 글자는 조용히 다른 폰트로 그려진다**(누락이 화면에 안
 * 티가 난다) — 그래서 렌더 문자열을 실데이터에서 그러모아 서브셋을 코드로 유도한다(아래
 * penText·bodyText). Google Fonts 가 죽으면 이 라우트도 실패한다 — 그 위험은 엣지 캐싱으로
 * 줄인다(같은 (주·리비전)을 두 번 렌더할 일이 적어진다는 뜻이지 의존 자체가 없어지진 않는다.
 * KV/R2 로 폰트 바이너리를 별도 캐싱하는 안은 기각했다 — PNG 응답 자체를 캐싱하면 그 안에서
 * Satori·폰트 페치가 통째로 스킵되므로 더 적은 인프라로 같은 문제를 닫는다). */

/* Google Fonts 로 보낼 고유 글자 수 상한. 화면에 실제로 보이는 문자(하루 4건 상한 ×7일 +
   공지 500자)는 대개 이 근처에도 못 미치지만(실측: 150 종 정도 쓰는 보통 주가 URL 1.4KB),
   서로 안 겹치는 글자로만 채운 정상 범위 안 입력(제목 200자·항목 최대 60개)은 산술상 URL 을
   수십 KB 까지 부풀릴 수 있다 — Google Fonts 요청이 그 크기에서 실패하면 og 카드 전체가 500
   이 된다(적대적 리뷰 지적). 넘치면 뒤쪽 글자를 자른다 — 아주 드물게 그 문자만 다른 폰트로
   그려질 수 있지만(누락 글자의 결), 라우트 전체가 죽는 것보다 낫다. */
const MAX_SUBSET_GLYPHS = 600;

async function loadSubsetFont(family: string, weight: number, text: string): Promise<ArrayBuffer> {
  const glyphs = Array.from(new Set(Array.from(text)))
    .join("")
    .slice(0, MAX_SUBSET_GLYPHS);
  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}` +
    `&text=${encodeURIComponent(glyphs)}`;

  const cached = fontCache.get(cssUrl);
  if (cached) return cached;

  const cssRes = await fetch(cssUrl);
  if (!cssRes.ok) throw new Error(`${family}: Google Fonts CSS ${cssRes.status}`);
  const css = await cssRes.text();
  const fontUrl = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
  if (!fontUrl) {
    throw new Error(`${family}: truetype 서브셋을 못 받았다. 응답 CSS: ${css.slice(0, 200)}`);
  }
  const fontRes = await fetch(fontUrl);
  if (!fontRes.ok) throw new Error(`${family}: 폰트 바이너리 ${fontRes.status}`);

  const buf = await fontRes.arrayBuffer();
  fontCache.set(cssUrl, buf);
  return buf;
}

/* 렌더가 실제로 그리는 문자열만 모은다(손으로 나열하지 않는다 — 리터럴을 JSX 에 직접 쓰면
   서브셋에서 빠지는 글자가 생긴다). 오버플로 칩("+N개")은 그 날이 실제로 넘칠 때만 그려지므로
   그때만 모은다 — 안 쓰는 글리프를 미리 담을 이유가 없다.

   항목 제목은 `text-overflow: ellipsis` 를 안 쓴다(아래 렌더의 title 스타일 주석) — 그래서
   여기 나열할 게 없지만, 다시 쓰게 되면 "…"(U+2026)를 반드시 이 목록에 손으로 추가해야
   한다. 그 글자는 CSS 가 넣는 것이지 이 함수가 훑는 어떤 문자열에도 리터럴로 없어서, 이
   수집이 아무리 촘촘해도 못 잡는다(AGENTS.md 의 주간 일정 지뢰 목록 참고 — 실측으로 두부(□)
   렌더를 확인한 자리). */
function collectFontText(card: WeekCard): { penText: string; bodyText: string } {
  const penText = HEADING + SUBHEADING + card.days.map((d) => d.dow).join("");
  const bodyText =
    card.rangeLabel +
    (card.note ?? "") +
    card.days
      .flatMap((d) => [
        d.date,
        ...d.entries.flatMap((e) => [e.time ?? "", e.title]),
        d.overflow > 0 ? `+${d.overflow}개` : "",
      ])
      .join("");
  return { penText, bodyText };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const weekStart = resolveWeekParam(url.searchParams.get("week") ?? undefined);

  const db = makeDb(getCloudflareContext().env.DB);
  const week = await getPublishedWeek(db, weekStart);
  // 발행된 주가 없다(초안이거나 아예 없음) — 결정 13 은 미발행이 og 카드로 안 나가는 것까지
  // 포함한다. 404 다(500 아님) — "지금 이 주의 카드가 없다"가 사실이지 에러가 아니다.
  if (!week) return new Response(null, { status: 404 });

  /* URL 이 **그 주의 지금 리비전을 정확히 가리킬 때만** 영구 캐싱을 준다. `rev` 가 있다는
   * 사실만으로 영원히 캐싱하면(이전 구현), 편집과 요청이 겹치는 좁은 창에서 이 URL 이 실제로
   * 담보하지 않는 걸 약속하게 된다 — `/schedule` 이 rev=100 을 박아 og:image 태그를 낸 직후
   * 누군가 그 주를 다시 저장해 rev=105 가 되면, 그 사이 아무 캐시도 아직 안 가진 `?rev=100`
   * URL 을 처음 요청한 쪽은 (이 라우트가 리비전과 무관하게 항상 "지금" 데이터를 그리므로)
   * rev=105 의 내용을 받는다 — 그런데 그걸 rev=100 이라는 이름 아래 "영원히 안 바뀐다"고
   * 캐싱해 버리면, 그 뒤 또 저장(rev=110)이 나가도 그 캐시는 rev=105 짜리 낡은 내용을 계속
   * 내준다. 콘텐츠 주소화(URL=콘텐츠) 계약을 라우트가 실제로 검증하지 않고 말로만 하던
   * 자리다(적대적 리뷰가 잡음). 그래서 `rev` 를 지금 리비전과 대조해, 맞을 때만(우리
   * generateMetadata 가 방금 그 순간의 리비전을 실어 만든 URL 일 때만) 영구 캐싱하고, 어긋나면
   * (레이스에 걸렸거나 손으로 조작한 값) 그냥 짧게만 잡는다 — 데이터 자체는 항상 "지금"
   * 값이라 틀린 화면이 나가진 않는다. */
  const isPinnedToCurrentRevision = url.searchParams.get("rev") === String(week.revision);

  const card = buildWeekCard(weekStart, week);
  const { penText, bodyText } = collectFontText(card);

  const [penFont, bodyFont, bodyBold] = await Promise.all([
    loadSubsetFont(PEN, 400, penText),
    loadSubsetFont(BODY, 400, bodyText),
    loadSubsetFont(BODY, 700, bodyText),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: T.cream,
        fontFamily: BODY,
        padding: "40px 48px 48px",
        position: "relative",
      }}
    >
      {/* 벽에 붙인 종이라는 은유의 근거(결정 18) — 위쪽 마스킹테이프 두 조각. 장식이라
            의미를 싣지 않는다. */}
      <div
        style={{
          position: "absolute",
          top: -14,
          left: 232,
          width: 132,
          height: 40,
          backgroundColor: T.tape,
          transform: "rotate(-4deg)",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -16,
          right: 232,
          width: 132,
          height: 40,
          backgroundColor: T.tape,
          transform: "rotate(3deg)",
          display: "flex",
        }}
      />

      <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
        <div style={{ display: "flex", fontFamily: PEN, fontSize: 74, color: T.ink }}>
          {HEADING}
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: PEN,
            fontSize: 38,
            color: T.brown,
            paddingBottom: 12,
          }}
        >
          {SUBHEADING}
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", fontSize: 26, color: T.muted, paddingBottom: 14 }}>
          {card.rangeLabel}
        </div>
      </div>

      {/* 제목 아래 밑줄 한 줄. 격자를 그리면 "달력이니까"로 정당화된 표가 되어 가독성이
            떨어진다(결정 18) — 칸 사이 선 대신 이것만 둔다. */}
      <div
        style={{
          display: "flex",
          height: 3,
          backgroundColor: T.pink,
          marginTop: 14,
          marginBottom: 26,
        }}
      />

      <div style={{ display: "flex", flex: 1, gap: 12 }}>
        {card.days.map((day, i) => (
          <div
            key={day.date}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              backgroundColor: T.paper,
              border: `1px solid ${T.thumbEdge}`,
              borderRadius: 4,
              padding: "14px 10px",
              // 메모지 7장이 자로 잰 듯 서면 종이가 아니라 표로 읽힌다. 각도를 인덱스로
              // 흔들어 손으로 붙인 티를 낸다 — 난수를 쓰면 같은 주가 매번 다른 PNG 가 되어
              // 캐시·해시 비교가 죽으므로 결정적이어야 한다.
              transform: `rotate(${(i % 3) - 1}deg)`,
              boxShadow: "2px 3px 0 rgba(24, 24, 24, 0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <div
                style={{
                  display: "flex",
                  fontFamily: PEN,
                  fontSize: 34,
                  // 주말만 브랜드 핑크가 아니라 브라운 딥으로 — 핑크는 크림 위에서 2:1 대에
                  // 머물러 글자에 못 쓴다(대비는 계산해서 정한다).
                  color: i >= 5 ? T.brownDeep : T.ink,
                }}
              >
                {day.dow}
              </div>
              <div style={{ display: "flex", fontSize: 16, color: T.muted }}>{day.date}</div>
            </div>

            <div
              style={{
                display: "flex",
                height: 1,
                backgroundColor: T.rule,
                marginTop: 8,
                marginBottom: 10,
              }}
            />

            <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 6 }}>
              {day.entries.length === 0 ? (
                // schedule-read 의 빈 칸 표기("—")와 같은 결 — 확정된 휴방인지 아직 안 짠
                // 건지는 이 화면도 안 가른다(is_rest 는 이슈 #56 의 남은 미결).
                <div style={{ display: "flex", fontSize: 22, color: T.muted }}>—</div>
              ) : (
                day.entries.map((e, j) => (
                  <div key={j} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <div
                      style={{
                        display: "flex",
                        fontSize: 16,
                        fontWeight: 700,
                        color: T.ink,
                        lineHeight: 1.3,
                        // 두 줄까지 보여주고 자른다 — 카드가 곧 공유물이라 제목이 뭔지가
                        // 핵심인데, 한 줄 말줄임(전 버전)은 "젤다의 전설: 티…"처럼 정작
                        // 게임명이 잘려 나갔다(실측 렌더로 확인). Satori 는
                        // `-webkit-line-clamp` 를 지원하지 않아(2줄 이후를 "…"으로 접는
                        // 표준 방법이 없다) 두 줄 분량을 **상한**으로 두고 넘치면 그냥 자른다
                        // — 말줄임표 없는 하드컷을 받아들인 것이다. `height`(고정)이 아니라
                        // `maxHeight` 인 이유: 실측해 보니 고정 높이는 "저챗" 같은 한 줄
                        // 제목도 두 줄 칸만큼 억지로 벌려 하루 여러 항목 사이가 듬성듬성해졌다
                        // — 실사용(결정 8 의 예)은 짧은 제목이 더 흔해 그 낭비가 기본값이 된다.
                        // 상한만 걸면 짧은 제목은 자기 줄 수만큼만 차지하고, 긴 제목만 두
                        // 줄에서 잘린다.
                        maxHeight: 42,
                        overflow: "hidden",
                      }}
                    >
                      {e.title}
                    </div>
                    {e.time ? (
                      <div
                        style={{
                          display: "flex",
                          alignSelf: "flex-start",
                          fontSize: 13,
                          color: T.brownDeep,
                          backgroundColor: T.pinkSoft,
                          borderRadius: 999,
                          padding: "2px 8px",
                        }}
                      >
                        {e.time}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
              {day.overflow > 0 ? (
                <div style={{ display: "flex", fontSize: 14, color: T.muted }}>
                  +{day.overflow}개
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {card.note ? (
        <div style={{ display: "flex", marginTop: 22, fontSize: 22, color: T.muted }}>
          {card.note}
        </div>
      ) : null}
    </div>,
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: PEN, data: penFont, weight: 400, style: "normal" },
        { name: BODY, data: bodyFont, weight: 400, style: "normal" },
        { name: BODY, data: bodyBold, weight: 700, style: "normal" },
      ],
      /* `/schedule`(generateMetadata)이 og:image 를 지을 때 `rev`(주 메타의 last_updated_at)를
         항상 실어 보낸다 — 그 주가 바뀌면(saveWeek·claimWeek 모두 이 값을 단조 증가시킨다) URL
         자체가 달라지므로, 지금 리비전과 맞는 `rev` 는 내용이 절대 안 바뀔 URL 이라 영구 캐싱이
         안전하다(결정적 렌더는 스파이크가 이미 확인했다. 검증은 위
         `isPinnedToCurrentRevision`). `rev` 없이 두드리거나 리비전이 어긋나면(수동 확인·레이스·
         조작) 내용이 그 순간의 최신값이라 짧게만 잡는다. */
      headers: {
        "Cache-Control": isPinnedToCurrentRevision
          ? "public, max-age=31536000, immutable"
          : "public, max-age=300",
      },
    },
  );
}
