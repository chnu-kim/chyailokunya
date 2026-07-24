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
   대상이라 저장소에 들어가지 않는다(불변식 4) — 프로덕션 키와는 아무 관계 없는 테스트 키다.
   커밋된 고정 키쌍으로 두면 이 재사용 분기가 통째로 사라지지만, 저장소에 개인키 모양의
   문자열을 두지 않는 쪽을 택했다 — 불변식 4 는 "무엇을 지키는 키인가"보다 먼저 읽힌다. */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair } from "jose";

// cwd 가 아니라 이 스크립트 기준(e2e/session.ts 가 같은 규칙으로 읽는다) — Playwright 는
// webServer 를 config 디렉터리에서 띄우고 테스트 워커는 셸의 cwd 를 쓴다.
const PATH = fileURLToPath(new URL("../.dev.vars.e2e", import.meta.url));

const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
const priv = { ...(await exportJWK(privateKey)), kid: "v1", alg: "EdDSA" };
const pub = { ...(await exportJWK(publicKey)), kid: "v1", alg: "EdDSA" };

/* NEXTJS_ENV 는 `.dev.vars` 에서 물려받지 않는다 — wrangler 의 탐색은 병합이 아니라 **택일**
   이라 이 파일이 그걸 통째로 대체한다. 그래서 여기 다시 적는다.
   같은 이유로 이 환경엔 CHZZK_*·SUPERADMIN_CHANNEL_ID 가 없다(외부 API·부트스트랩을 안 탄다).

   **AUTH_URL 은 이제 있다.** 일정 편집기(이슈 #56)가 첫 쓰기 e2e 라, 상태를 바꾸는 tRPC 뮤테이션
   (saveWeek)이 Origin 검사(rejectForeignOrigin)를 탄다 — fail-closed 라 AUTH_URL 이 없으면 무조건
   403("forbidden origin")이다. dev 서버가 뜨는 실제 origin 과 **정확히**(포트 포함) 같아야 검사가
   통과한다(isAllowedOrigin 은 URL.origin 완전 일치라 포트가 다르면 거절). PORT 는 이 스크립트를
   부른 webServer 커맨드가 물려준 process.env 에서 읽는다(playwright.config 의 PORT 와 같은 값).

   AUTH_URL 은 **키를 건드리지 않고 자가 치유한다**(아래 재사용 분기): 이 변경 이전에 만든 파일엔
   AUTH_URL 이 없고, 포트를 바꿔 돌리면(3000 ↔ 3100) 옛 포트가 남는데 — 둘 다 쓰기 e2e 를 403 으로
   만든다. 그래서 재사용 시 그 줄만 현재 포트로 갈아 끼운다(키는 그대로라 살아 있는 서버의 검증은
   안 흔들린다). 손으로 파일을 지울 필요가 없다. */
const PORT = process.env.PORT ?? "3000";
const AUTH_URL_LINE = `AUTH_URL=http://localhost:${PORT}`;
const body = [
  "# e2e 전용(자동 생성, 커밋 금지). 지울 땐 dev 서버도 같이 내린다 — 살아 있는 서버는",
  "# 부팅 때 읽은 옛 키로 계속 검증해서, 새로 만든 키로 서명한 세션이 전부 거절된다.",
  "NEXTJS_ENV=development",
  `JWT_SIGNING_JWK=${JSON.stringify(priv)}`,
  `JWT_PUBLIC_JWK=${JSON.stringify(pub)}`,
  AUTH_URL_LINE,
  "",
].join("\n");

/* existsSync → writeFileSync 로 나누면 TOCTOU 다. `npm run e2e` 와 `e2e:visual` 은 둘 다 같은
   기본 포트에 reuseExistingServer 라 동시에 돌리는 게 자연스러운데, 그때 둘 다 "없음"을 보고
   각자 키를 쓰면 나중 것이 먼저 뜬 서버의 키를 덮어 세션이 통째로 거절된다. wx 는 생성과 존재
   확인이 한 번의 시스템 콜이라 그 창이 없다. */
try {
  writeFileSync(PATH, body, { flag: "wx" });
  console.log(`[e2e] ${PATH} 생성 — 세션 서명 키(EdDSA) + AUTH_URL`);
} catch (e) {
  if (e.code !== "EEXIST") throw e;
  /* 이미 있으면 **키는 보존한다**(살아 있는 서버가 그 키로 검증 중일 수 있어 재생성하면 세션이
     통째로 거절된다 — 위 wx 근거). 하지만 AUTH_URL 은 현재 포트로 맞춘다: 옛 파일엔 아예 없거나
     다른 포트라 그대로 두면 쓰기 e2e 가 403 이다. 키 줄은 그대로 두고 AUTH_URL 줄만 갈아 끼운다.
     같은 키·같은 포트를 다시 쓰는 멱등 연산이라, 동시 실행이 겹쳐도 결과가 같다(키 생성 경쟁과
     달리 클로버가 없다 — 그래서 여기선 read→write 로 나눠도 안전하다). */
  const lines = readFileSync(PATH, "utf8").split("\n");
  if (lines.includes(AUTH_URL_LINE)) {
    console.log(`[e2e] ${PATH} 재사용`);
  } else {
    const patched = lines.filter((l) => !l.startsWith("AUTH_URL="));
    while (patched.length && patched[patched.length - 1] === "") patched.pop();
    patched.push(AUTH_URL_LINE, "");
    writeFileSync(PATH, patched.join("\n"));
    console.log(`[e2e] ${PATH} 키 보존 · AUTH_URL 갱신(${AUTH_URL_LINE})`);
  }
}
