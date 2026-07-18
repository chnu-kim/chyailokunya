/**
 * 레이어 경계. 의존은 아래로만 흐른다:
 *
 *   components/ui  →  features  →  db  →  core
 *
 * core 는 순수 도메인(HTTP·DB·React 무관), db 는 core 만, features 는 db·core 만,
 * components/ui 는 features 프리미티브만 안다. app/ 는 조립 지점이라 어디든 쓸 수 있다.
 * 이 방향을 기계가 강제하므로, 위로 새는 import 는 CI 에서 빨갛게 죽는다.
 */
module.exports = {
  forbidden: [
    {
      name: "core-is-pure",
      comment: "src/core 는 순수 도메인 — db·features·components·app 어디에도 의존하지 않는다.",
      severity: "error",
      from: { path: "^src/core" },
      to: { path: "^src/(db|features|components|app)" },
    },
    {
      name: "db-only-core",
      comment: "src/db 는 core 만 안다 — features·components·app 로 올라가지 않는다.",
      severity: "error",
      from: { path: "^src/db" },
      to: { path: "^src/(features|components|app)" },
    },
    {
      name: "features-below-ui",
      comment:
        "src/features 는 db·core 만 안다 — components/ui·app 에 의존하지 않는다(UI 가 features 를 쓴다).",
      severity: "error",
      from: { path: "^src/features" },
      to: { path: "^src/(components|app)" },
    },
    {
      name: "ui-uses-features-not-data",
      comment:
        "src/components/ui 는 프리미티브 — db·core 를 직접 건드리지 말고 features 를 통한다.",
      severity: "error",
      from: { path: "^src/components" },
      to: { path: "^src/(db|core|app)" },
    },
    {
      name: "middleware-below-ui",
      comment:
        "src/middleware.ts 는 위치가 루트로 고정된 요청 진입점이라 레이어 디렉터리 밖에 " +
        "있다 — 그래서 다른 규칙의 from 패턴(core|db|features|components)에 안 걸린다. 매 요청 " +
        "도는 코드가 컴포넌트 트리나 app 모듈을 끌어오면 번들이 부풀고 next/headers 가 안 도는 " +
        "컨텍스트로 딸려오므로, features 와 같은 높이로 명시해 둔다.",
      severity: "error",
      from: { path: "^src/middleware\\.ts$" },
      to: { path: "^src/(components|app)" },
    },
    {
      name: "no-circular",
      comment: "순환 의존은 레이어 경계가 무너졌다는 신호.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "어디서도 import 되지 않는 모듈(테스트·타입선언·설정 제외).",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: ["\\.(d\\.ts|test\\.ts|spec\\.ts)$", "(^|/)\\.gitkeep$"],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".js", ".jsx", ".ts", ".tsx"],
      mainFields: ["module", "main", "types"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
