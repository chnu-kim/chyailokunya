/* e2e 전용 세션 서명 키를 `.dev.vars.e2e` 에 만든다(없을 때만). Playwright 의 webServer
   커맨드가 dev 서버보다 **먼저** 이걸 돌린다 — globalSetup 은 늦다(webServer 플러그인이
   globalSetup 보다 앞서 뜬다). 즉 서버가 부팅하며 키를 읽으려면 여기서 심어야 한다.

   왜 `.dev.vars.e2e` 인가 — 개발자의 `.dev.vars` 를 건드리지 않고 덮어쓰기 위해서다.
   wrangler 는 로컬 시크릿을 이 순서로 찾는다(getVarsForDev):
     1) `.dev.vars.<환경>`  ← 환경명이 있을 때만
     2) `.dev.vars`
     3) `.env`/process.env  ← **1·2 중 하나라도 있으면 아예 안 본다**
   그래서 process.env 로는 주입할 수 없다(대부분의 로컬에 `.dev.vars` 가 이미 있다).
   환경명은 playwright.config 가 `NEXT_DEV_WRANGLER_ENV=e2e` 로 넘긴다. wrangler.jsonc 에
   `env.e2e` 섹션은 **일부러 안 만든다** — 만들면 d1_databases 같은 비상속 키를 통째로 다시
   써야 해 프로덕션 설정이 갈라진다. 섹션이 없으면 wrangler 는 경고만 내고 최상위 설정을
   그대로 쓰므로(실측: DB 바인딩 유지) 원하는 건 `.dev.vars.e2e` 선택 하나뿐이다.

   키는 **한 번 만들고 재사용한다**(이미 있으면 그대로). 재생성하면 reuseExistingServer 로
   살아 있는 dev 서버가 옛 공개키로 검증해 전부 비로그인이 된다. 값은 gitignore(`.dev.vars*`)
   대상이라 저장소에 들어가지 않는다(불변식 4) — 프로덕션 키와는 아무 관계 없는 테스트 키다. */

import { existsSync, writeFileSync } from "node:fs";
import { exportJWK, generateKeyPair } from "jose";

const PATH = ".dev.vars.e2e";

if (existsSync(PATH)) {
  console.log(`[e2e] ${PATH} 재사용`);
  process.exit(0);
}

const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
const priv = { ...(await exportJWK(privateKey)), kid: "v1", alg: "EdDSA" };
const pub = { ...(await exportJWK(publicKey)), kid: "v1", alg: "EdDSA" };

// NEXTJS_ENV 는 `.dev.vars` 에서 물려받지 않는다 — 이 파일이 그걸 통째로 대체하기 때문에
// 여기 다시 적는다. 치지직 시크릿은 일부러 뺐다: 공개 읽기 e2e 는 외부 API 를 안 탄다.
writeFileSync(
  PATH,
  [
    "# e2e 전용(자동 생성, 커밋 금지). 지우면 다음 실행에서 새 키로 다시 만들어진다.",
    "NEXTJS_ENV=development",
    `JWT_SIGNING_JWK=${JSON.stringify(priv)}`,
    `JWT_PUBLIC_JWK=${JSON.stringify(pub)}`,
    "",
  ].join("\n"),
);
console.log(`[e2e] ${PATH} 생성 — 세션 서명 키(EdDSA)`);
