/* 자동 access 갱신(ADR-0017).

   **파일명이 `middleware.ts` 인 이유 — Next 16 이 권하는 `proxy.ts` 를 쓸 수 없다.**
   Next 16 은 이 규약을 proxy 로 이름을 바꾸며 Node 런타임 전용으로 만들었는데,
   `@opennextjs/cloudflare` 는 Node 미들웨어를 거부한다("Node.js middleware is not currently
   supported"). 그렇다고 proxy 를 엣지로 돌릴 수도 없다("Proxy does not support Edge runtime").
   구 규약 `middleware.ts` 는 엣지로 번들돼 OpenNext 가 받는다 — deprecation 경고를 감수하고
   이걸 쓴다. OpenNext 가 Node proxy 를 지원하면 그때 옮긴다.

   **이 함정은 로컬 `next build` 가 못 잡는다** — `npm run build` 는 통과시키고 실제 배포
   빌드(`opennextjs-cloudflare build`)에서만 터진다. 실제로 배포에서 그렇게 터졌다.

   access 가 유효하면 서명 검증만 하고 통과(DB 0). 만료·부재면
   refresh 로 rotation 해 새 access·refresh 를 세팅하고, 같은 요청의 다운스트림(RSC·route·tRPC)이
   갱신된 access 를 읽도록 request.cookies 를 덮어 forward 한다(안 그러면 이번 요청은 옛 쿠키를
   본다). refresh 실패(도난·만료)면 세션 쿠키를 걷고 비로그인으로 통과(공개 읽기는 계속). matcher
   로 정적 에셋·/api/auth(자체 쿠키 세팅)는 제외한다. */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { makeDb } from "@/db";
import { sessionKeys } from "@/features/auth/keys";
import { refreshSession } from "@/features/auth/session";
import {
  clearSessionCookies,
  dropSessionFromRequest,
  expireLegacyCookies,
  forwardRotatedAccess,
  hasLegacyCookies,
  hasLoggedOutMarker,
  plantSessionCookies,
  readSessionCookies,
} from "@/features/auth/session-cookies";
import { verifyAccessToken } from "@/features/auth/tokens";

export const config = {
  matcher: ["/((?!_next/|api/auth/|assets/|favicon|icon).*)"],
};

export async function middleware(request: NextRequest) {
  const { env } = await getCloudflareContext({ async: true });
  // 키는 쌍으로만 의미가 있다(keys.sessionKeys 주석) — 한쪽만 있는 오설정이면 세션 기능 자체를
  // 끈 비로그인으로 통과시킨다(fail-closed, 조용한 refresh 폭주 금지).
  const keys = sessionKeys(env);
  if (!keys) return NextResponse.next();

  // 쿠키를 먼저 본다 — 트래픽 대부분인 비로그인 요청이 쓰지도 않을 JWK 파싱을 내지 않게.
  const { access, refresh } = readSessionCookies(request.cookies);
  if (!access && !refresh) {
    // 배포 후 __Host- 쿠키가 없는 요청은 전부 여기로 떨어진다 — 익명 방문자와 "구 이름 쿠키만
    // 남은" 사용자가 섞인다. 후자면(구 쿠키가 하나라도 있으면) 응답에 만료를 실어, 수동 브라우징
    // 에서도 다음 요청부터 구 쿠키가 정리되게 한다. 익명 트래픽엔 불필요한 Set-Cookie 를 붙이지
    // 않으려고 존재할 때만 만료시킨다. 이 이른 반환이 레거시 전용 사용자의 유일한 통과 지점이라,
    // 아래 access-valid·refresh-success 정상 경로는 그들에게 도달하지 않는다(그 경로는 만지지 않음).
    const res = NextResponse.next();
    if (hasLegacyCookies(request.cookies)) expireLegacyCookies(res);
    return res;
  }

  /* 로그아웃 마커가 있으면 세션 쿠키를 믿지 않는다. 로그아웃 직전에 회전 중이던 요청의 응답이
     나중에 도착해 access 를 되심을 수 있는데, access 는 무상태라 그대로면 최대 ACCESS_TTL 동안
     통과한다 — 공용 브라우저에서 "로그아웃했는데 로그인 상태"가 된다. 되심긴 쿠키를 걷고
     이번 요청에서도 다운스트림에 안 넘겨, 로그아웃이 확정되게 한다. 로그인이 마커를 지운다. */
  if (hasLoggedOutMarker(request.cookies)) {
    dropSessionFromRequest(request.cookies);
    const res = NextResponse.next({ request });
    clearSessionCookies(res);
    // 세션을 걷는 김에 구 이름 쿠키도 만료 — 로그아웃 확정 응답이 롤백 시 되살아날 창을 좁힌다
    // (부분 완화, 완전 차단 아님 — 한계는 config.ts 의 LEGACY_COOKIE_NAMES 주석 참고).
    expireLegacyCookies(res);
    return res;
  }

  // access 유효 → 서명 검증만(DB 0) → 통과.
  if (access && (await verifyAccessToken(keys.verificationKeys(), access))) {
    return NextResponse.next();
  }

  // access 만료·부재. refresh 가 없으면 비로그인으로 통과(공개 읽기는 무관).
  if (!refresh) return NextResponse.next();

  const db = makeDb(env.DB);
  const next = await refreshSession(db, keys.signingKey(), refresh, Date.now());

  if (!next) {
    // 도난·만료 refresh → 세션 쿠키를 걷고 비로그인으로 통과.
    const res = NextResponse.next();
    clearSessionCookies(res);
    // 세션을 걷는 김에 구 이름 쿠키도 만료 — 롤백 시 옛 세션이 되살아날 창을 좁힌다(부분
    // 완화, 완전 차단 아님 — 한계는 config.ts 의 LEGACY_COOKIE_NAMES 주석 참고).
    expireLegacyCookies(res);
    return res;
  }

  // 갱신 성공 → 다운스트림이 이번 요청에서 새 access 를 읽도록 request 쿠키를 덮어 forward.
  forwardRotatedAccess(request.cookies, next.access);
  const res = NextResponse.next({ request });
  plantSessionCookies(res, next);
  return res;
}
