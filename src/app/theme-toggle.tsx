"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

// data-theme 는 React 밖의 외부 상태(첫 페인트 전 인라인 스크립트가 심고, 여기 토글이
// 뒤집는다). 그래서 effect+setState 로 흉내내지 않고 useSyncExternalStore 로 "구독"한다 —
// MutationObserver 가 속성 변화를 감지하면 스냅샷을 다시 읽으므로, 토글은 DOM 만 바꾸면
// 라벨이 저절로 따라온다. 계산은 한 곳(DOM), React 는 반영만 — 두 값이 어긋날 여지가 없다.
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

// 서버에는 DOM 이 없다 — 인라인 스크립트가 클라이언트에서 정하므로 SSR 은 라이트로 그린다.
function getServerSnapshot(): Theme {
  return "light";
}

// Phase 2 에서 구 site.js 의 접근성 갖춘 토글로 교체된다. 지금은 토큰 플립을 눈으로/스모크로
// 확인하는 최소 데모.
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // private mode 등에서 storage 가 막혀도 토글 자체는 동작해야 한다.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      suppressHydrationWarning
      className="border-border-strong text-fg rounded-pill w-fit border px-5 py-3 text-sm"
    >
      테마 전환 · 현재 {theme === "dark" ? "다크" : "라이트"}
    </button>
  );
}
