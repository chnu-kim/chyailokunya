/* 세션·refresh 회전의 순수 시간 판정(ADR-0017). HTTP·DB·jose 무관 — now·수명을 인자로 받아
   판정만 한다(레이어 최하 core: 아무것도 import 안 함). features 의 refresh-service 가 DB claim
   결과를 이 함수들에 넘겨 회전/재사용/도난을 가른다. */

/* DB 에서 조회한 refresh 행의 판정 필드(전부 epoch ms). 무효화가 두 종류다:
   superseded_at = 회전으로 대체됨(후계 토큰 있음 — grace 내 재사용은 정상 동시 탭),
   revoked_at = 세션 폐기(로그아웃·도난 — 재사용 절대 불가). 이 구분이 없으면 로그아웃 직후
   grace 창에서 폐기된 토큰이 되살아난다. */
export type RefreshRow = {
  supersededAt: number | null;
  revokedAt: number | null;
  expiresAt: number;
  familyExpiresAt: number;
};

export type ReuseVerdict = "invalid" | "reuse-grace" | "reuse-theft";

/* 조건부 UPDATE claim 이 0행일 때(=이미 무효화됨), 다시 조회한 행을 판정한다.
   invalid = 재사용 신호 아님(미존재·만료·cap초과·폐기), reuse-grace = 정상 동시 탭, reuse-theft = 도난. */
export function classifyReusedToken(
  row: RefreshRow | null,
  now: number,
  graceMs: number,
): ReuseVerdict {
  if (row === null) return "invalid"; // 미존재 해시 — 위조/정리됨.
  // 만료·cap 초과가 우선한다: 이미 무효인 토큰은 재등장해도 위험이 없다.
  if (row.expiresAt <= now) return "invalid";
  if (row.familyExpiresAt <= now) return "invalid";
  // 폐기(로그아웃·도난)는 회전과 달리 재사용이 절대 불가하다 — grace 대상이 아니다.
  if (row.revokedAt !== null) return "invalid";
  // 회전도 폐기도 아닌데 claim 이 0행 = claim·조회 사이 레이스. 방어적 무효.
  if (row.supersededAt === null) return "invalid";
  // 회전된 토큰의 재등장: grace 이내면 정상 동시 탭, 넘겼으면 도난.
  return now - row.supersededAt <= graceMs ? "reuse-grace" : "reuse-theft";
}

// family 절대 상한(첫 로그인 + capMs). 로그인 시 한 번 계산해 family 의 모든 refresh 행에 승계한다.
export function computeFamilyExpiry(loginAt: number, capMs: number): number {
  return loginAt + capMs;
}

/* refresh 만료 = sliding(now + slidingMs) 이되 family 절대 상한을 넘지 않게 조인다. rotation 마다
   호출되어 활동 중이면 만료가 밀리지만(sliding), cap 을 넘겨 무한 연장되지는 않는다. */
export function computeRefreshExpiry(
  now: number,
  slidingMs: number,
  familyExpiresAt: number,
): number {
  return Math.min(now + slidingMs, familyExpiresAt);
}
