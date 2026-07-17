# 내부 참고 페이지 (frozen 스냅샷)

구 정적 사이트(`chnu-kim/chyaro-kunya`)의 **내부용 `noindex` 페이지 3종**을 소스 그대로
얼려 둔 것이다. 셋 다 공개 화면이 아니라 디자인 결정을 기록·검증하려고 만든 참고 도구라
Phase 2 에서 **앱 라우트로 이식하지 않았다**(에픽 #1 · 이슈 #4). 사양이 사라지지 않게
소스만 보존한다.

| 파일 | 무엇 |
|---|---|
| `logo-identity-directions.html` | 로고 아이덴티티 확정 스펙 — C 카오모지(`#mk-kao`)와 A 잉크 도장(favicon) 한 쌍의 근거 |
| `og-cover.html` | OG 커버(1200×630) 렌더 타깃 — 조판·도장 워터마크 포함 |
| `paw-shape-compare.html` | 발바닥 세로 길이 3안(`deco-paw` / `-tall` / `-flat`) 비교 |

## 어떻게 여나

이 디렉터리는 자체 완결적이다 — 원본이 의존하던 구 크롬(`css/site.css` · `js/site.js`),
`favicon.svg`, 참조 에셋을 상대 경로 그대로 함께 얼려 두었다. 로컬에서 그냥 열면 된다:

```bash
python3 -m http.server -d docs/reference   # → http://localhost:8000/og-cover.html
```

## 주의 — 이건 유지보수 대상이 아니다

여기 `css/site.css` · `js/site.js` 는 **구 정적 사이트의 사본**이고, 라이브 앱의 정본은
`src/app/globals.css` + `src/app/chrome.css`(토큰·크롬)와 각 컴포넌트다. 디자인 토큰을
바꿔도 이 스냅샷은 따라오지 않는다 — 참고용 화석이라 그게 맞다. 로고·발바닥 도형을
**실제로** 고칠 땐 라이브 소스(SVG 심볼은 `src/components/ui/svg-defs.tsx`)를 고친다.

## `og-cover.html` 이 아직 쓸모 있는 이유

`public/assets/og-cover.jpg` 는 `og-cover.html` 을 렌더한 결과가 **아니다**(데뷔 사진을
1200×630 에 패딩한 것이라 조판·도장 워터마크가 빠져 있다). 이 런타임엔 HTML→이미지 렌더
경로가 없어, 조판까지 반영한 커버가 필요하면 이 페이지를 브라우저로 열어 1200×630 으로
캡처한 뒤 `public/assets/og-cover.jpg` 를 교체한다.
