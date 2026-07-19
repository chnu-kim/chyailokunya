/* 레거시 세션·OAuth 쿠키(구 이름 ck_at·ck_rt·ck_oauth_state·ck_lo, __Host- 프리픽스 이전)를
   응답에서 만료시킨다. config.LEGACY_COOKIE_NAMES 주석 참고 — 로그인 성공/실패·로그아웃처럼
   auth 상태를 건드리는 응답에 실어, 배포를 롤백했을 때 브라우저에 남은 구 쿠키가 옛 세션을
   되살릴 창을 좁힌다(부분 완화 — 이 응답을 받은 브라우저에서만 즉시 정리되고, 완전 차단은
   아니다. 한계는 config.LEGACY_COOKIE_NAMES 주석).

   /api/auth 는 middleware matcher 에서 제외돼 미들웨어가 이 라우트들엔 안 돈다 — 그래서 여기서
   직접 만료시킨다. middleware 는 레이어 경계상 app 을 import 할 수 없어(.dependency-cruiser
   `middleware-below-ui`) 같은 로직을 자체 로컬 헬퍼로 따로 갖는다. */

import type { NextResponse } from "next/server";
import { LEGACY_COOKIE_NAMES } from "@/features/auth/config";
import { clearedCookieOptions } from "@/features/auth/cookies";

export function expireLegacyCookies(res: NextResponse): void {
  for (const name of LEGACY_COOKIE_NAMES) res.cookies.set(name, "", clearedCookieOptions());
}
