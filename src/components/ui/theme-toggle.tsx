"use client";

import { useEffect } from "react";
import { useTheme, type Theme } from "./use-theme";
import { THEME_ATTR, THEME_DARK, THEME_LIGHT, THEME_STORAGE_KEY } from "./theme-contract";

/* 라이트/다크 토글. 이름은 고정하고 상태만 바꾼다: 스크린리더는 접근 이름과 상태를
   이어 읽으므로 둘 다 상태를 따라가면 서로를 부정한다 — 이름이 "지금 누르면 무엇이
   되는지"(다크 모드)를 말하는 동안 aria-pressed 만 켜졌는지를 말한다. */
export function ThemeToggle() {
  const theme = useTheme();

  // 저장된 명시 선택이 없을 때만 OS 변화를 따라간다. data-theme(외부 DOM 상태)만
  // 바꾸고 React state 는 안 건드린다 — useTheme 의 MutationObserver 가 라벨을 갱신한다.
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        // storage 가 막혀 있어도 리스너 자체는 무해하게 넘어간다.
      }
      if (saved === THEME_LIGHT || saved === THEME_DARK) return;
      document.documentElement.setAttribute(THEME_ATTR, e.matches ? THEME_DARK : THEME_LIGHT);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next: Theme = theme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    document.documentElement.setAttribute(THEME_ATTR, next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // private mode 등에서 storage 가 막혀도 토글 자체는 동작해야 한다.
    }
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      data-od-id="theme-toggle"
      onClick={toggle}
      aria-pressed={theme === THEME_DARK}
      aria-label="다크 모드"
      suppressHydrationWarning
    >
      <svg
        className="icon-sun"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M19.4 4.6l-1.8 1.8M6.4 17.6l-1.8 1.8" />
      </svg>
      <svg className="icon-moon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
      </svg>
    </button>
  );
}
