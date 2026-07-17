import next from "eslint-config-next";

// Next 16 은 `next lint` 를 제거했고 eslint-config-next 는 네이티브 flat config 배열을
// 기본 export 한다(next + next/typescript 포함). FlatCompat 로 감싸면 ESLint 9 에서
// 순환참조로 죽으므로 그대로 spread 한다.
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "node_modules/**",
      // 생성물 — 손대지 않으므로 린트 대상 아님(자체 eslint-disable 주석이 노이즈를 낸다).
      "next-env.d.ts",
      "cloudflare-env.d.ts",
      // 구 정적 사이트의 frozen 스냅샷(내부 참고 페이지) — 원본 소스 그대로 보존한다.
      "docs/reference/**",
    ],
  },
  ...next,
  {
    rules: {
      // 이 사이트의 이미지는 사용자가 준비한 정적 팬아트다. Workers 에는 Next 이미지
      // 옵티마이저 로더가 없어(별도 셋업 필요) next/image 가 이득이 없고, 폴라로이드
      // object-fit·컷아웃 filter 처리엔 평범한 <img> 가 더 예측 가능하다. width/height 로
      // CLS 는 이미 막는다. 실측 파생본(-720/-600/-336)을 직접 참조하므로 규칙을 끈다.
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
