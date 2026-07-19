// 라이트/다크 테마 계약의 정본. localStorage 키·data-theme 속성·"light"/"dark" 값이
// layout(pre-paint 스크립트)·use-theme·theme-toggle·themed-img 네 곳에서 각자 리터럴로
// 반복되면 한쪽만 고쳐도 컴파일은 통과하고 런타임에서만(새로고침마다 테마가 튐) 터진다.
// 여기 상수를 씀으로써 어긋남을 컴파일러가 잡게 만든다.
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
export const THEME_ATTR = "data-theme";
export const THEME_LIGHT: Theme = "light";
export const THEME_DARK: Theme = "dark";

// 첫 페인트 전에 테마를 확정해 라이트 모드 깜빡임을 없앤다 — localStorage 우선, 없으면
// OS 선호. 이 문자열은 <script dangerouslySetInnerHTML> 로 그대로 박히는 동기 인라인
// 코드라 반드시 문자열이어야 한다(React 컴포넌트·모듈 스코프 클로저로는 첫 페인트 전
// 실행을 못 만든다) — 그래서 위 상수를 문자열 리터럴로 인라인해 조립만 한다.
export function buildThemeInitScript(): string {
  return `(function(){try{
var t=localStorage.getItem("${THEME_STORAGE_KEY}");
if(t!=="${THEME_LIGHT}"&&t!=="${THEME_DARK}"){t=matchMedia("(prefers-color-scheme: dark)").matches?"${THEME_DARK}":"${THEME_LIGHT}";}
document.documentElement.setAttribute("${THEME_ATTR}",t);
}catch(e){}})();`;
}
