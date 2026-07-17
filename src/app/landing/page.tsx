import type { Metadata } from "next";
import Link from "next/link";
import "./landing.css";
import { LandingKeyVisual } from "./key-visual";
import { ThemedImg } from "@/components/ui/themed-img";
import { OG_IMAGE, OG_LOCALE, OG_SITE_NAME } from "../site-meta";

export const metadata: Metadata = {
  title: "챠이로 쿠냐 — 소개",
  description:
    "버추얼 스트리머 챠이로 쿠냐 소개 — 영원한 20살, 저챗·종합게임·노래 방송. 쿠냥이들 어서오냥.",
  openGraph: {
    siteName: OG_SITE_NAME,
    locale: OG_LOCALE,
    // 소개는 인물 소개라 og:type=profile — 세 페이지 중 유일하게 앵커가 다르다.
    type: "profile",
    images: [OG_IMAGE],
    url: "/landing",
    title: "챠이로 쿠냐 — 소개",
    description:
      "저챗으로 도란도란, 게임으로 와글와글, 노래로 몽글몽글. 느긋하고 다정한 INFP 고양이.",
  },
};

export default function Landing() {
  return (
    <main id="main">
      {/* HERO */}
      <section className="hero" aria-labelledby="hero-h1" data-od-id="landing-hero">
        <div className="wrap hero__grid">
          <div>
            <div className="hero__kicker">
              <span className="chip chip--ink t-caps">Debut 2025.12.20</span>
            </div>
            <h1 className="hero__h1 t-script" id="hero-h1" data-od-id="landing-title">
              Chyailo Kunya
            </h1>
            <p className="hero__sub">
              갈색 고양이 버추얼 스트리머, <strong>챠이로 쿠냐</strong>
            </p>
            <p className="hero__lead">
              저챗으로 도란도란, 게임으로 와글와글, 노래로 몽글몽글. 느긋하고 다정한 INFP 고양이가
              오늘도 방송에서 쿠냥이들을 기다려요.
            </p>
            {/* 액센트는 이 페이지의 유일한 핑크 — 진짜로 어딘가에 도착하는 링크(게임)에 건다.
                채널 버튼은 같은 페이지 앵커라 시각 무게를 낮춘다(순서는 그대로: 페이지 주제는
                채널이고 게임은 곁가지라 읽는 순서와 시각 무게는 다른 축이다). */}
            <div className="hero__cta" data-od-id="landing-cta">
              <a className="btn btn--secondary" href="#social" data-od-id="cta-channels">
                채널 보러가기
              </a>
              <Link className="btn btn--accent" href="/games" data-od-id="cta-games">
                플레이한 게임 보기
              </Link>
            </div>
            <p className="hero__note">“천천히 놀다 가요, 쿠냥이 ﾐ๑•ﻌ•๑ﾐ”</p>
          </div>

          <LandingKeyVisual />
        </div>
      </section>

      {/* PROFILE SPEC */}
      <section className="profile" aria-labelledby="profile-h2" data-od-id="profile">
        <div className="wrap">
          <div className="profile__head">
            <h2 id="profile-h2" data-od-id="profile-title">
              쿠냐 프로필
            </h2>
          </div>
          <div className="profile__grid">
            <figure className="polaroid profile__photo" data-od-id="profile-photo">
              <span className="tape" aria-hidden="true">
                Kunya ♡
              </span>
              <img
                src="/assets/kunya-portrait-600.png"
                width={600}
                height={763}
                loading="lazy"
                decoding="async"
                alt="챠이로 쿠냐 상반신 — 트윈테일 갈색 머리에 고양이 프린트 검은 오프숄더 스웨터를 입은 모습"
              />
              <figcaption>오늘도 방송에서 만나요</figcaption>
            </figure>
            <dl className="spec" data-od-id="profile-spec">
              <div className="paper spec__item">
                <dt>이름</dt>
                <dd>챠이로 쿠냐</dd>
              </div>
              <div className="paper spec__item">
                <dt>나이</dt>
                <dd>영원한 20살</dd>
              </div>
              <div className="paper spec__item">
                <dt>생일</dt>
                <dd>10월 5일</dd>
              </div>
              <div className="paper spec__item">
                <dt>팬네임</dt>
                <dd>쿠냥이</dd>
              </div>
              <div className="paper spec__item">
                <dt>MBTI</dt>
                <dd>INFP</dd>
              </div>
              <div className="paper spec__item">
                <dt>데뷔일</dt>
                <dd>2025.12.20</dd>
              </div>
              <div className="paper spec__item spec__item--wide">
                <dt>한마디</dt>
                <dd>
                  저챗에선 한없이 다정하다가, 호러도 소울라이크도 아무렇지 않게 집어듭니다. 그
                  온도차가 쿠냐예요.
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* CONTENT */}
      <section className="content" aria-labelledby="content-h2" data-od-id="contents">
        <div className="wrap">
          <div className="profile__head">
            <h2 id="content-h2" data-od-id="contents-title">
              주요 컨텐츠
            </h2>
          </div>
          <div className="content__grid" data-od-id="contents-grid">
            <div className="paper ccard" data-od-id="content-card-chat">
              <svg
                className="ccard__ic"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 5h16v11H8l-4 3z" />
              </svg>
              <h3>저챗</h3>
              <p>저스트 채팅. 하루 이야기, 고민 상담, 쿠냥이들과 도란도란 수다 떠는 시간.</p>
            </div>
            <div className="paper ccard" data-od-id="content-card-games">
              <svg
                className="ccard__ic"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="7" width="18" height="10" rx="3" />
                <path d="M8 11v2M7 12h2M15.5 11.5h.01M17.5 13.5h.01" />
              </svg>
              <h3>종합 게임</h3>
              <p>장르 가리지 않는 종합 게임 방송. 힐링부터 호러·소울라이크까지 폭넓게.</p>
            </div>
            <div className="paper ccard" data-od-id="content-card-song">
              <svg
                className="ccard__ic"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 18V5l11-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="17" cy="16" r="3" />
              </svg>
              <h3>노래</h3>
              <p>가끔 찾아오는 노래 방송. 잔잔한 발라드부터 신나는 애니송까지.</p>
            </div>
          </div>
        </div>
      </section>

      {/* SOCIAL */}
      <section className="social" id="social" aria-labelledby="social-h2" data-od-id="social">
        <div className="wrap">
          <div className="paper social__panel" data-od-id="social-panel">
            <span className="clip" aria-hidden="true" />
            <ThemedImg
              className="social__mascot"
              lightSrc="/assets/kunyang-mascot-ink.png"
              darkSrc="/assets/kunyang-mascot.png"
              width={206}
              height={308}
              loading="lazy"
              decoding="async"
              alt="팬 마스코트 쿠냥이 — 박쥐 날개를 단 검은 고양이"
            />
            <h2 id="social-h2" data-od-id="social-title">
              어디서 만날까냥
            </h2>
            <p>치지직에서 방송하고, 유튜브에 클립 올리고, X로 소식 전해요.</p>
            {/* role="listitem" 을 <a> 에 붙이면 link role 이 덮여 스크린리더가 링크로
                announce 하지 않는다 — 네이티브 <ul>/<li> 로 감싼다. */}
            <ul className="social__row" data-od-id="social-links">
              <li>
                <a
                  className="slink"
                  href="https://chzzk.naver.com/97c69a12835bba786fb82f2c849f2ba8"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-od-id="social-link-chzzk"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="3" y="5" width="18" height="14" rx="3" />
                    <path className="slink__glyph" d="M8 9l6 3-6 3z" />
                  </svg>
                  치지직 <small>라이브</small>
                  <span className="sr-only">(새 창에서 열림)</span>
                </a>
              </li>
              <li>
                <a
                  className="slink"
                  href="https://www.youtube.com/@CHYAILOKUNYA"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-od-id="social-link-youtube"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
                    <path className="slink__glyph" d="M10 9l5 3-5 3z" />
                  </svg>
                  YouTube <small>@CHYAILOKUNYA</small>
                  <span className="sr-only">(새 창에서 열림)</span>
                </a>
              </li>
              <li>
                <a
                  className="slink"
                  href="https://x.com/chyailokunya"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-od-id="social-link-x"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M3 3h4.5l4 5.6L16.5 3H21l-6.6 8.4L21.5 21H17l-4.4-6.1L7 21H3l7-8.9z" />
                  </svg>
                  X <small>@chyailokunya</small>
                  <span className="sr-only">(새 창에서 열림)</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
