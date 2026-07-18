/* Auth.js(next-auth v5) 정본(ADR-0017). 치지직 커스텀 OAuth → 자체 JWT 세션(ADR-0006).
   config 를 함수로 넘겨 요청 스코프에서 getCloudflareContext().env 로 시크릿을 읽는다 —
   Workers 는 process.env 가 아니라 바인딩이라 lazy 주입이 필요하다. DB adapter 는 두지 않는다:
   신원 upsert 를 우리가 직접 하고(users↔oauth 분리) 치지직 토큰은 저장하지 않는다(ADR-0006).
   effective authorities 를 JWT 클레임에 실어 인가 핫패스에 DB 왕복이 없다(ADR-0014). */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import NextAuth from "next-auth";
import { authoritiesFor, type Authority } from "@/core/authorities";
import { authoritiesToClaim, shouldBootstrapSuperadmin } from "@/core/auth";
import { makeDb } from "@/db";
import { chzzkProvider, type ChzzkProfile } from "@/features/auth/chzzk-provider";
import { ensureSuperadmin, listRolesForChannel, upsertChzzkAccount } from "@/features/auth/service";

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const { env } = getCloudflareContext();
  if (!env.AUTH_SECRET) throw new Error("AUTH_SECRET 미설정 — 인증을 켤 수 없어요");

  /* 치지직 시크릿·AUTH_URL 이 다 있어야 provider 를 켠다. 없으면 provider 0 개 — 공개 읽기는
     계속 되고, 로그인 시도만 안전하게 실패한다(개발 중 부분 설정 방어). */
  const providers =
    env.CHZZK_CLIENT_ID && env.CHZZK_CLIENT_SECRET && env.AUTH_URL
      ? [
          chzzkProvider({
            clientId: env.CHZZK_CLIENT_ID,
            clientSecret: env.CHZZK_CLIENT_SECRET,
            redirectUri: `${env.AUTH_URL}/api/auth/callback/chzzk`,
          }),
        ]
      : [];

  return {
    secret: env.AUTH_SECRET,
    trustHost: true, // Workers 뒤 프록시 호스트를 신뢰한다 — AUTH_URL 이 정본 origin.
    session: { strategy: "jwt" },
    providers,
    callbacks: {
      /* 최초 로그인(account+profile 존재)에만 DB 를 친다 — 신원 upsert·부트스트랩·역할 조회 후
         effective authorities 를 토큰에 굽는다. 이후 요청은 토큰을 그대로 신뢰(핫패스 DB 왕복 0).
         대가는 staleness: 역할 변경은 대상자 재로그인 전까지 세션에 안 뜬다(ADR-0014). */
      async jwt({ token, account, profile }) {
        if (account?.provider === "chzzk" && profile) {
          const p = profile as ChzzkProfile;
          const channelId = (p.channelId ?? "").trim();
          if (channelId) {
            const db = makeDb(getCloudflareContext().env.DB);
            const { userId } = await upsertChzzkAccount(db, channelId);
            const superadminId = getCloudflareContext().env.SUPERADMIN_CHANNEL_ID;
            if (shouldBootstrapSuperadmin(channelId, superadminId)) {
              await ensureSuperadmin(db, userId);
            }
            const roles = await listRolesForChannel(db, channelId);
            token.channelId = channelId;
            token.channelName = p.channelName ?? "";
            token.userId = userId;
            token.authorities = authoritiesToClaim(authoritiesFor(roles));
          }
        }
        return token;
      },
      // JWT 클레임을 세션으로 노출. 인가는 tRPC 컨텍스트가 이 authorities 를 읽어 판단한다.
      // JWT 보강이 안 닿아(위 타입 파일 주석) token 을 로컬 클레임 타입으로 읽는다 — jwt
      // 콜백이 이 필드들을 채운 뒤라 런타임은 안전하다.
      session({ session, token }) {
        const claims = token as {
          authorities?: Authority[];
          userId?: number;
          channelId?: string;
          channelName?: string;
        };
        session.authorities = claims.authorities ?? [];
        if (claims.userId != null) session.user.userId = claims.userId;
        if (claims.channelId) session.user.channelId = claims.channelId;
        session.user.name = claims.channelName ?? null;
        return session;
      },
    },
  };
});
