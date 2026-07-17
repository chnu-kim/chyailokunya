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
    ],
  },
  ...next,
];

export default eslintConfig;
