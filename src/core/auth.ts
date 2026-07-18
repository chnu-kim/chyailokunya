/* 인증 세션의 순수 로직(ADR-0006·0017). HTTP·DB 무관 — 부트스트랩 판정만 담아 단위테스트로
   못박는다. OAuth 콜백(app/api/auth/callback/chzzk)이 이 함수를 호출해 최초 로그인 시 superadmin
   승격 여부를 정한다. (access 엔 authorities 를 싣지 않으므로 클레임 직렬화·좁힘 로직은 없다 —
   인가는 인가 순간 DB 조회로 한다, ADR-0017.) */

/* SUPERADMIN_CHANNEL_ID 부트스트랩 판정. env 가 비었으면(미설정) 아무도 승격하지 않는다 —
   부트스트랩은 "정확히 이 channelId 의 최초 로그인"에만 일어나야 superadmin 증식·오승격이
   없다. env 값에 딸려오는 앞뒤 공백은 조여 비교한다(설정 실수로 조용히 어긋나지 않게). */
export function shouldBootstrapSuperadmin(
  channelId: string,
  superadminChannelId: string | undefined,
): boolean {
  const target = (superadminChannelId ?? "").trim();
  if (!target) return false;
  return channelId.trim() === target;
}
