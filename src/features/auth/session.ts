/* 세션 오케스트레이션(ADR-0017). tokens(access 서명)·refresh-service(rotation)·service(신원)를
   엮어 로그인 발급·refresh 갱신을 만든다. private JWK 는 인자로 받는다(app 이 env 에서 로드) —
   features 는 시크릿 로딩을 몰라 순수 db·jose 조합만 한다. access 는 신원 클레임을 담고, 신원은
   getIdentity(로그인 시 저장한 채널명 스냅샷)로 재구성한다. */

import type { JWK } from "jose";
import type { Db } from "@/db";
import { ACCESS_TTL_MS } from "./config";
import { createSession, rotateRefreshToken } from "./refresh-service";
import { getIdentity } from "./service";
import { signAccessToken } from "./tokens";

export type SessionTokens = { access: string; refresh: string };

/* 로그인 성공 시 세션 발급: 신원으로 access 서명 + 새 refresh family. 신원 조회 실패(로그인
   이력 없음)면 null. */
export async function issueSession(
  db: Db,
  privateJwk: JWK,
  userId: number,
  now: number,
): Promise<SessionTokens | null> {
  const id = await getIdentity(db, userId);
  if (!id) return null;
  const access = await signAccessToken(privateJwk, { userId, ...id }, ACCESS_TTL_MS, now);
  const { token: refresh } = await createSession(db, userId, now);
  return { access, refresh };
}

/* access 만료 시 refresh 로 갱신: rotation(성공 시 새 refresh) + 신원으로 새 access. rotation 이
   실패(만료·도난·무효)면 null → 소비자가 세션을 걷어낸다. */
export async function refreshSession(
  db: Db,
  privateJwk: JWK,
  presentedRefresh: string,
  now: number,
): Promise<SessionTokens | null> {
  const rot = await rotateRefreshToken(db, presentedRefresh, now);
  if (!rot.ok) return null;
  const id = await getIdentity(db, rot.userId);
  if (!id) return null;
  const access = await signAccessToken(
    privateJwk,
    { userId: rot.userId, ...id },
    ACCESS_TTL_MS,
    now,
  );
  return { access, refresh: rot.token };
}
