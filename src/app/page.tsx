import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { todayKST, weekStartOf } from "@/core/calendar";
import { homeHubStatus } from "@/core/home-hub";
import { makeDb } from "@/db";
import { listGames } from "@/features/games/service";
import { getPublishedWeek } from "@/features/schedule/service";
import "./home.css";
import { OG_IMAGE, OG_LOCALE, OG_SITE_NAME } from "./site-meta";

export const metadata: Metadata = {
  // 홈은 layout 의 default 제목·설명을 그대로 쓰고, 카드 문구만 홈에 맞게 덮는다.
  openGraph: {
    siteName: OG_SITE_NAME,
    locale: OG_LOCALE,
    type: "website",
    images: [OG_IMAGE],
    url: "/",
    title: "챠이로 쿠냐 — 팬 사이트",
    description: "버추얼 스트리머 챠이로 쿠냐 비공식 팬 사이트.",
  },
};

// --rise-delay 같은 CSS 커스텀 속성을 인라인 style 로 넘길 때의 타입 우회.
const rise = (delay: string): CSSProperties => ({ ["--rise-delay"]: delay }) as CSSProperties;

/* 카드에 그 갈래의 지금 상태(이번 주 발행 여부 · 최근 게임)를 싣느라 D1 을 읽는다 — 요청 스코프
   바인딩이라 정적 프리렌더 대상이 아니다(games·schedule 페이지와 같은 이유). */
export const dynamic = "force-dynamic";

export default async function Home() {
  const db = makeDb(getCloudflareContext().env.DB);
  // 시계는 Date.now() 기반 todayKST 로만 읽는다(배포 Workers 의 Temporal.Now 는 에포크 0 이다).
  const today = todayKST();
  /* 발행된 주만 본다 — 초안은 공개 화면에 안 샌다(ADR-0022). 신원과 무관하게 같은 값이라
     관리자도 홈에선 팬이 보는 상태를 본다. */
  const [publishedWeek, games] = await Promise.all([
    getPublishedWeek(db, weekStartOf(today)),
    listGames(db),
  ]);
  const hub = homeHubStatus({
    today,
    weekPublished: publishedWeek !== null,
    gamesByRecency: games,
  });

  return (
    <main className="home" id="main" data-od-id="home">
      <div className="wrap">
        <div className="home__hero" data-od-id="home-hero">
          {/* 방송 캡처 세 장. 사진을 바꾸려면 /assets/snap-N.jpg 를 덮어쓰기만 하면 된다 —
              슬롯이 정사각으로 잘라내므로 미리 크롭하지 않아도 되고, 함께 갈아야 하는 건
              손글씨 캡션과 alt 뿐이다(alt 는 장식이 아니라 내용이다). */}
          <div className="home__snaps rise--photo" data-od-id="home-snaps" style={rise("120ms")}>
            <figure className="polaroid snap" data-od-id="home-snap-1">
              <span className="tape snap__tape" aria-hidden="true" />
              <div className="snap__slot">
                <img
                  src="/assets/snap-1.jpg"
                  width={400}
                  height={400}
                  fetchPriority="high"
                  alt="눈을 감고 미소 짓는 쿠냐 — 검은 오프숄더 스웨터 차림으로 밤 조명이 든 방에서"
                />
              </div>
              <figcaption>움뫄</figcaption>
            </figure>
            <figure className="polaroid snap" data-od-id="home-snap-2">
              <span className="clip" aria-hidden="true" />
              <div className="snap__slot">
                <img
                  src="/assets/snap-2.jpg"
                  width={400}
                  height={400}
                  fetchPriority="high"
                  alt="분홍 리본을 달고 분홍 고양이 인형을 끌어안은 채 웃는 쿠냐"
                />
              </div>
              <figcaption>바보</figcaption>
            </figure>
            <figure className="polaroid snap" data-od-id="home-snap-3">
              <span className="tape snap__tape" aria-hidden="true" />
              <div className="snap__slot">
                <img
                  src="/assets/snap-3.jpg"
                  width={400}
                  height={400}
                  loading="lazy"
                  decoding="async"
                  alt="트윈테일을 묶고 마이크 앞에서 이야기하며 웃는 쿠냐"
                />
              </div>
              <figcaption>엥?</figcaption>
            </figure>
          </div>
          {/* 이름은 바로 아래 h1 이 말한다. 이 칩이 더할 게 있다면 "공식이 아니다" 뿐이다.
              그래서 잉크 채움 변형을 안 쓴다 — 채우면 선으로 그린 손글씨 제목 옆에서 이
              hero 의 유일한 꽉 찬 덩어리가 돼 부제가 제목보다 무거워진다. 외곽선은 배지
              형태를 남기고 무게만 뺀다(껍데기까지 벗기면 남는 건 이 저장소가 템플릿 지문으로
              보고 걷어낸 영어 eyebrow 다). 12px 이라 4.5 가 필요한데 이 hero 는 줄노트 위에
              앉으니 최악은 종이가 아니라 줄이다 — 라이트 줄 위 4.96 / 종이 위 6.39, 다크 줄
              위 6.00 / 배경 위 7.29. 테두리도 같은 색이라 3:1 위다. */}
          <span className="chip t-caps rise" style={rise("180ms")}>
            Unofficial Fan Site
          </span>
          <h1 className="t-script rise" data-od-id="home-title" style={rise("240ms")}>
            챠이로 쿠냐
          </h1>
          {/* 이 한 줄은 정보가 아니라 분위기를 맡는다 — 나이·MBTI·컨텐츠를 여기 채우자는
              제안은 사용자가 기각했다. 프로필 사실은 /landing 이 말하고, 홈은 "어떤 사람인지"의
              인상만 남긴다. 손글씨 얼굴(t-hand)이 그 역할의 일부다. */}
          <p className="rise" style={rise("300ms")}>
            <span className="t-hand" style={{ fontSize: "var(--text-xl)" }}>
              엉뚱한 매력 있는 챠이로 쿠냐 등장!
            </span>
          </p>
          <span className="quokka-doodle" aria-hidden="true" />
        </div>

        {/* 발바닥 트레일 — 걷는 흔적 */}
        <div className="deco-paws" aria-hidden="true">
          <svg className="deco-paw">
            <use href="#mk-paw" />
          </svg>
          <svg className="deco-paw">
            <use href="#mk-paw" />
          </svg>
          <svg className="deco-paw">
            <use href="#mk-paw" />
          </svg>
        </div>

        <div className="cards-outer rise" style={rise("360ms")}>
          <div className="cards" data-od-id="home-nav-cards">
            {/* 카드 전체가 링크 요소다. 안에 "보러가기 →" 를 또 두면 링크 안의 가짜 링크가 되고,
                목적지가 다른 두 카드가 같은 라벨을 달게 된다. 목적지 이름은 h2 가 말하고,
                눌린다는 신호는 hover·focus lift 와 커서가 맡는다. */}
            <Link className="paper navcard" href="/landing" data-od-id="nav-card-about">
              <span className="tape" aria-hidden="true" />
              {/* 고양이 얼굴 — 이 사이트의 아이콘 언어는 고양이·발바닥·카오모지다. 눈은
                  h 0.01 선분에 stroke-linecap:round 를 걸어 점으로 만든다(옆 게임패드
                  아이콘과 같은 관용구). */}
              <svg
                className="navcard__ic"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="14" r="7.2" />
                <path d="M6.8 9.6 5.2 3.6l5.2 3.3M17.2 9.6l1.6-6-5.2 3.3" />
                <path d="M9.5 13h.01M14.5 13h.01" />
                <path d="M12 15.8v.7" />
                <path d="M12 16.5c-.6 1.1-2.2 1.1-2.6-.2M12 16.5c.6 1.1 2.2 1.1 2.6-.2" />
              </svg>
              <h2>소개</h2>
              <p>프로필, 방송 컨텐츠, 채널.</p>
            </Link>

            <Link className="paper navcard" href="/schedule" data-od-id="nav-card-schedule">
              <svg
                className="navcard__ic"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
                <path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2" />
              </svg>
              <h2>주간 일정</h2>
              <p>요일별 방송 시각과 할 일.</p>
              <p className="navcard__status" data-od-id="nav-card-schedule-status">
                이번 주<span className="navcard__meta">{hub.weekRange}</span>
                <span className="navcard__value">{hub.scheduleState}</span>
              </p>
            </Link>

            <Link className="paper navcard" href="/games" data-od-id="nav-card-games">
              <span className="clip" aria-hidden="true" />
              <svg
                className="navcard__ic"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2.5" y="7" width="19" height="10.5" rx="3.5" />
                <path d="M7.5 11v3M6 12.5h3M15.5 11.5h.01M18 13.5h.01" />
              </svg>
              <h2>플레이 게임</h2>
              <p>방송에서 플레이한 게임 보드. 최근에 한 것부터.</p>
              {hub.recentGame && (
                <p className="navcard__status" data-od-id="nav-card-games-recent">
                  최근<span className="navcard__value">{hub.recentGame}</span>
                </p>
              )}
            </Link>
          </div>
          <span className="mascot-sticker" aria-hidden="true" />
        </div>
      </div>
    </main>
  );
}
