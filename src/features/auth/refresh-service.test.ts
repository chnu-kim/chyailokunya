import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { makeDb, refreshTokens, securityEvents } from "@/db";
import { GRACE_MS, REFRESH_TTL_MS } from "./config";
import {
  cleanupRefreshTokens,
  createSession,
  revokeAllForUser,
  revokeSession,
  rotateRefreshToken,
} from "./refresh-service";
import { upsertChzzkAccount } from "./service";
import type { JWK } from "jose";

/* refresh rotation·재사용 감지를 D1(env.DB) 위에서 검증한다 — 이 저장소 보안의 핵심이라 각
   경로(회전·만료·미존재·grace·도난·격리·동시성)를 개별로 못박는다. apply-migrations 가 매
   테스트 전 빈 스키마로 되돌린다. now 는 인자로 주입해 시간 경로를 결정적으로 만든다. */

const db = () => makeDb(env.DB);
const NOW = 1_000_000;

/* 회전에 쓰는 서명 키. 프로덕션은 env 의 JWT_SIGNING_JWK 이고, 여기선 파생에 필요한 d 만 있으면
   된다 — 후계 파생의 결정성(같은 구 토큰 → 같은 후계)이 grace 멱등의 전제라 실제 구현을 태운다. */
const TEST_JWK = { kty: "OKP", d: "test-derive-material" } as JWK;

async function seedUser(channelId = "chan-a"): Promise<number> {
  const { userId } = await upsertChzzkAccount(db(), channelId);
  return userId;
}

describe("createSession", () => {
  it("refresh 를 발급하고 유효 행 1개를 남긴다(같은 family)", async () => {
    const userId = await seedUser();
    const { token, familyId } = await createSession(db(), userId, NOW);

    expect(token).toBeTruthy();
    const rows = await db().select().from(refreshTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.familyId).toBe(familyId);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.revokedAt).toBeNull();
    expect(rows[0]!.expiresAt).toBeGreaterThan(NOW);
    expect(rows[0]!.familyExpiresAt).toBeGreaterThan(rows[0]!.expiresAt);
  });
});

describe("rotateRefreshToken — 유효 회전", () => {
  it("유효 refresh 는 새 토큰을 발급하고 이전 것을 revoke 한다(같은 family)", async () => {
    const userId = await seedUser();
    const { token, familyId } = await createSession(db(), userId, NOW);

    const res = await rotateRefreshToken(db(), token, NOW + 60_000, TEST_JWK);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.userId).toBe(userId);
    expect(res.familyId).toBe(familyId);
    expect(res.token).not.toBe(token);

    const rows = await db()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.familyId, familyId));
    expect(rows).toHaveLength(2); // 구(회전됨=superseded) + 신(유효)
    expect(rows.filter((r) => r.supersededAt !== null)).toHaveLength(1); // 구: 회전됨(폐기 아님)
    expect(await aliveIn(familyId)).toHaveLength(1); // 신: 살아있음(둘 다 null)
  });
});

// "살아있는" refresh = 회전도 폐기도 안 됨(둘 다 null).
const aliveIn = (familyId: string) =>
  db()
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.familyId, familyId),
        isNull(refreshTokens.supersededAt),
        isNull(refreshTokens.revokedAt),
      ),
    );

describe("rotateRefreshToken — 재사용·무효", () => {
  it("만료된 refresh 는 invalid (family 안 건드림)", async () => {
    const userId = await seedUser();
    const { token } = await createSession(db(), userId, NOW);
    const res = await rotateRefreshToken(db(), token, NOW + REFRESH_TTL_MS + 1, TEST_JWK);
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });

  it("존재하지 않는 토큰은 invalid", async () => {
    const res = await rotateRefreshToken(db(), "nonexistent-token", NOW, TEST_JWK);
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });

  it("grace 재사용은 멱등 — 같은 후계를 반환하고 새로 찍지 않는다(진짜 수렴)", async () => {
    const userId = await seedUser();
    const { token, familyId } = await createSession(db(), userId, NOW);
    const first = await rotateRefreshToken(db(), token, NOW + 1000, TEST_JWK); // 승자 → 후계 A
    const again = await rotateRefreshToken(db(), token, NOW + 5000, TEST_JWK); // grace → 멱등 반환
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.token).toBe(first.token); // 같은 후계(수렴, 증식 아님)
    expect(again.familyId).toBe(familyId);
    expect(await aliveIn(familyId)).toHaveLength(1); // family alive head = 1
  });

  it("도난 반복 재사용도 증식하지 않는다 — alive head 1 유지(탐지 무력화 방지)", async () => {
    const userId = await seedUser();
    const { token, familyId } = await createSession(db(), userId, NOW);
    await rotateRefreshToken(db(), token, NOW + 1000, TEST_JWK);
    for (let i = 0; i < 5; i++) await rotateRefreshToken(db(), token, NOW + 2000 + i, TEST_JWK); // grace 내 5번
    expect(await aliveIn(familyId)).toHaveLength(1); // 새 토큰 다발 안 생김
  });

  it("grace 밖 재사용은 도난 — family 전체 revoke", async () => {
    const userId = await seedUser();
    const { token, familyId } = await createSession(db(), userId, NOW);
    await rotateRefreshToken(db(), token, NOW + 1000, TEST_JWK); // token revoked
    const res = await rotateRefreshToken(db(), token, NOW + 1000 + GRACE_MS + 1, TEST_JWK);
    expect(res).toEqual({ ok: false, reason: "theft" });
    expect(await aliveIn(familyId)).toHaveLength(0); // 살아있는 토큰 0
  });

  it("family 격리: 한 family 도난 감지가 다른 family(디바이스)를 안 건드린다", async () => {
    const userId = await seedUser();
    const a = await createSession(db(), userId, NOW);
    const b = await createSession(db(), userId, NOW);
    await rotateRefreshToken(db(), a.token, NOW + 1000, TEST_JWK);
    await rotateRefreshToken(db(), a.token, NOW + 1000 + GRACE_MS + 1, TEST_JWK); // a 도난 → familyA 폐기
    expect(await aliveIn(a.familyId)).toHaveLength(0);
    expect((await aliveIn(b.familyId)).length).toBeGreaterThanOrEqual(1); // b 생존
  });

  it("동시 회전 2건은 둘 다 성공(하나 승리·하나 grace 수렴)", async () => {
    const userId = await seedUser();
    const { token } = await createSession(db(), userId, NOW);
    const [r1, r2] = await Promise.all([
      rotateRefreshToken(db(), token, NOW + 1000, TEST_JWK),
      rotateRefreshToken(db(), token, NOW + 1000, TEST_JWK),
    ]);
    expect(r1.ok && r2.ok).toBe(true);
  });
});

describe("revokeSession (로그아웃)", () => {
  it("현재 refresh 의 family 를 폐기해 이후 회전을 막는다", async () => {
    const userId = await seedUser();
    const { token, familyId } = await createSession(db(), userId, NOW);
    await revokeSession(db(), token, NOW + 1000);
    expect(await aliveIn(familyId)).toHaveLength(0);
    expect((await rotateRefreshToken(db(), token, NOW + 2000, TEST_JWK)).ok).toBe(false);
  });

  it("로그아웃 후 grace 창 이내 재사용도 되살아나지 않는다(폐기>회전)", async () => {
    const userId = await seedUser();
    const { token, familyId } = await createSession(db(), userId, NOW);
    await revokeSession(db(), token, NOW + 1000);
    const res = await rotateRefreshToken(db(), token, NOW + 5000, TEST_JWK); // grace 이내
    expect(res.ok).toBe(false);
    expect(await aliveIn(familyId)).toHaveLength(0);
  });
});

describe("보안 이벤트·전역 폐기", () => {
  it("도난 감지 시 security_events 에 refresh_reuse 를 userId 와 함께 기록한다", async () => {
    const userId = await seedUser();
    const { token } = await createSession(db(), userId, NOW);
    await rotateRefreshToken(db(), token, NOW + 1000, TEST_JWK);
    await rotateRefreshToken(db(), token, NOW + 1000 + GRACE_MS + 1, TEST_JWK); // 도난
    const events = await db().select().from(securityEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId, eventType: "refresh_reuse" });
  });

  it("revokeAllForUser 는 유저의 모든 family(기기)를 폐기한다", async () => {
    const userId = await seedUser();
    const a = await createSession(db(), userId, NOW);
    const b = await createSession(db(), userId, NOW);
    await revokeAllForUser(db(), userId, NOW + 1000);
    expect(await aliveIn(a.familyId)).toHaveLength(0);
    expect(await aliveIn(b.familyId)).toHaveLength(0);
    expect((await rotateRefreshToken(db(), a.token, NOW + 2000, TEST_JWK)).ok).toBe(false);
  });
});

describe("cleanupRefreshTokens", () => {
  it("만료된 행을 삭제한다(만료 토큰은 재사용해도 invalid 라 탐지 불필요)", async () => {
    const userId = await seedUser();
    await createSession(db(), userId, NOW);
    await cleanupRefreshTokens(db(), userId, NOW + REFRESH_TTL_MS + 1);
    expect(await db().select().from(refreshTokens)).toHaveLength(0);
  });

  it("만료 전 superseded 행은 남긴다(지우면 재사용이 invalid 로 떨어져 도난이 조용히 통과)", async () => {
    const userId = await seedUser();
    const { token } = await createSession(db(), userId, NOW);
    await rotateRefreshToken(db(), token, NOW + 1000, TEST_JWK);
    await cleanupRefreshTokens(db(), userId, NOW + 1000 + GRACE_MS + 1);
    const superseded = await db()
      .select()
      .from(refreshTokens)
      .where(isNotNull(refreshTokens.supersededAt));
    expect(superseded).toHaveLength(1);
  });
});

/* 적대적 리뷰가 배포 차단으로 지적한 지점을 못박는다: 후계를 저장하던 초판은 *현재 활성*
   refresh 의 평문이 DB 에 남아, DB 를 한 번 읽는 것만으로 세션을 탈취할 수 있었다. 이제
   후계는 구 토큰에서 재계산되므로 어떤 행에도 평문이 없어야 한다 — 청소 호출과 무관하게. */
describe("평문 미저장 경계", () => {
  it("회전 직후에도 DB 어디에도 refresh 평문이 없다(청소 없이)", async () => {
    const userId = await seedUser();
    const { token } = await createSession(db(), userId, NOW);
    const res = await rotateRefreshToken(db(), token, NOW + 1000, TEST_JWK);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const dump = JSON.stringify(await db().select().from(refreshTokens));
    expect(dump).not.toContain(res.token); // 지금 살아 있는 토큰
    expect(dump).not.toContain(token); // 직전 토큰
  });
});
