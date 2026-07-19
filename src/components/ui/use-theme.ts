import { useSyncExternalStore } from "react";
import { THEME_ATTR, THEME_DARK, THEME_LIGHT, type Theme } from "./theme-contract";

export type { Theme };

/* data-theme 는 React 밖의 외부 상태다 — 첫 페인트 전 인라인 스크립트(layout)가 심고,
   테마 토글이 뒤집는다. 그래서 effect+setState 로 흉내내지 않고 useSyncExternalStore 로
   "구독"한다(AGENTS 지뢰: effect 안 동기 setState 는 Next 16 에서 error). MutationObserver
   가 data-theme 변화를 감지하면 스냅샷을 다시 읽으므로, 어느 컴포넌트가 DOM 을 바꾸든
   테마를 읽는 모든 곳이 저절로 따라온다. 계산은 한 곳(DOM), React 는 반영만. */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTR],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute(THEME_ATTR) === THEME_DARK
    ? THEME_DARK
    : THEME_LIGHT;
}

// 서버에는 DOM 이 없다 — 인라인 스크립트가 클라이언트에서 정하므로 SSR 은 라이트로 그린다.
function getServerSnapshot(): Theme {
  return THEME_LIGHT;
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
