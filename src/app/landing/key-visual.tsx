"use client";

import { useEffect, useRef } from "react";

/* 히어로 키비주얼 — 커서를 광원으로 삼아 컷아웃 그림자를 움직인다. 구 site.js 의 .kv
   추적을 컴포넌트로 옮긴 것: JS 는 "커서가 어디냐"만 -1..1 로 정규화해 CSS 변수로 넘기고,
   "그래서 어떻게 보이냐"(그림자 오프셋·시차)는 landing.css 의 .kv__img 가 정한다. 적용
   여부도 CSS 의 hover/reduced-motion 쿼리가 최종 결정하므로 여기 hover 체크는 정책이
   아니라 터치 기기에서 헛도는 리스너를 안 다는 최적화다.

   rect 를 pointerenter 에 캐시하지 않는다: .kv 가 없지만 그 안 이미지가 호버 220ms 동안
   움직여 rect 가 계속 바뀐다. 읽기는 핸들러, 쓰기는 rAF 로 분리해 프레임당 레이아웃 1회. */
export function LandingKeyVisual() {
  const kvRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const kv = kvRef.current;
    if (!kv || !window.matchMedia || !window.matchMedia("(hover: hover)").matches) return;

    let raf = 0;
    let lx = 0;
    let ly = 0;
    const flush = () => {
      raf = 0;
      kv.style.setProperty("--kv-lx", lx.toFixed(3));
      kv.style.setProperty("--kv-ly", ly.toFixed(3));
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const clamp = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

    const onMove = (e: PointerEvent) => {
      const r = kv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // 액자가 기울어 rect 는 회전 후 바운딩 박스다 — 모서리로 들어오면 1 을 넘길 수 있어 clamp.
      lx = clamp(((e.clientX - r.left) / r.width) * 2 - 1);
      ly = clamp(((e.clientY - r.top) / r.height) * 2 - 1);
      queue();
    };
    const onLeave = () => {
      lx = 0;
      ly = 0;
      queue();
    };

    kv.addEventListener("pointermove", onMove);
    kv.addEventListener("pointerleave", onLeave);
    return () => {
      kv.removeEventListener("pointermove", onMove);
      kv.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <figure className="hero__photo" data-od-id="landing-key-visual">
      <div className="kv" ref={kvRef}>
        <span className="kv__ribbon" aria-hidden="true" />
        <span className="clip" aria-hidden="true" />
        <div className="kv__page">
          <span className="kv__mark t-script" aria-hidden="true">
            Kunya
          </span>
          {/* 걸어간 자국이라 좌우로 흔들린다. 이동은 transform 으로 통일하고 회전은 심볼
              로컬 중심(32,32) 기준으로 건다. 폭 85·x 원점 -2 는 건드리지 않는다(CSS 가
              폭을 48px 로 고정해 발자국 크기가 48/85 로 정해진다) — 높이만 트레일 길이에 맞춘다. */}
          <svg className="kv__paws" viewBox="-2 -3 85 182" aria-hidden="true">
            <use
              href="#mk-paw"
              width="64"
              height="64"
              transform="translate(12 0) rotate(-14 32 32)"
            />
            <use
              href="#mk-paw"
              width="64"
              height="64"
              transform="translate(0 60) rotate(6 32 32)"
            />
            <use
              href="#mk-paw"
              width="64"
              height="64"
              transform="translate(10 120) rotate(-8 32 32)"
            />
          </svg>
          <svg className="kv__cat" viewBox="0 0 40 34" aria-hidden="true">
            <path
              className="kv__cat-head"
              d="M5.5 1.5l7 5.4a19.5 19.5 0 0 1 15 0l7-5.4 1.4 10.2A15.4 15.4 0 0 1 20 33 15.4 15.4 0 0 1 4.1 11.7z"
            />
            <circle className="kv__cat-eye" cx="14" cy="18" r="1.9" />
            <circle className="kv__cat-eye" cx="26" cy="18" r="1.9" />
            <path className="kv__cat-mouth" d="M17 24.5c1.5 1.6 4.5 1.6 6 0" />
          </svg>
          <img
            className="sticker kv__img"
            src="/assets/kunya-full-720.png"
            width={720}
            height={973}
            fetchPriority="high"
            alt="챠이로 쿠냐 전신 — 하트 모양으로 솟은 머리카락 한 올, 검은 리본과 흰 고양이 방울로 묶은 갈색 트윈테일, 날개 달린 흰 고양이가 프린트된 검은 오프숄더 스웨터, 회색 레이스 프릴과 검은 주름 미니스커트, 끈 달린 검은 플랫폼 부츠"
          />
        </div>
      </div>
    </figure>
  );
}
