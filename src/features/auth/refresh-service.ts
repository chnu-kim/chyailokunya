/* refresh 세션의 서버 권위(ADR-0017). rotation·재사용 감지·도난 대응을 D1 로 한다. 순수 시간
   판정은 core/session(classifyReusedToken·compute*)에 위임하고, 여기선 DB claim(원자적 조건부
   UPDATE)과 그 분기만 맡는다. D1 은 interactive transaction 이 없어(batch 만 원자적) 회전의
   원자성은 조건부 UPDATE 한 문장의 SQLite 단일 라이터 보장에 기댄다. now 는 인자로 받아 결정성을
   유지한다. */

import { and, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import { classifyReusedToken, computeFamilyExpiry, computeRefreshExpiry } from "@/core/session";
import { refreshTokens, securityEvents, type Db } from "@/db";
import { ABSOLUTE_CAP_MS, GRACE_MS, REFRESH_TTL_MS } from "./config";
import { generateRefreshToken, hashToken } from "./tokens";

/* 로그인 1회 = 새 family. refresh 원본을 발급(반환)하고 해시만 저장한다. family_expires_at 은
   절대 상한(첫 로그인 + 90일), expires_at 은 sliding(그 상한 이내). */
/* refresh 행 발급 공통(발급 경로 드리프트 방지 — createSession·rotation 이 공유). token 원본을
   받아 해시·만료를 계산해 INSERT. expiresAt 은 sliding 이되 family 절대 상한을 넘지 않는다. */
async function insertRefresh(
  db: Db,
  p: { userId: number; familyId: string; familyExpiresAt: number; token: string; now: number },
): Promise<void> {
  const tokenHash = await hashToken(p.token);
  const expiresAt = computeRefreshExpiry(p.now, REFRESH_TTL_MS, p.familyExpiresAt);
  await db.insert(refreshTokens).values({
    userId: p.userId,
    familyId: p.familyId,
    tokenHash,
    expiresAt,
    familyExpiresAt: p.familyExpiresAt,
    createdAt: p.now,
  });
}

export async function createSession(
  db: Db,
  userId: number,
  now: number,
): Promise<{ token: string; familyId: string }> {
  const token = generateRefreshToken();
  const familyId = crypto.randomUUID();
  const familyExpiresAt = computeFamilyExpiry(now, ABSOLUTE_CAP_MS);
  await insertRefresh(db, { userId, familyId, familyExpiresAt, token, now });
  await cleanupRefreshTokens(db, now, GRACE_MS);
  return { token, familyId };
}

export type RotateResult =
  | { ok: true; token: string; userId: number; familyId: string }
  | { ok: false; reason: "invalid" | "theft" };

// family 에 폐기된(revoked) 행이 하나라도 있으면 그 family 는 폐기됐다(로그아웃/도난). 발급을 이에
// 종속시켜, 폐기 순간 동시 회전 중이던 후계가 살아남는 레이스를 보상한다.
async function familyIsRevoked(db: Db, familyId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.familyId, familyId), isNotNull(refreshTokens.revokedAt)))
    .limit(1);
  return row !== undefined;
}

/* refresh 회전. 조건부 UPDATE claim 이 유효 행 하나를 superseded 로 뒤집고 그 행에 후계 원본을
   심는다 — 동시 요청 중 정확히 하나만 1행을 받는다(SQLite 단일 라이터). 그 승자만 후계 행을
   발급하고, grace 재사용자에겐 심어둔 후계 원본을 멱등 반환한다(새로 찍으면 도둑이 무제한 증식).
   claim 0행이면 재사용·도난·무효를 가른다. D1 은 트랜잭션이 없어 claim(원자)·발급·폐기가 별도
   문장이라, 발급 뒤 family 폐기를 재확인해 레이스를 보상한다. */
export async function rotateRefreshToken(
  db: Db,
  presented: string,
  now: number,
): Promise<RotateResult> {
  const tokenHash = await hashToken(presented);
  // 후계 원본을 미리 만들어 claim UPDATE 로 구 행에 심는다(grace 멱등 반환의 정본).
  const successor = generateRefreshToken();

  const claimed = await db
    .update(refreshTokens)
    .set({ supersededAt: now, replacedByToken: successor })
    .where(
      and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.supersededAt),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, now),
        gt(refreshTokens.familyExpiresAt, now),
      ),
    )
    .returning({
      userId: refreshTokens.userId,
      familyId: refreshTokens.familyId,
      familyExpiresAt: refreshTokens.familyExpiresAt,
    });

  if (claimed.length === 1) {
    const won = claimed[0]!;
    await insertRefresh(db, {
      userId: won.userId,
      familyId: won.familyId,
      familyExpiresAt: won.familyExpiresAt,
      token: successor,
      now,
    });
    // 발급 레이스 보상: 이 사이 family 가 폐기됐다면(로그아웃/도난) 방금 후계도 함께 폐기한다.
    if (await familyIsRevoked(db, won.familyId)) {
      await revokeFamily(db, won.familyId, now);
      return { ok: false, reason: "invalid" };
    }
    // 노출 창을 닫는 곁다리 청소(cleanupRefreshTokens 주석의 계약). 방금 심은 행은 대상이
    // 아니다 — supersededAt=now 라 grace 밖이 아니고, 후계는 만료가 미래다.
    await cleanupRefreshTokens(db, now, GRACE_MS);
    return { ok: true, token: successor, userId: won.userId, familyId: won.familyId };
  }

  // claim 0행: 조회해 재사용·도난·무효를 가른다(순수 판정은 core.classifyReusedToken).
  const [row] = await db
    .select({
      supersededAt: refreshTokens.supersededAt,
      revokedAt: refreshTokens.revokedAt,
      expiresAt: refreshTokens.expiresAt,
      familyExpiresAt: refreshTokens.familyExpiresAt,
      userId: refreshTokens.userId,
      familyId: refreshTokens.familyId,
      replacedByToken: refreshTokens.replacedByToken,
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);

  const verdict = classifyReusedToken(row ?? null, now, GRACE_MS);
  if (verdict === "invalid") return { ok: false, reason: "invalid" };

  if (verdict === "reuse-grace") {
    // 정상 동시 탭: 최초 회전자가 심어둔 후계 원본을 그대로 멱등 반환한다 — 새로 찍지 않아야
    // 도둑이 grace 창에서 유효 토큰을 무제한 증식하지 못한다(alive head 1 유지).
    if (row!.replacedByToken) {
      // 후계 "원본은 심겼는데 행이 없는" 반대 방향 고아도 있다(claim 성공 후 INSERT 전 크래시).
      // 그대로 돌려주면 호출자는 access 를 받지만 다음 회전에서 invalid 로 죽는다 — 행 존재를
      // 확인하고 없으면 손상으로 끊어 재로그인시킨다.
      const [alive] = await db
        .select({ id: refreshTokens.id })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, await hashToken(row!.replacedByToken)))
        .limit(1);
      if (alive) {
        return {
          ok: true,
          token: row!.replacedByToken,
          userId: row!.userId,
          familyId: row!.familyId,
        };
      }
      return { ok: false, reason: "invalid" };
    }
    // 후계 원본이 없다 = claim 뒤 발급이 실패한 고아 superseded. 재사용이 아니라 세션 손상이니 무효.
    return { ok: false, reason: "invalid" };
  }

  // reuse-theft: 도난 신호. 계열 전체를 폐기하고 보안 이벤트를 지속 기록한다(유일한 탐지 신호).
  await revokeFamily(db, row!.familyId, now);
  await db.insert(securityEvents).values({
    userId: row!.userId,
    familyId: row!.familyId,
    eventType: "refresh_reuse",
    createdAt: now,
  });
  return { ok: false, reason: "theft" };
}

// 계열 전체 폐기(도난·로그아웃). 이미 revoked 는 건드리지 않아 멱등하다.
export async function revokeFamily(db: Db, familyId: string, now: number): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

/* 로그아웃 = 현재 기기(제시된 refresh 의 family) 폐기(Q12). 다른 기기(다른 family)는 유지된다.
   미존재 토큰은 조용히 무시(멱등). */
export async function revokeSession(db: Db, presented: string, now: number): Promise<void> {
  const tokenHash = await hashToken(presented);
  const [row] = await db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  if (row) await revokeFamily(db, row.familyId, now);
}

/* 유저의 모든 세션(전 family) 폐기 — 계정 침해·밴·비밀번호 상당 이벤트의 강제 로그아웃 경로.
   access(15분 무상태)는 취소 못 하므로 최대 15분 잔존 창이 남는다(설계상 불가피). */
export async function revokeAllForUser(db: Db, userId: number, now: number): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

/* 무한 누적 방지. 삭제 하한을 탐지 창에 결속한다 — superseded 행을 grace 안에 지우면 재사용
   감지가 row=null→invalid 로 떨어져 도난이 조용히 통과한다. 그래서 (1) grace 를 넘긴 superseded
   행의 후계 평문(replaced_by_token)만 먼저 지워 노출을 줄이고(행은 유지 — 만료 전엔 도난 감지에
   필요), (2) 만료된 행만 삭제한다(만료 토큰은 재사용해도 classify 가 invalid 라 탐지에 무관).
   lazy 호출(로그인·회전 성공 시 곁다리) + 필요 시 주간 크론. */
export async function cleanupRefreshTokens(db: Db, now: number, graceMs: number): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ replacedByToken: null })
    .where(
      and(
        isNotNull(refreshTokens.replacedByToken),
        isNotNull(refreshTokens.supersededAt),
        lt(refreshTokens.supersededAt, now - graceMs),
      ),
    );
  await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, now));
}
