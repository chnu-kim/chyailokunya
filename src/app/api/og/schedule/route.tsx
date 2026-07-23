import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ImageResponse } from "next/og";

/* 주간 일정표 PNG 스파이크 — 이슈 #56 작업순서 1.
   묻는 것은 넷이다: (1) next/og 가 opennextjs-cloudflare build 를 통과하는가,
   (2) workerd 런타임이 실제로 PNG 를 뱉는가, (3) 한글이 글리프로 그려지는가,
   (4) 번들·응답이 Workers 한도 안인가. 데이터는 아직 하드코딩이고, 통과하면
   schedule_entries 조회로 갈아끼운다. */

/* **이 라우트는 프로덕션에서 404 다.** 그리는 한 주가 실제 편성이 아니라 더미인데,
   경로가 공개라 누가 URL 을 발견해 공유하면 가짜 일정이 팬사이트 origin 의 이름으로
   퍼진다 — 링크가 없어 크롤러가 못 찾는다는 건 방어가 아니다. 그리고 그 실패는 우리
   눈에 안 띄게 퍼지므로(누가 봤는지 알 길이 없다) 사후에 못 거둔다.

   그래서 플래그가 있을 때만 200 을 낸다. `.dev.vars` 에만 넣고 Cloudflare secret 에는
   넣지 않으므로 dev·preview 는 그대로 돌고 배포본만 죽는다. 배포 런타임 검증은 이미
   workerd preview 로 끝냈고, CI 의 `배포 빌드` 스텝이 이 파일을 계속 컴파일하니 회귀
   감지도 살아 있다. 실제 데이터가 붙는 작업순서 7 에서 이 게이트를 걷어낸다 — 잊으면
   og 카드가 안 떠서 바로 드러난다. */
const SPIKE_FLAG = "OG_SCHEDULE_SPIKE";

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
// 헤더 오른쪽 날짜 범위. 렌더에 쓰는 문자열은 전부 상수로 빼 둔다 — 서브셋을 여기서
// 유도하기 때문이다(GET 의 penText·bodyText). 리터럴을 JSX 안에 직접 쓰면 서브셋에서
// 빠지는데, 빠져도 화면이 멀쩡해 보여 안 들킨다(아래 loadSubsetFont 주석).
const RANGE = "7.20 – 7.26";

type Entry = { day: string; date: string; time: string | null; title: string };

// 스파이크용 더미 한 주. 실제 편성의 형태를 일부러 닮게 뒀다 — 시각 없는 날, 쉬는 날,
// 하루 두 항목, 그리고 칸 폭을 넘길 만큼 긴 제목까지 넣어야 레이아웃이 어디서
// 깨지는지 이 단계에서 보인다(결정 8).
const WEEK: Entry[] = [
  { day: "월", date: "7.20", time: "20:00", title: "젤다의 전설: 티어스 오브 더 킹덤" },
  { day: "화", date: "7.21", time: "21:00", title: "저챗 + 시청자 참여" },
  { day: "수", date: "7.22", time: null, title: "미정" },
  { day: "목", date: "7.23", time: "20:00", title: "할로우 나이트: 실크송" },
  { day: "금", date: "7.24", time: "22:00", title: "심야 공포게임" },
  { day: "토", date: "7.25", time: "19:00", title: "합방" },
  { day: "일", date: "7.26", time: null, title: "휴방" },
];

const NOTE = "이번 주는 목요일에 실크송 엔딩까지 달립니다";

/* 받아 둔 서브셋 바이너리를 isolate 가 사는 동안 재사용한다. 같은 주간표는 글자가 같아
   캐시 키(=요청 URL)가 그대로 맞는다 — 없으면 매 요청이 Google Fonts 를 3회 왕복한다.
   isolate 수명이라 콜드 스타트마다 다시 받는다: 스파이크엔 충분하고, 엣지 캐시(Cache API)
   냐 KV/R2 냐는 작업순서 7에서 PNG 캐싱 전략과 같이 정한다(이슈 #56 미결). */
const fontCache = new Map<string, ArrayBuffer>();

/** Satori 에 넘길 폰트 바이너리를 Google Fonts 에서 받는다.
 *
 * 한글 완성형 한 벌은 1~2MB 라 Worker 번들에 못 넣는다. 대신 CSS2 API 의 `text=`
 * 파라미터로 **그릴 글자만** 서브셋해 받으면 수 KB 로 떨어진다. `text=` 가 붙은 요청은
 * User-Agent 와 무관하게 `/l/font?kit=…` 의 **truetype** 을 주는데(실측), 이게 중요하다 —
 * Satori 는 woff2 를 읽지 못하고, `text=` 없는 일반 요청은 woff2 를 준다.
 *
 * **서브셋에서 빠진 글자는 사라지지 않는다 — 다른 폰트로 그려진다.** next/og 가 자체
 * 폴백 폰트를 들고 있어(실측: en dash 를 셋 다 빼고 요청해도 workerd 가 멀쩡히 그렸다)
 * 누락이 화면상 티가 안 난다. 자형만 조용히 이탈하므로 눈으로는 못 잡는다 — 그래서 렌더
 * 문자열을 상수로 모아 서브셋을 코드로 유도한다(HEADING·SUBHEADING·RANGE·WEEK·NOTE).
 */
async function loadSubsetFont(family: string, weight: number, text: string): Promise<ArrayBuffer> {
  // 같은 글자를 여러 번 넘길 이유가 없다 — URL 길이는 유한하고, 주간표는 요일·숫자가
  // 반복된다.
  const glyphs = Array.from(new Set(Array.from(text))).join("");
  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}` +
    `&text=${encodeURIComponent(glyphs)}`;

  const cached = fontCache.get(cssUrl);
  if (cached) return cached;

  const cssRes = await fetch(cssUrl);
  // 429·5xx 를 본문으로 읽으면 정규식이 안 맞아 "truetype 을 못 받았다"로 오진한다 —
  // 원인이 다르면 메시지도 달라야 다음 사람이 엉뚱한 곳을 파지 않는다.
  if (!cssRes.ok) throw new Error(`${family}: Google Fonts CSS ${cssRes.status}`);
  const css = await cssRes.text();
  const fontUrl = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
  if (!fontUrl) {
    // woff2 로 떨어졌다는 뜻이다 — 조용히 폴백하면 한글이 두부(□)로 그려져 배포 후에야
    // 들킨다. 여기서 깨뜨려 스파이크가 실패를 보고하게 한다.
    throw new Error(`${family}: truetype 서브셋을 못 받았다. 응답 CSS: ${css.slice(0, 200)}`);
  }
  const fontRes = await fetch(fontUrl);
  if (!fontRes.ok) throw new Error(`${family}: 폰트 바이너리 ${fontRes.status}`);

  const buf = await fontRes.arrayBuffer();
  fontCache.set(cssUrl, buf);
  return buf;
}

export async function GET() {
  // truthy 가 아니라 정확히 "1" 을 요구한다 — wrangler 변수는 전부 문자열이라 `"0"`·
  // `"false"` 도 truthy 다. 끄려고 넣은 값이 켜는 값이 되는 게이트는 게이트가 아니다.
  if (getCloudflareContext().env[SPIKE_FLAG] !== "1") {
    // 404 다(501 아님) — 프로덕션에는 이 경로가 "아직 없다"가 사실이고, 501 은 있는
    // 엔드포인트가 미구현이라는 다른 말을 한다.
    return new Response(null, { status: 404 });
  }

  /* 서브셋에 넣을 글자를 **렌더하는 문자열 그대로**에서 모은다. 손으로 나열하지 않는 게
     핵심이다 — 초판은 헤더의 날짜 범위를 JSX 안에 리터럴로 두고 여기 안 넣어서 en dash
     하나가 서브셋 밖에 있었다(코드 리뷰가 잡았다). 폰트마다 실제로 그 폰트로 그리는
     문자열만 모은다: 손글씨체는 제목·요일, 본문체는 나머지. */
  const penText = HEADING + SUBHEADING + WEEK.map((e) => e.day).join("");
  const bodyText = RANGE + NOTE + WEEK.map((e) => `${e.date}${e.time ?? ""}${e.title}`).join("");

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
          {RANGE}
        </div>
      </div>

      {/* 제목 아래 밑줄 한 줄. 종이 위 격자를 강조하지 않기 위해 칸 사이 선 대신 이것만
            둔다 — 격자를 그리면 "달력이니까"로 정당화된 표가 되고 가독성이 떨어진다. */}
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
        {WEEK.map((entry, i) => (
          <div
            key={entry.day}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              backgroundColor: T.paper,
              border: `1px solid ${T.thumbEdge}`,
              borderRadius: 4,
              padding: "16px 12px",
              // 메모지 7장이 자로 잰 듯 서면 종이가 아니라 표로 읽힌다. 각도를 인덱스로
              // 흔들어 손으로 붙인 티를 낸다 — 난수를 쓰면 같은 주가 매번 다른 PNG 가
              // 되어 캐시·해시 비교가 죽으므로 결정적이어야 한다.
              transform: `rotate(${(i % 3) - 1}deg)`,
              boxShadow: "2px 3px 0 rgba(24, 24, 24, 0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  fontFamily: PEN,
                  fontSize: 46,
                  // 주말만 브랜드 핑크가 아니라 브라운 딥으로 — 핑크는 크림 위에서
                  // 2:1 대에 머물러 글자에 못 쓴다(대비는 계산해서 정한다).
                  color: i >= 5 ? T.brownDeep : T.ink,
                }}
              >
                {entry.day}
              </div>
              <div style={{ display: "flex", fontSize: 20, color: T.muted }}>{entry.date}</div>
            </div>

            <div
              style={{
                display: "flex",
                height: 1,
                backgroundColor: T.rule,
                marginTop: 10,
                marginBottom: 12,
              }}
            />

            <div
              style={{
                display: "flex",
                fontSize: 21,
                fontWeight: 700,
                color: T.ink,
                lineHeight: 1.35,
                // 긴 제목이 칸을 넘기면 잘려야지 옆 칸을 밀어선 안 된다.
                overflow: "hidden",
              }}
            >
              {entry.title}
            </div>

            <div style={{ display: "flex", flex: 1 }} />

            {entry.time ? (
              <div
                style={{
                  display: "flex",
                  alignSelf: "flex-start",
                  fontSize: 19,
                  color: T.brownDeep,
                  backgroundColor: T.pinkSoft,
                  borderRadius: 999,
                  padding: "3px 11px",
                }}
              >
                {entry.time}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", marginTop: 22, fontSize: 22, color: T.muted }}>{NOTE}</div>
    </div>,
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: PEN, data: penFont, weight: 400, style: "normal" },
        { name: BODY, data: bodyFont, weight: 400, style: "normal" },
        { name: BODY, data: bodyBold, weight: 700, style: "normal" },
      ],
      /* 기본값이 `public, max-age=0, must-revalidate` 라 크롤러가 긁을 때마다 Satori 를
         다시 돌리고 Google Fonts 를 왕복한다. 스파이크 데이터는 하드코딩이라 무효화할
         것이 없어 짧게 잡아 둔다 — 발행 시점에 갱신돼야 하는 진짜 캐시 전략(무효화 키·
         s-maxage·발행 훅)은 작업순서 7 에서 정한다(이슈 #56 미결). */
      headers: { "Cache-Control": "public, max-age=300" },
    },
  );
}
