/* 인라인 SVG 심볼 정의 — nav·푸터의 카오모지(#mk-kao)와 발바닥(#mk-paw). 레이아웃이
   body 최상단에서 한 번 렌더하므로 모든 라우트가 <use href="#..."> 로 참조한다(클라이언트
   내비게이션에도 레이아웃은 리마운트되지 않아 계속 살아 있다).

   인라인인 이유: 외부 스프라이트 <use href="sprite.svg#..."> 는 file:// 와 크로스오리진에서
   죽는다. 채움을 참조부가 아니라 심볼에 거는 이유: SVG 기본 fill 은 currentColor 가 아니라
   검정이라, 참조부에서 color 만 바꾸면 다크 테마 종이 위에 검은 자국이 그대로 남는다.
   발바닥 도형의 정본은 구 저장소 assets/deco-paw.svg. */
export function SvgDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      {/* C 카오모지 — 쿠냐가 쓰는 얼굴 ﾐ๑•ﻌ•๑ﾐ 를 기하학으로 다시 그린 64×22 얼굴 */}
      <symbol id="mk-kao" viewBox="0 0 64 22">
        <circle cx="24" cy="6.5" r="3.6" />
        <circle cx="40" cy="6.5" r="3.6" />
        <path d="M32 14.3l-3.2-2.8h6.4z" />
        <g fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
          <path d="M32 14.3v1.8" />
          <path d="M32 16.1c-1.7 3.2-5.8 3.2-6.8-.4" />
          <path d="M32 16.1c1.7 3.2 5.8 3.2 6.8-.4" />
          <path d="M3 2.5h9M3 9.5h9M3 16.5h9" />
          <path d="M52 2.5h9M52 9.5h9M52 16.5h9" />
        </g>
      </symbol>

      {/* 발바닥 — 발가락과 발바닥 사이 여백(실측 최소 3.6)이 유일한 제약: 전부 같은
          fill 이라 닿는 순간 union 으로 뭉쳐 발가락이 사라진다. */}
      <symbol id="mk-paw" viewBox="0 0 64 64" fill="currentColor">
        <ellipse cx="22.4" cy="17.6" rx="7.4" ry="9.1" transform="rotate(-7 22.4 17.6)" />
        <ellipse cx="41.6" cy="17.6" rx="7.4" ry="9.1" transform="rotate(7 41.6 17.6)" />
        <ellipse cx="9.2" cy="30" rx="7.4" ry="9.1" transform="rotate(-34 9.2 30)" />
        <ellipse cx="54.8" cy="30" rx="7.4" ry="9.1" transform="rotate(34 54.8 30)" />
        <path d="M32 29.4C35.3 30.6 40.4 32.2 43.2 35.7C46.3 39.4 48.9 42.6 48.8 46.6C48.7 51.3 45.6 55.1 40.6 55.4C37.2 55.6 34.2 54.9 32 53.6C29.8 54.9 26.8 55.6 23.4 55.4C18.4 55.1 15.3 51.3 15.2 46.6C15.1 42.6 17.7 39.4 20.8 35.7C23.6 32.2 28.7 30.6 32 29.4Z" />
      </symbol>
    </svg>
  );
}
