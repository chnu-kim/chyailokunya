/* OG 카드 공유 상수. 페이지 metadata 의 openGraph 는 layout 의 것을 "얕게" 덮어쓴다
   (딥 머지가 아니다) — 페이지가 openGraph 를 선언하면 siteName·locale·images 가 통째로
   사라진다. 그래서 각 페이지가 이 상수로 공유 필드를 다시 싣는다. og:image 는 절대 URL
   이어야 하고(metadataBase 가 절대화), 저장소 리네임·도메인 이동 시 세 페이지가 함께 옮겨야
   하는 자리는 이 한 파일로 모았다. */
export const OG_SITE_NAME = "챠이로 쿠냐 팬 사이트";
export const OG_LOCALE = "ko_KR";
export const OG_IMAGE = {
  url: "/assets/og-cover.jpg",
  width: 1200,
  height: 630,
  alt: "챠이로 쿠냐 팬 사이트 커버 — 줄노트 위 손글씨 이름과 테이프로 붙인 폴라로이드 사진",
} as const;
