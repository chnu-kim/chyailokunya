#!/usr/bin/env node
/* 배포 후 프로덕션 스모크 — 검증 층 5(ADR-0029).

   **이 층이 있어야 하는 이유는 하나의 인시던트다.** 2026-07-27 에 `/api/og/schedule` 이
   Workers 무료 플랜의 요청당 CPU 10ms 를 넘겨 isolate 를 죽였고, 같은 isolate 를 타던 무관한
   요청까지 연쇄로 실패했다(Error 1102). **로컬 게이트 8종 중 어느 하나도 이걸 못 잡는다** —
   `next build`·`opennextjs-cloudflare build`·`npm run preview` 전부 빌드는 성립시키고, 프로덕션
   런타임 정책(CPU 한도)만 다르기 때문이다. 그때 이걸 발견한 건 게이트가 아니라 사람이었다.

   그래서 이 스크립트는 **배포된 진짜 origin 에 진짜 요청을 보낸다.** 읽기만 한다 — 쓰기 경로는
   건드리지 않는다(그건 프로덕션 데이터를 바꾸는 일이라 스모크가 할 일이 아니다).

   실패해도 **되돌리지 않는다.** D1 마이그레이션은 안 되돌아가므로 워커만 롤백하면 "구 워커 +
   새 스키마" 스큐가 되고, 그건 지금 상태보다 나쁠 수 있다(deploy.yml 주석이 경계하는 그 상태).
   워크플로를 빨갛게 만들어 사람을 부르는 것이 이 층의 일이다.

   사용: node scripts/post-deploy-smoke.mjs [origin]
   기본 origin 은 https://chyailokunya.com — 서빙하는 origin 은 이 apex 하나뿐이다(AGENTS). */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ORIGIN = (process.argv[2] ?? "https://chyailokunya.com").replace(/\/$/, "");

/* 라우트 목록의 정본은 `src/features/routes.ts` 다 — 여기에 손으로 베끼면 페이지를 추가할 때
   한쪽만 고쳐도 스모크가 조용히 그 페이지를 안 본다. Node 스크립트라 TS 를 import 할 수 없어
   정규식으로 읽고, **하나도 못 찾으면 죽는다**(fail-closed) — 파일 모양이 바뀌었는데 스모크가
   "검사할 게 없어서 통과"하는 것이 가장 나쁜 실패다. */
function knownPagePaths() {
  const src = readFileSync(
    fileURLToPath(new URL("../src/features/routes.ts", import.meta.url)),
    "utf8",
  );
  const hrefs = [...src.matchAll(/\{\s*href:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (hrefs.length === 0) {
    throw new Error(
      "src/features/routes.ts 에서 페이지 경로를 못 읽었다 — SITE_LINKS 모양이 바뀌었으면 이 " +
        "정규식도 같이 고친다. 검사 대상 0 으로 통과시키지 않는다.",
    );
  }
  /* 뽑은 값이 **우리 경로인지**도 본다. 오늘은 전부 루트 상대 경로지만, 그 배열에 외부 링크가
     하나 들어오는 순간 `${ORIGIN}https://…` 라는 쓰레기 URL 을 두드린다 — 최악은 남의 호스트에
     배포마다 요청을 보내는 것이다. "못 찾으면 죽는다"의 짝이 되는 가드다. */
  const foreign = hrefs.filter((href) => !href.startsWith("/"));
  if (foreign.length > 0) {
    throw new Error(
      `SITE_LINKS 에 루트 상대 경로가 아닌 항목이 있다: ${foreign.join(", ")} — 스모크는 우리 ` +
        "origin 만 두드린다. 외부 링크를 그 배열에 넣었다면 여기서 걸러 낼 방법을 먼저 정한다.",
    );
  }
  return ["/", ...hrefs];
}

/* Cloudflare 가 워커 실패를 감쌀 때 쓰는 표식. 상태 코드만 보면 "500 이 났다"까지만 알고,
   그게 우리 코드 예외인지 런타임 한도인지 구분이 안 된다 — 그 차이가 대응을 가른다. */
const CF_ERROR_MARKERS = [
  ["1102", "Worker 가 요청당 CPU 한도를 넘겼다(Error 1102) — 무거운 렌더·루프를 의심한다"],
  ["1101", "Worker 가 예외를 던졌다(Error 1101)"],
  ["1015", "레이트 리밋(Error 1015)"],
  ["exceeded its CPU", "Worker 가 CPU 한도를 넘겼다"],
];

function cfErrorIn(body) {
  const hit = CF_ERROR_MARKERS.find(([marker]) => body.includes(marker));
  return hit ? hit[1] : null;
}

/* **요청마다 시한을 둔다.** 없으면 응답이 영영 안 오는 경우 이 스크립트가 매달리고, 그걸
   부르는 CI·Deploy job 도 같이 매달린다 — 워크플로 타임아웃에 걸려서야 죽는데 그때 로그는
   "무슨 일이 있었는지"를 말해 주지 않는다. 스모크가 재는 건 어차피 "즉시 응답하는가"라 5초면
   넉넉하다(정상 응답은 로컬·프로덕션 모두 100ms 대).

   **이 값은 워크플로 스텝 시한과 함께 골라야 한다.** 최악은 `대상수 × 라운드 × (시한 + 대기 +
   시한)` 이다 — 6 × 2 × (5 + 3 + 5) = 156초. 스텝 시한 5분(300초)의 절반이라, 여러 대상이
   "죽지는 않았는데 느린" 상태여도 **스크립트가 자기 진단을 먼저 출력하고 끝난다.** 처음엔
   10초로 뒀다가 최악이 276초가 되어 여유가 24초뿐이었다(리뷰 지적) — 그러면 GitHub 이 스텝을
   먼저 죽여, 진단을 남기려고 넣은 시한이 도로 무의미해진다. 이 상수를 올릴 땐 위 산술을 다시
   하고 스텝 시한도 같이 본다. */
const PROBE_TIMEOUT_MS = 5_000;

/* **재시도는 하되, (1) Cloudflare 에러 표식이 보이면 안 하고 (2) 첫 라운드에서만 한다.**

   배포 직후 첫 요청은 콜드 스타트나 전파 지연으로 한 번 튈 수 있고, 그걸로 좋은 배포를 빨갛게
   만들면 "스모크가 가끔 빨갛다"가 되어 아무도 안 보게 된다. 그게 재시도를 두는 이유다.

   그런데 무턱대고 재시도하면 이 층이 존재하는 이유를 스스로 지운다. 표식이 보이는 실패는 첫
   번에 확정한다 — **1102 는 그 자체가 간헐적**이라서다.

   **표식이 항상 있는 건 아니다.** Cloudflare 의 에러 셸이 아니라 워커 자신의 500(OpenNext
   핸들러·잘린 응답)으로 나오면 표식이 없다. 그러면 이런 순서가 성립한다: 라운드 1 이 isolate 를
   죽인다 → 라운드 2 가 표식 없는 500 을 받는다 → 3초 기다리는 사이 isolate 가 재활용된다 →
   통과. **캐스케이드를 잡으려고 라운드를 둘로 둔 건데 재시도가 그걸 삼킨다**(리뷰 지적).
   그래서 재시도를 **라운드 1 로 한정**한다 — 라운드 1 은 콜드 스타트를 흡수하고, 라운드 2 는
   엄격하다. 두 규칙이 서로 안 싸운다.

   4xx 는 어느 라운드에서도 재시도하지 않는다(없는 라우트는 기다린다고 생기지 않는다). */
const RETRY_ONCE_AFTER_MS = 3_000;

async function fetchOnce(url) {
  const res = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "chyailokunya-smoke" },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return { res, body: await res.text() };
}

// 재시도해도 될 실패인가 — 연결 자체 실패(res 없음)와 CF 표식 없는 5xx 만.
function isTransient(attempt) {
  if (!attempt.res) return true;
  return attempt.res.status >= 500 && cfErrorIn(attempt.body) === null;
}

async function attemptFetch(url) {
  try {
    return await fetchOnce(url);
  } catch (cause) {
    return { res: null, body: "", cause };
  }
}

async function probe(path, { expectHtml, expectType }, { allowRetry }) {
  const url = `${ORIGIN}${path}`;

  let attempt = await attemptFetch(url);
  if (allowRetry && isTransient(attempt)) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_ONCE_AFTER_MS));
    attempt = await attemptFetch(url);
  }

  const { res, body } = attempt;
  if (!res) return { ok: false, url, reason: `요청 자체가 실패했다: ${attempt.cause}` };

  const cfError = cfErrorIn(body);
  if (cfError) return { ok: false, url, reason: `${cfError} (status ${res.status})` };
  if (res.status !== 200) return { ok: false, url, reason: `status ${res.status}` };

  /* **상태 코드만 보면 안 된다 — 200 짜리 엉뚱한 응답이 통과한다.** 페이지는 우리 마크업인지,
     자산은 그 형식이 맞는지까지 본다(리뷰 지적: 자산이 200 인데 HTML 폴백을 받고 있어도
     status 만으론 초록이다). */
  const type = res.headers.get("content-type") ?? "";

  if (expectHtml) {
    if (!type.includes("text/html")) return { ok: false, url, reason: `content-type ${type}` };
    /* 이 저장소는 사용자가 가리킬 요소에 `data-od-id` 를 붙이는 규약이 있으니(AGENTS 코드
       컨벤션) 그게 하나라도 있으면 우리 페이지가 실제로 렌더된 것이다. 페이지마다 다른 마커를
       고르면 이 스크립트가 화면 구조에 묶인다. */
    if (!body.includes("data-od-id=")) {
      return { ok: false, url, reason: "우리 마크업이 아니다(data-od-id 없음)" };
    }
  } else if (expectType) {
    if (!type.includes(expectType)) {
      return { ok: false, url, reason: `content-type ${type} (기대: ${expectType})` };
    }
    // 빈 200 도 막는다 — 자산이 사라지면 프록시가 빈 본문을 200 으로 줄 수 있다.
    if (body.length === 0) return { ok: false, url, reason: "본문이 비어 있다" };
  }
  return { ok: true, url };
}

/* 각 경로를 **두 번** 두드린다. 1102 는 한 요청이 isolate 를 죽이고 **그 뒤 무관한 요청까지**
   연쇄로 실패하는 모양이라(2026-07-27 실측: favicon.ico 까지 같이 죽었다), 한 번씩만 보면
   첫 요청은 통과하고 두 번째가 죽는 패턴을 놓친다. 정적 자산을 섞는 것도 같은 이유다 — 가벼운
   요청이 죽는다면 원인은 그 요청이 아니라 isolate 다. */
const ROUNDS = 2;

async function main() {
  const pages = knownPagePaths();
  const targets = [
    ...pages.map((path) => ({ path, expectHtml: true })),
    /* 가벼운 정적 자산 둘. 페이지가 아니라 **isolate 카나리아**다 — 이만한 요청이 죽는다면
       원인은 그 요청이 아니라 isolate 이고, 그게 1102 의 모양이다(2026-07-27 실측: 무거운
       og 라우트가 죽자 아이콘 요청까지 같이 죽었다).

       `/favicon.ico` 는 **일부러 안 본다** — 이 앱은 `src/app/icon.svg` 를 쓰고 브라우저는
       그걸 `<link rel="icon">` 으로 받으므로 `.ico` 는 원래 404 다(실측). 없는 것을 카나리아로
       두면 스모크가 항상 빨갛고, 그러면 아무도 안 본다.

       `og-cover.jpg` 는 소셜 크롤러가 실제로 두드리는 URL 이라 여기 있다 — 이 자산이 죽으면
       공유 링크의 미리보기가 통째로 깨진다. */
    { path: "/icon.svg", expectHtml: false, expectType: "image/svg+xml" },
    { path: "/assets/og-cover.jpg", expectHtml: false, expectType: "image/jpeg" },
  ];

  console.log(`배포 후 스모크 — ${ORIGIN} (${targets.length}개 × ${ROUNDS}회)`);

  const failures = [];
  for (let round = 1; round <= ROUNDS; round++) {
    for (const target of targets) {
      // 재시도는 라운드 1 에서만 — 라운드 2 의 캐스케이드 감지를 삼키지 않게(위 상수 주석).
      const result = await probe(target.path, target, { allowRetry: round === 1 });
      console.log(`  [${round}/${ROUNDS}] ${result.ok ? "ok  " : "FAIL"} ${result.url}`);
      if (!result.ok) failures.push(`${result.url} — ${result.reason}`);
    }
  }

  if (failures.length > 0) {
    console.error("\n배포된 사이트가 스모크를 통과하지 못했다:");
    for (const failure of failures) console.error(`  - ${failure}`);
    /* **되돌리지 않는다** — 위 파일 주석의 근거(D1 스큐). 사람이 판단할 자리다. */
    console.error(
      "\n배포는 이미 나갔다. 롤백은 자동으로 하지 않는다(D1 마이그레이션이 안 되돌아가 " +
        "구 워커 + 새 스키마 스큐가 된다). `wrangler tail` 로 원인을 먼저 본다.",
    );
    process.exit(1);
  }

  console.log("\n전부 통과.");
}

await main();
