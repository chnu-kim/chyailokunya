/* refresh 세션의 서버 권위(ADR-0017). rotation·재사용 감지·도난 대응을 D1 로 한다. 순수 시간
   판정은 core/session(classifyReusedToken·compute*)에 위임하고, 여기선 DB claim(원자적 조건부
   UPDATE)과 그 분기만 맡는다. D1 은 interactive transaction 이 없어(batch 만 원자적) 회전의
   원자성은 조건부 UPDATE 한 문장의 SQLite 단일 라이터 보장에 기댄다. now 는 인자로 받아 결정성을
   유지한다. */

import { and, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import type { JWK } from "jose";
import { classifyReusedToken, computeFamilyExpiry, computeRefreshExpiry } from "@/core/session";
import { refreshTokens, securityEvents, type Db } from "@/db";
import { ABSOLUTE_CAP_MS, GRACE_MS, REFRESH_TTL_MS } from "./config";
import { deriveSuccessorToken, generateRefreshToken, hashToken } from "./tokens";

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
  await cleanupRefreshTokens(db, userId, now);
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

/* refresh 회전. 조건부 UPDATE claim 이 유효 행 하나를 superseded 로 뒤집는다 — 동시 요청 중
   정확히 하나만 1행을 받는다(SQLite 단일 라이터). 그 승자만 후계 행을 발급한다. 후계는 구
   토큰에서 결정적으로 재계산되므로(deriveSuccessorToken) grace 재사용자도 같은 값에 수렴한다 —
   새로 찍지 않아야 도둑이 grace 창에서 유효 토큰을 무제한 증식하지 못한다(alive head 1 유지).
   claim 0행이면 재사용·도난·무효를 가른다. D1 은 트랜잭션이 없어 claim(원자)·발급·폐기가 별도
   문장이라, 발급 뒤 family 폐기를 재확인해 레이스를 보상한다. */
export async function rotateRefreshToken(
  db: Db,
  presented: string,
  now: number,
  privateJwk: JWK,
): Promise<RotateResult> {
  const tokenHash = await hashToken(presented);
  // 후계는 구 토큰에서 **재계산**한다 — DB 에 평문을 남기지 않기 위해서다. 파생 함수를 주입받지
  // 않고 직접 부르는 이유: grace 멱등("alive head 1")이 파생의 *결정성*에 통째로 걸려 있는데
  // 콜백 타입은 그걸 못 강제한다. 여기서 부르면 결정성이 호출자 의무가 아니라 구조가 된다.
  const successor = await deriveSuccessorToken(privateJwk, presented);

  const claimed = await db
    .update(refreshTokens)
    .set({ supersededAt: now })
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
    // 곁다리 용량 관리 — 이 유저의 만료 행만 걷는다(보안 경계가 아니다, 아래 주석 참고).
    await cleanupRefreshTokens(db, won.userId, now);
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
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);

  const verdict = classifyReusedToken(row ?? null, now, GRACE_MS);
  if (verdict === "invalid") return { ok: false, reason: "invalid" };

  if (verdict === "reuse-grace") {
    /* 정상 동시 탭: 후계는 저장돼 있지 않고 위에서 같은 값으로 재계산됐다(successor).
       후계 행의 상태로 갈린다. */
    const [successorRow] = await db
      .select({
        supersededAt: refreshTokens.supersededAt,
        revokedAt: refreshTokens.revokedAt,
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, await hashToken(successor)))
      .limit(1);

    /* 행이 아직 안 보인다 = 승자가 claim 은 했는데 INSERT 가 아직 커밋 전. D1 엔 트랜잭션이
       없어 그 둘이 별개 문장이라 생기는 틈이고, access 만료 직후 병렬 로드에서 흔히 밟는다.
       여기서 invalid 를 주면 proxy 가 쿠키를 걷어 **멀쩡한 세션이 로그아웃**된다. 후계는 claim
       이 원자적으로 확정한 결정적 값이므로 낙관적으로 돌려준다 — 정말 고아(claim 후 크래시)
       였다면 다음 회전에서 조용히 fail-closed 로 끊긴다. 즉시 로그아웃보다 그쪽이 낫다. */
    if (successorRow === undefined) {
      return { ok: true, token: successor, userId: row!.userId, familyId: row!.familyId };
    }

    /* 행이 있으면 살아있을 때만 준다:
       - revoked = family 가 폐기됨(로그아웃·도난) → 되살리지 않는다.
       - superseded = 그 사이 체인이 더 굴렀다(T1→T2→T3). 늦게 도착한 T1 에 이미 회전된 T2 를
         주면 브라우저가 죽은 refresh 를 쿠키에 물고, 다음 회전에서 T2 가 grace 밖 재사용으로
         분류돼 **멀쩡한 세션의 family 전체가 도난으로 폐기**된다. */
    if (successorRow.supersededAt === null && successorRow.revokedAt === null) {
      return { ok: true, token: successor, userId: row!.userId, familyId: row!.familyId };
    }
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

/* 무한 누적 방지 — **만료된 행만** 지운다. 삭제 하한을 만료에 결속하는 이유: superseded 행을
   만료 전에 지우면 재사용 조회가 row=null→invalid 로 떨어져 도난이 조용히 통과한다(만료 토큰은
   재사용해도 classify 가 invalid 라 탐지에 무관하다).

   평문 정리 단계는 없어졌다 — 후계를 저장하지 않고 재계산하므로 DB 엔 해시만 있다. 그래서 이
   청소는 이제 **보안 경계가 아니라 용량 관리**이고, 지연 호출(로그인·회전 성공 시 곁다리)로
   충분하다. 초판은 평문 제거를 이 호출에 의존해서, 요청이 끊기면 활성 토큰 평문이 남았다.

   범위를 **자기 유저로 좁힌다**: expires_at 엔 인덱스가 없어 전역 DELETE 는 회전마다 풀스캔 +
   쓰기 락이 된다. user_id 인덱스를 타면 각자 자기 행을 치우므로 부하가 분산되고 효과는 같다. */
export async function cleanupRefreshTokens(db: Db, userId: number, now: number): Promise<void> {
  await db
    .delete(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), lt(refreshTokens.expiresAt, now)));
}
