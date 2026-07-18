/* wrangler.jsonc 에 없는(따라서 cf-typegen 이 못 만드는) 런타임 시크릿의 타입. 값은 저장소가
   아니라 .dev.vars(로컬)·Cloudflare secret / 1Password Environment(배포)로 주입된다(불변식 4).
   Phase 3 엔 카테고리 검색·seed 가 client_credentials 를 쓴다 — 없으면 category.search 는
   PRECONDITION_FAILED 로 실패하고(Q2: 라이브는 creds 있을 때만), 공개 읽기는 무관하다.
   Phase 4(인증)가 AUTH_SECRET(JWT 서명)·SUPERADMIN_CHANNEL_ID(부트스트랩)·AUTH_URL(콜백 origin)
   을 추가한다 — AUTH_SECRET 없으면 auth 가 throw, 나머지가 없으면 provider 0 개로 로그인만 꺼진다.
   optional(?)로 둬서 소비 지점이 부재를 반드시 다루게 한다.

   getCloudflareContext().env 는 global CloudflareEnv, cloudflare:test 의 env 는 Cloudflare.Env
   라 둘 다 병합한다(생성 파일에서 각각 __BaseEnv_CloudflareEnv 를 확장하지만, 그 생성 베이스는
   재생성 때 덮이므로 건드리지 않는다). */
declare global {
  interface CloudflareEnv {
    CHZZK_CLIENT_ID?: string;
    CHZZK_CLIENT_SECRET?: string;
    AUTH_SECRET?: string;
    SUPERADMIN_CHANNEL_ID?: string;
    AUTH_URL?: string;
  }
  namespace Cloudflare {
    interface Env {
      CHZZK_CLIENT_ID?: string;
      CHZZK_CLIENT_SECRET?: string;
      AUTH_SECRET?: string;
      SUPERADMIN_CHANNEL_ID?: string;
      AUTH_URL?: string;
    }
  }
}

export {};
