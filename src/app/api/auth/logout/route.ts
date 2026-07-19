/* 로그아웃(ADR-0017, Q12). 현재 기기(제시된 refresh 의 family)를 폐기하고 세션 쿠키를 지운다.
   다른 기기(다른 family)는 유지된다. POST + **Origin 검증**만 받는다(request-guard 주석 참고 —
   POST·SameSite 만으로는 강제 로그아웃이 막히지 않는다). access(15분 무상태)는 취소 못 해
   쿠키 삭제로만 끊고, 최대 15분 잔존 창이 남는다(설계상 불가피). */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { makeDb } from "@/db";
import { revokeSession } from "@/features/auth/refresh-service";
import { rejectForeignOrigin, requireAuthOrigin } from "@/features/auth/request-guard";
import {
  clearSessionCookies,
  expireLegacyCookies,
  plantLoggedOutMarker,
  readSessionCookies,
} from "@/features/auth/session-cookies";

export async function POST(req: Request) {
  const { env } = getCloudflareContext();
  // AUTH_URL 부재 시 login 은 503 인데 여기만 Host 헤더로 폴백하면, Host 를 통제할 수 있는
  // 경로에서 리다이렉트 대상이 조작된다. 세 라우트 모두 fail-closed 로 통일한다(request-guard).
  const guarded = requireAuthOrigin(env);
  if (guarded instanceof Response) return guarded;
  const denied = rejectForeignOrigin(req, env.AUTH_URL);
  if (denied) return denied;

  const refresh = readSessionCookies(await cookies()).refresh;
  if (refresh) await revokeSession(makeDb(env.DB), refresh, Date.now());

  const res = NextResponse.redirect(new URL("/", guarded.origin), { status: 303 });
  clearSessionCookies(res);
  // 쿠키 삭제만으론 부족하다 — 이 순간 회전 중이던 요청의 응답이 나중에 도착하면 access 를
  // 다시 심는다. 마커를 남겨 그 뒤의 요청들이 세션 쿠키를 무시·삭제하게 한다.
  plantLoggedOutMarker(res);
  // 구 이름 쿠키도 함께 만료 — 배포 롤백 시 남은 구 쿠키가 로그아웃한 세션을 되살릴 창을
  // 좁힌다(부분 완화, 완전 차단 아님 — 한계는 config.ts 의 LEGACY_COOKIE_NAMES 주석 참고).
  expireLegacyCookies(res);
  return res;
}
