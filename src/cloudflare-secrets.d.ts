/* wrangler.jsonc 에 없는(따라서 cf-typegen 이 못 만드는) 런타임 시크릿의 타입. 값은 저장소가
   아니라 .dev.vars(로컬)·Cloudflare secret / 1Password Environment(배포)로 주입된다(불변식 4).
   Phase 3 엔 카테고리 검색·seed 가 client_credentials 를 쓴다 — 없으면 category.search 는
   PRECONDITION_FAILED 로 실패하고(Q2: 라이브는 creds 있을 때만), 공개 읽기는 무관하다.
   Phase 4(인증, ADR-0017)가 추가한다: JWT_SIGNING_JWK(EdDSA private, access 서명)·JWT_PUBLIC_JWK
   (EdDSA public, access 검증)·SUPERADMIN_CHANNEL_ID(부트스트랩)·AUTH_URL(콜백 origin·리다이렉트).
   키가 없으면 로그인·refresh 가 꺼지고 공개 읽기만 된다. optional(?)로 둬서 소비 지점이 부재를
   반드시 다루게 한다.

   OG_SCHEDULE_SPIKE 만 성격이 다르다 — 비밀이 아니라 **기능 플래그**다. 주입 경로가 같아서
   (wrangler 의 .dev.vars / secret) 여기 얹었을 뿐이고, 값 자체엔 감출 것이 없다. 로컬에만 두고
   Cloudflare 에는 넣지 않아 배포본에서 스파이크 라우트가 404 가 된다(그 근거는 라우트 주석).

   getCloudflareContext().env 는 global CloudflareEnv, cloudflare:test 의 env 는 Cloudflare.Env
   라 둘 다 병합한다(생성 파일에서 각각 __BaseEnv_CloudflareEnv 를 확장하지만, 그 생성 베이스는
   재생성 때 덮이므로 건드리지 않는다). */
declare global {
  interface CloudflareEnv {
    CHZZK_CLIENT_ID?: string;
    CHZZK_CLIENT_SECRET?: string;
    JWT_SIGNING_JWK?: string;
    JWT_PUBLIC_JWK?: string;
    SUPERADMIN_CHANNEL_ID?: string;
    AUTH_URL?: string;
    OG_SCHEDULE_SPIKE?: string;
  }
  namespace Cloudflare {
    interface Env {
      CHZZK_CLIENT_ID?: string;
      CHZZK_CLIENT_SECRET?: string;
      JWT_SIGNING_JWK?: string;
      JWT_PUBLIC_JWK?: string;
      SUPERADMIN_CHANNEL_ID?: string;
      AUTH_URL?: string;
      OG_SCHEDULE_SPIKE?: string;
    }
  }
}

export {};
