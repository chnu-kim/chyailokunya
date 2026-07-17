// Tailwind v4 는 PostCSS 플러그인(@tailwindcss/postcss)으로 붙인다. site.css 시절의
// @import 렌더블로킹 체인을 피하려고 CSS 진입점(globals.css)에서 @import "tailwindcss" 만 한다.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
