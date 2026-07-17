/* site.js — 모든 페이지가 공유하는 크롬:
   ① 라이트/다크(Gothic Punk) 테마 토글 + localStorage 지속
   ② 테마에 따라 src 를 바꿔야 하는 이미지 스왑
   ③ 푸터 저작권 연도
   ④ landing.html 히어로 키비주얼의 광원 추적 (해당 요소가 있을 때만)

   초기 테마는 각 페이지 <head> 의 인라인 스크립트가 첫 페인트 전에 이미
   적용한다. 여기서는 그 결과를 읽어 토글 상태만 맞추므로, 두 곳이 서로 다른
   값을 계산할 여지가 없다. */
(function () {
  var KEY = 'ck-theme';
  var root = document.documentElement;

  /* 테마별 아트워크 스왑.
     display:none 으로 두 장을 겹쳐두면 브라우저가 둘 다 내려받고, CSS
     content:url() 로 바꾸면 <img> 의 alt 노출이 엔진마다 달라진다. src 를
     직접 갈아끼우면 한 장만 받고 접근성 트리도 그대로다. */
  function swapImages(theme) {
    var imgs = document.querySelectorAll('[data-img-light][data-img-dark]');
    for (var i = 0; i < imgs.length; i++) {
      var next = imgs[i].getAttribute(theme === 'dark' ? 'data-img-dark' : 'data-img-light');
      if (next && imgs[i].getAttribute('src') !== next) imgs[i].setAttribute('src', next);
    }
  }

  /* 이름은 고정하고 상태만 바꾼다. 스크린리더는 접근 이름과 상태를 이어 읽으므로
     둘 다 상태를 따라가면 서로를 부정한다 — 이름이 "지금 누르면 무엇이 되는지"를
     말하는 동안 상태가 눌림이라고 하면, 그 반대쪽 테마가 켜진 것으로 들린다.
     ARIA 토글 버튼 패턴이 이름 고정을 요구하는 이유다. 이름은 무엇을 켜고 끄는지를
     말하고 켜졌는지는 aria-pressed 만 말한다. 이름을 스크립트가 아니라 각 페이지
     마크업에 직접 적어 두는 것도 같은 이유다 — 스크립트가 죽어도 이름은 남는다.
     토글을 쓰는 페이지가 여럿이니 이름을 바꿀 땐 전부 같이 바꾼다. */
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(theme === 'dark'));
    }
    swapImages(theme);
  }

  function current() {
    var t = root.getAttribute('data-theme');
    return t === 'dark' ? 'dark' : 'light';
  }

  apply(current());

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!btn) return;
    var next = current() === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem(KEY, next); } catch (err) {}
  });

  /* 사용자가 직접 고른 적이 없을 때만 OS 설정 변화를 따라간다. */
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function (e) {
      var saved;
      try { saved = localStorage.getItem(KEY); } catch (err) {}
      if (saved === 'light' || saved === 'dark') return;
      apply(e.matches ? 'dark' : 'light');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  var years = document.querySelectorAll('[data-year]');
  for (var j = 0; j < years.length; j++) years[j].textContent = String(new Date().getFullYear());

  /* 히어로 키비주얼의 광원 — 커서 위치를 -1..1 로 정규화해 CSS 변수로만 넘긴다.
     그림자 오프셋과 시차 거리는 landing.html 의 .kv__img 가 계산한다: JS 는
     "커서가 어디냐"만 알고, "그래서 어떻게 보이냐"는 CSS 가 정한다. 적용 여부도
     CSS 의 hover/reduced-motion 쿼리가 최종 결정하므로 여기서 중복 판단하지
     않는다 — 아래 hover 체크는 정책이 아니라 터치 기기에서 헛도는 리스너를
     안 다는 최적화다.

     rect 를 pointerenter 에 캐시하지 않는 이유: .hero__photo 가 호버 220ms 동안
     rotate/translateY 로 움직여서 그 사이 rect 가 계속 바뀐다. 읽기는 핸들러,
     쓰기는 rAF 로 분리해 프레임당 레이아웃 1회로 묶는다. */
  var kv = document.querySelector('.kv');
  if (kv && window.matchMedia && window.matchMedia('(hover: hover)').matches) {
    var raf = 0, lx = 0, ly = 0;
    var flush = function () {
      raf = 0;
      kv.style.setProperty('--kv-lx', lx.toFixed(3));
      kv.style.setProperty('--kv-ly', ly.toFixed(3));
    };
    var queue = function () { if (!raf) raf = requestAnimationFrame(flush); };
    var clamp = function (v) { return v < -1 ? -1 : v > 1 ? 1 : v; };

    kv.addEventListener('pointermove', function (e) {
      var r = kv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      /* 액자가 기울어 있어 rect 는 회전 후 바운딩 박스다 — 모서리로 들어오면
         1 을 넘길 수 있어 clamp 로 막는다. */
      lx = clamp(((e.clientX - r.left) / r.width) * 2 - 1);
      ly = clamp(((e.clientY - r.top) / r.height) * 2 - 1);
      queue();
    });
    kv.addEventListener('pointerleave', function () { lx = 0; ly = 0; queue(); });
  }
}());
