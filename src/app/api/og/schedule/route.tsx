import { ImageResponse } from "next/og";

/* 주간 일정표 PNG 스파이크 — 이슈 #56 작업순서 1.
   묻는 것은 넷이다: (1) next/og 가 opennextjs-cloudflare build 를 통과하는가,
   (2) workerd 런타임이 실제로 PNG 를 뱉는가, (3) 한글이 글리프로 그려지는가,
   (4) 번들·응답이 Workers 한도 안인가. 데이터는 아직 하드코딩이고, 통과하면
   schedule_entries 조회로 갈아끼운다. */

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

/** Satori 에 넘길 폰트 바이너리를 Google Fonts 에서 받는다.
 *
 * 한글 완성형 한 벌은 1~2MB 라 Worker 번들에 못 넣는다. 대신 CSS2 API 의 `text=`
 * 파라미터로 **그릴 글자만** 서브셋해 받으면 수 KB 로 떨어진다. `text=` 가 붙은 요청은
 * User-Agent 와 무관하게 `/l/font?kit=…` 의 **truetype** 을 주는데(실측), 이게 중요하다 —
 * Satori 는 woff2 를 읽지 못하고, `text=` 없는 일반 요청은 woff2 를 준다.
 */
async function loadSubsetFont(family: string, weight: number, text: string): Promise<ArrayBuffer> {
  // 같은 글자를 여러 번 넘길 이유가 없다 — URL 길이는 유한하고, 주간표는 요일·숫자가
  // 반복된다.
  const glyphs = Array.from(new Set(Array.from(text))).join("");
  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}` +
    `&text=${encodeURIComponent(glyphs)}`;

  const css = await fetch(cssUrl).then((r) => r.text());
  const fontUrl = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
  if (!fontUrl) {
    // woff2 로 떨어졌다는 뜻이다 — 조용히 폴백하면 한글이 두부(□)로 그려져 배포 후에야
    // 들킨다. 여기서 깨뜨려 스파이크가 실패를 보고하게 한다.
    throw new Error(`${family}: truetype 서브셋을 못 받았다. 응답 CSS: ${css.slice(0, 200)}`);
  }
  return fetch(fontUrl).then((r) => r.arrayBuffer());
}

export async function GET() {
  // 서브셋에 넣을 글자를 렌더할 문자열에서 그대로 모은다. 여기 빠진 글자는 화면에서
  // 사라지므로, 문구를 추가하면 이 배열에도 넣어야 한다.
  const penText = HEADING + SUBHEADING + WEEK.map((e) => e.day).join("");
  const bodyText =
    NOTE + WEEK.map((e) => `${e.date}${e.time ?? ""}${e.title}`).join("") + "휴방미정";

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
          7.20 – 7.26
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
    },
  );
}
