/* 공유 푸터 — 모든 라우트 동일. 서버 컴포넌트라 저작권 연도를 렌더 시점에 넣는다
   (구 site.js 는 클라이언트에서 채웠지만, 서버에서 그리면 JS 없이 끝난다).
   마스코트는 두 테마 모두 흰 아트워크 — 페이지 테마를 안 따르는 다크 브라운 푸터
   표면 위에 앉으므로 스왑하지 않는다(aria-hidden 장식). */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="foot" data-od-id="site-footer">
      <div className="foot__inner">
        <div className="brand">
          <svg className="brand__cat" aria-hidden="true">
            <use href="#mk-kao" />
          </svg>
          <span className="brand__name">챠이로 쿠냐</span>
        </div>
        <small>
          © <span>{year}</span> Chyailo Kunya · 비공식 팬 사이트 · 쿠냥이 환영
        </small>
        <img
          className="foot__mascot"
          src="/assets/kunyang-mascot.png"
          width={206}
          height={308}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
        />
      </div>
    </footer>
  );
}
