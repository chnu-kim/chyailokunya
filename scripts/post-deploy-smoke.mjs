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
const CF_ERROR_CODES = [
  [1102, "Worker 가 요청당 CPU 한도를 넘겼다(Error 1102) — 무거운 렌더·루프를 의심한다"],
  [1101, "Worker 가 예외를 던졌다(Error 1101)"],
  [1015, "레이트 리밋(Error 1015)"],
];

/* **본문에서 숫자만 찾으면 안 된다 — 실제로 오탐을 냈다**(2026-07-30, 프로덕션 첫 실행).
   `body.includes("1101")` 로 검사했더니 **정상(200 · text/javascript) 인 미니파이 JS 청크**가
   "Worker 가 예외를 던졌다"로 판정됐다. 미니파이된 번들엔 네 자리 숫자가 널려 있다. 좋은 배포를
   빨갛게 만드는 건 이 스크립트가 가장 피해야 할 실패다 — 그러면 아무도 스모크를 안 본다.

   두 겹으로 좁힌다:
   1. **에러 상태일 때만** 본다. Cloudflare 의 에러 셸은 200 으로 오지 않는다.
   2. `Error 1102` 처럼 **낱말과 함께** 본다. 숫자만으로는 어떤 본문에나 걸릴 수 있다. */
function cfErrorIn(status, body) {
  if (status < 400) return null;
  const hit = CF_ERROR_CODES.find(([code]) => new RegExp(`Error\\s*${code}\\b`, "i").test(body));
  if (hit) return hit[1];
  return /exceeded its CPU|CPU time limit/i.test(body) ? "Worker 가 CPU 한도를 넘겼다" : null;
}

/* **요청마다 시한을 둔다.** 없으면 응답이 영영 안 오는 경우 이 스크립트가 매달리고, 그걸
   부르는 CI·Deploy job 도 같이 매달린다 — 워크플로 타임아웃에 걸려서야 죽는데 그때 로그는
   "무슨 일이 있었는지"를 말해 주지 않는다. 스모크가 재는 건 어차피 "즉시 응답하는가"라 5초면
   넉넉하다(정상 응답은 로컬·프로덕션 모두 100ms 대).

   **이 값은 워크플로 스텝 시한과 함께 골라야 한다.** 고정 대상은 순차·2라운드이고 재시도는
   라운드 1 에서만 도므로 최악이 `N × (5+3+5) + N × 5` 다 — 지금 N=7(페이지 4 + tRPC 1 +
   자산 2)이라 **126초**. 번들은 한 번만·병렬(6)이라 19개면 4배치 × 5초 = **20초**. 합쳐 약
   146초로 스텝 시한 5분(300초)의 절반이다. 여러 대상이 "죽지는 않았는데 느린" 상태여도
   **스크립트가 자기 진단을 먼저 출력하고 끝난다.**

   처음엔 10초로 뒀다가 최악이 276초가 되어 여유가 24초뿐이었다(리뷰 지적) — 그러면 GitHub 이
   스텝을 먼저 죽여, 진단을 남기려고 넣은 시한이 도로 무의미해진다. **고정 대상을 늘리거나 이
   값을 올릴 땐 위 산술을 다시 하고 스텝 시한도 같이 본다**(번들은 병렬이라 개수가 늘어도
   완만하게 는다). */
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
  return attempt.res.status >= 500 && cfErrorIn(attempt.res.status, attempt.body) === null;
}

async function attemptFetch(url) {
  try {
    return await fetchOnce(url);
  } catch (cause) {
    return { res: null, body: "", cause };
  }
}

// 페이지가 밝히는 자기 정본 경로. origin 은 버린다(층 4 는 localhost, metadataBase 는 프로덕션).
function ogUrlPath(body) {
  const raw = body.match(/property="og:url"\s+content="([^"]+)"/)?.[1];
  if (!raw) return null;
  try {
    return new URL(raw).pathname || "/";
  } catch {
    return null;
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

  const cfError = cfErrorIn(res.status, body);
  if (cfError) return { ok: false, url, reason: `${cfError} (status ${res.status})` };
  if (res.status !== 200) return { ok: false, url, reason: `status ${res.status}` };

  /* **상태 코드만 보면 안 된다 — 200 짜리 엉뚱한 응답이 통과한다.** 페이지는 우리 마크업인지,
     자산은 그 형식이 맞는지까지 본다(리뷰 지적: 자산이 200 인데 HTML 폴백을 받고 있어도
     status 만으론 초록이다). */
  const type = res.headers.get("content-type") ?? "";

  if (expectHtml) {
    if (!type.includes("text/html")) return { ok: false, url, reason: `content-type ${type}` };
    /* 이 저장소는 사용자가 가리킬 요소에 `data-od-id` 를 붙이는 규약이 있으니(AGENTS 코드
       컨벤션) 그게 하나라도 있으면 우리 마크업이 렌더된 것이다. */
    if (!body.includes("data-od-id=")) {
      return { ok: false, url, reason: "우리 마크업이 아니다(data-od-id 없음)" };
    }
    /* **그것만으로는 "이 라우트가 맞다"가 안 된다**(코드 리뷰 지적). nav 와 footer 가 모든
       페이지에서 `data-od-id` 를 emit 하므로, `/games` 가 실수로 `/` 로 리라이트되거나
       라우트 실패로 공용 레이아웃만 남아도 이 검사는 통과한다 — 스모크가 **엉뚱한 내용을
       서빙하면서 초록**이 된다.

       라우트별 마커를 손으로 매핑하면 또 손 열거가 되므로, 페이지가 스스로 밝히는 값을 쓴다:
       `og:url` 은 각 페이지가 자기 정본 URL 을 담는다(실측 — `/` 는 origin, 나머지는 그 경로).
       origin 은 안 본다 — 층 4 는 localhost 로 도는데 metadataBase 는 프로덕션이라 갈린다. */
    const canonical = ogUrlPath(body);
    if (canonical === null) {
      return { ok: false, url, reason: "og:url 이 없다 — 라우트를 확인할 수 없다" };
    }
    if (canonical !== path) {
      return { ok: false, url, reason: `다른 라우트가 응답했다(og:url ${canonical})` };
    }
  } else if (expectType) {
    if (!type.includes(expectType)) {
      return { ok: false, url, reason: `content-type ${type} (기대: ${expectType})` };
    }
    // 빈 200 도 막는다 — 자산이 사라지면 프록시가 빈 본문을 200 으로 줄 수 있다.
    if (body.length === 0) return { ok: false, url, reason: "본문이 비어 있다" };
  }
  // body 를 함께 돌려준다 — 페이지 응답에서 번들 참조를 거둬 추가 요청 없이 검사하려고.
  return { ok: true, url, body };
}

/* **서버의 "오늘"이 진짜 오늘인지 본다**(2026-07-31 인시던트). `?week=` 없는 `/schedule` 은
   서버가 KST 로 계산한 이번 주를 그리는데, 배포된 Workers 에서 그 시계가 **에포크 0** 을
   돌려줘 1969-12-29 주가 나갔다 — 원인은 프로덕션 workerd 의 **네이티브 Temporal** 이고
   그 `Now` 가 요청 시계에 안 물려 있다(core/calendar.ts 의 todayKST 주석).

   **이 층 말고는 볼 수가 없다.** 유닛은 `today` 를 인자로 받아 고정값을 넣고, 로컬
   preview(wrangler dev)·vitest workerd 엔 네이티브 Temporal 이 없어 폴리필이 맞는 답을 주며,
   e2e 는 `next dev`(Node)라 아예 다른 런타임이다 — 셋 다 초록인 채 라이브만 1970 이었다.
   층 4(로컬 번들 스모크)도 같은 이유로 못 본다.

   기대값은 이 스크립트가 **자기 시계로** 계산한다(Node 는 정상). 페이지는 주 범위를
   `M.D – M.D` 로 적으므로 그 문자열을 만들어 대조한다 — 서버와 스크립트가 KST 자정을 사이에
   두고 갈릴 수 있어 **어제·오늘 두 날 기준을 모두 허용한다**(자정 근처 오탐 방지). 1970 은
   그 창을 어떤 방향으로도 못 맞춘다. */
const CURRENT_WEEK_PATH = "/schedule";

function kstWeekRangeLabel(epochMs) {
  // KST 는 DST 가 없어 고정 +9 — 스크립트는 순수 산술만 하고 존 DB 를 안 쓴다.
  const kst = new Date(epochMs + 9 * 60 * 60 * 1000);
  const dow = (kst.getUTCDay() + 6) % 7; // 월=0
  const monday = new Date(kst.getTime() - dow * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const md = (d) => `${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
  return `${md(monday)} – ${md(sunday)}`;
}

function checkCurrentWeek(body) {
  /* 그 요소의 **안쪽 전체**를 잡고 마크업을 걷어낸다 — React 가 텍스트 노드 사이에
     `<!-- -->` 를 끼우므로(실측: `12.29<!-- --> – <!-- -->1.4`) `[^<]+` 로는 앞 조각만
     읽힌다. 그러면 기대값과 영영 안 맞아 **고친 뒤에도 계속 빨간** 게이트가 된다. */
  const inner = body.match(/class="sched__range"[^>]*>([\s\S]*?)<\/p>/)?.[1];
  const shown = inner
    ?.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!shown) {
    return `주 범위(.sched__range)를 못 읽었다 — 마크업이 바뀌었으면 이 정규식도 같이 고친다`;
  }
  const now = Date.now();
  const allowed = [kstWeekRangeLabel(now), kstWeekRangeLabel(now - 86400000)];
  if (allowed.includes(shown)) return null;
  return (
    `서버가 그린 이번 주가 "${shown}" 인데 실제 KST 이번 주는 "${allowed[0]}" 다 — ` +
    `서버 시계가 틀렸다(1970 이면 Temporal.Now 회귀를 먼저 의심한다)`
  );
}

/* 각 경로를 **두 번** 두드린다. 1102 는 한 요청이 isolate 를 죽이고 **그 뒤 무관한 요청까지**
   연쇄로 실패하는 모양이라(2026-07-27 실측: favicon.ico 까지 같이 죽었다), 한 번씩만 보면
   첫 요청은 통과하고 두 번째가 죽는 패턴을 놓친다. 정적 자산을 섞는 것도 같은 이유다 — 가벼운
   요청이 죽는다면 원인은 그 요청이 아니라 isolate 다. */
const ROUNDS = 2;

/* **페이지가 200 이어도 앱은 깨져 있을 수 있다**(적대적 리뷰 지적). HTML 은 서버가 그리므로
   `_next/static` 청크가 404 여도 페이지 프로브는 초록이다 — 그런데 방문자에겐 스타일 없는
   문서에 인터랙션이 죽은 화면이 보인다. 배포 산출물이 갈리거나 asset 업로드가 반쯤 나가면
   정확히 그 모양이 된다.

   **한두 개만 봐서는 부족하다**(같은 리뷰 2라운드): 페이지마다 참조하는 청크가 다르고
   (실측 2026-07-30 — `/` 10개 · `/landing` 11 · `/games` 12 · `/schedule` 13, 중복 제거 19),
   부분 업로드에선 검사한 부트스트랩 청크만 살아 있고 다른 청크가 404 일 수 있다. 그래서
   **프로브한 모든 페이지 응답에서 전부 거둬 중복을 없앤다.**

   추가 요청은 0 이다 — 라운드 1 의 페이지 프로브가 이미 받아 둔 본문을 그대로 훑는다. */
const BUNDLE_REF = /["'(](\/_next\/static\/[^"'()\s]+\.(?:js|css))/g;

function collectBundles(htmlBodies) {
  const found = new Set();
  for (const body of htmlBodies) {
    for (const [, path] of body.matchAll(BUNDLE_REF)) found.add(path);
  }
  if (found.size === 0) {
    throw new Error(
      "페이지 HTML 에서 _next/static 참조를 하나도 못 찾았다 — 정규식이 낡았거나 우리 페이지가 " +
        "아니다. 번들 검사를 건너뛰고 통과시키지 않는다.",
    );
  }
  return [...found].map((path) => ({
    path,
    expectHtml: false,
    expectType: path.endsWith(".css") ? "text/css" : "javascript",
  }));
}

/* **og:image 도 페이지가 밝히는 대로 두드린다**(적대적 리뷰 지적). 소셜 크롤러가 자동으로
   요청하는 URL 이고, **이 저장소가 프로덕션 인시던트를 낸 자리가 정확히 거기다** — 동적
   og 라우트(`/api/og/schedule`)가 요청당 CPU 한도를 넘겨 isolate 를 죽였다(2026-07-27).
   지금은 정적 파일이라 고정 대상으로도 커버되지만, 다시 동적 라우트가 되는 날 **이 파싱이
   있어야 스모크가 자동으로 그 비싼 렌더를 실제로 태운다.** 없으면 그때도 크롤러가 먼저
   발견한다.

   우리 origin 인 것만 본다 — 층 4 는 localhost 로 도는데 metadataBase 는 프로덕션이라,
   안 거르면 로컬 게이트가 프로덕션에 요청을 보낸다. */
function collectOgImages(htmlBodies) {
  const found = new Set();
  for (const body of htmlBodies) {
    for (const [, raw] of body.matchAll(/property="og:image"\s+content="([^"]+)"/g)) {
      try {
        const parsed = new URL(raw, ORIGIN);
        if (parsed.origin === new URL(ORIGIN).origin) found.add(parsed.pathname + parsed.search);
      } catch {
        // 파싱 안 되는 값은 그 자체로 이상하지만, 여기서 죽이면 진단이 og 로 쏠린다 — 넘긴다.
      }
    }
  }
  return [...found].map((path) => ({ path, expectHtml: false }));
}

/* 번들은 **한 번만, 병렬로, 재시도 없이** 본다. 이건 "그 파일이 배포됐나"라 라운드를 나눠 볼
   이유가 없고(isolate 캐스케이드는 아래 고정 대상들이 맡는다), 수십 개를 순차로 돌리면 위
   시한 산술이 통째로 깨진다. 동시 요청 수는 묶어 둔다 — 배포 직후 프로덕션에 수십 개를 한꺼번에
   던지는 건 스모크가 할 일이 아니다. */
const BUNDLE_CONCURRENCY = 6;

async function probeBundles(bundles) {
  const results = [];
  for (let i = 0; i < bundles.length; i += BUNDLE_CONCURRENCY) {
    const batch = bundles.slice(i, i + BUNDLE_CONCURRENCY);
    results.push(...(await Promise.all(batch.map((b) => probe(b.path, b, { allowRetry: false })))));
  }
  return results;
}

async function main() {
  const pages = knownPagePaths();
  const targets = [
    ...pages.map((path) => ({ path, expectHtml: true })),
    /* **API 경계도 살아 있어야 한다.** 페이지는 서버 컴포넌트가 D1 을 직접 읽어 그리므로
       tRPC 라우트가 통째로 죽어도 렌더된다 — 그런데 그 순간 게임 검색·저장·제안이 전부
       안 된다. 공개 읽기 하나로 그 경계가 서 있는지만 본다(쓰기는 안 건드린다 — 스모크가
       프로덕션 데이터를 바꾸면 안 된다). */
    { path: "/api/trpc/games.list", expectHtml: false, expectType: "application/json" },
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

  console.log(`배포 후 스모크 — ${ORIGIN} (고정 ${targets.length}개 × ${ROUNDS}회 + 번들)`);

  const failures = [];
  const htmlBodies = [];
  for (let round = 1; round <= ROUNDS; round++) {
    for (const target of targets) {
      // 재시도는 라운드 1 에서만 — 라운드 2 의 캐스케이드 감지를 삼키지 않게(위 상수 주석).
      const result = await probe(target.path, target, { allowRetry: round === 1 });
      console.log(`  [${round}/${ROUNDS}] ${result.ok ? "ok  " : "FAIL"} ${result.url}`);
      if (!result.ok) failures.push(`${result.url} — ${result.reason}`);
      if (result.ok && target.path === CURRENT_WEEK_PATH && result.body) {
        const weekProblem = checkCurrentWeek(result.body);
        console.log(
          `  [${round}/${ROUNDS}] ${weekProblem ? "FAIL" : "ok  "} ${result.url} (이번 주)`,
        );
        if (weekProblem) failures.push(`${result.url} — ${weekProblem}`);
      }
      if (round === 1 && target.expectHtml && result.body) htmlBodies.push(result.body);
    }
  }

  /* 번들 검사는 페이지가 하나라도 열렸을 때만 의미가 있다. 전부 실패해 본문이 없으면
     `collectBundles` 가 "참조를 못 찾았다"로 죽는데, 그건 진짜 원인(페이지가 안 뜬다)을
     가리는 오진이다 — 이미 실패가 쌓였으니 그대로 보고한다. */
  if (htmlBodies.length > 0) {
    const derived = [...collectBundles(htmlBodies), ...collectOgImages(htmlBodies)];
    console.log(`  파생 자원 ${derived.length}개 (페이지 응답에서 거둠 — 추가 요청 0)`);
    for (const result of await probeBundles(derived)) {
      if (!result.ok) {
        console.log(`  [파생] FAIL ${result.url}`);
        failures.push(`${result.url} — ${result.reason}`);
      }
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
