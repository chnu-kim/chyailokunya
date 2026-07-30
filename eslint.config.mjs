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
      // istanbul HTML 리포트(gitignore 됨). 안 빼면 리포터의 번들 js 가 lint 경고를 낸다.
      "coverage/**",
      // 병행 세션의 git worktree — 저장소 안쪽 경로라 안 빼면 남의 체크아웃을 통째로 다시
      // 린트한다(근거는 .prettierignore 의 같은 항목).
      ".claude/worktrees/**",
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

      /* `Temporal.Now` 금지(2026-07-31 프로덕션 인시던트). 배포된 Workers 엔 **네이티브
         Temporal** 이 있고 `temporal-polyfill` 이 그걸 우선 쓰는데(`NativeTemporal || 폴리필`),
         그 `Now` 가 요청 시계에 안 물려 **에포크 0** 을 돌려줬다 — `/schedule` 이 1969-12-29 주를
         그렸다. 같은 런타임에서 `Date.now()` 와 Temporal 의 산술·존 변환은 멀쩡했다.

         **로컬 게이트로는 이 자리를 못 막는다** — 유닛(vitest workerd)·preview(wrangler dev)엔
         네이티브 Temporal 이 없어 폴리필이 답하고 e2e 는 Node 다. 셋 다 초록인 채 라이브만
         깨졌다. 그래서 "런타임이 답을 다르게 준다"가 아니라 **"그 API 를 애초에 안 쓴다"** 로
         잠근다. 시계는 `Date.now()` 로 읽고 변환만 Temporal 에 맡긴다(core/calendar.ts 의
         `todayKST`·`dateOfInstantKST`). */
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Temporal'][property.name='Now']",
          message:
            "Temporal.Now 는 프로덕션 Workers 에서 에포크 0 을 돌려준다(2026-07-31 인시던트). 시계는 Date.now() 로 읽고 core/calendar.ts 의 todayKST·dateOfInstantKST 를 쓴다.",
        },
      ],
    },
  },
];

export default eslintConfig;
