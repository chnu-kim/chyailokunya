/* 게임 보드 도메인 — 순수 로직(HTTP·DB·React 무관). 클리어 상태·카드 회전/패턴 해시,
   그리고 치지직 category → games 매핑을 담는다.

   상태(STATUS/statusOf/isStatus)는 제거됐다 — 별도 컬럼으로 두면 날짜와 어긋난 상태가
   저장 가능해진다. 플레이 날짜의 정본은 이제 일정(schedule_entries)이고, 보드는 그 항목의
   MAX(scheduled_date)로 유도한다(이슈 #56 결정 3·17). 클리어만 게임 자체의 사실로 남아
   여기 산다 — cleared 플래그(정본) + 선택적 cleared_date.

   localStorage 시대의 coerce/parseGames/seeds 는 제거됐다 — D1(서버 권위)이 목록의 정본이
   되면서(ADR-0014·이슈 #5) "신뢰하지 않는 문자열을 배열로 강제 변환"하던 경계가 서버 입력
   검증(Zod, features/games/schema)으로 옮겨갔다. 이 파일엔 UI 가 쓰는 순수 표시 로직만 남는다. */

/* ── 클리어 상태 ─────────────────────────────────────────────────────────────
   cleared_date 는 "달력의 하루"지 시각이 아니다. epoch ms 로 두면 저장·표시 양쪽에서
   타임존이 개입해 KST 자정 근처의 하루가 밀린다 — 텍스트 'YYYY-MM-DD' 로 저장하면 저장은
   타임존 무관이 되고, 타임존은 "오늘이 며칠인가"(입력 기본값)에서만 한 번 고려하면 된다.

   날짜 형식 검증(isDateString)은 core/calendar.ts::isIsoDate 로 옮겼다 — 일정과 게임이 같은
   판정을 나눠 쓰면 정본이 코드 밖에 남는다(Temporal 판정이 더 엄해 확장 표기를 거절한다). */

// 표시용: '2026-07-20' → '2026.07.20'. 구 사이트의 점 구분 표기를 잇는다.
export function formatDate(date: string): string {
  return date.replaceAll("-", ".");
}

/* 클리어 상태의 정합성 — DB CHECK(cleared = 1 OR cleared_date IS NULL)의 도메인 짝이다.
   안 깬 게임에 클리어 날짜가 붙는 모순만 막는다: cleared 가 false 인데 날짜가 있으면 거짓.
   깬 채 날짜가 null("깼는데 날짜 모름", 할로우 나이트)은 참 — 그 표현을 살리려고 플래그를
   날짜와 독립으로 뒀기 때문이다. 플레이 날짜는 일정 정본으로 옮겨가 여기서 비교하지 않는다. */
export function isClearedStateValid(cleared: boolean, clearedDate: string | null): boolean {
  return cleared || clearedDate === null;
}

/* 기울기·종이결·썸네일 패턴은 카드의 정체성이지 목록 위치가 아니다. 인덱스로 고르면
   하나 추가·삭제할 때마다 보드 전체가 다시 기울어진다 — id 해시로 안정적으로 고른다.
   폭이 ±1.4° 였다가 ±1.2° 로 좁아졌다: 포스터가 비어 패턴+이니셜만 있던 시절엔 기울기가
   "손으로 붙인 종이"를 혼자 말했지만, 실제 표지가 들어온 뒤로는 그림이 그 일을 대신하고
   각도는 정렬이 어긋난 노이즈로 먼저 읽힌다. 종수(6)는 줄이지 않는다 — 값이 적어지면
   같은 각도의 카드가 눈에 띄게 뭉친다. */
export const ROT = ["-1.2deg", "0.7deg", "-0.5deg", "1.1deg", "-0.9deg", "0.4deg"] as const;
export const ANGLE = ["135deg", "45deg", "160deg", "20deg", "110deg", "70deg"] as const;
export const PATTERNS = 4; // games.css 의 .game__thumb[data-p="0..3"]

export function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/* 축마다 해시를 새로 돌린다(소금을 다르게 준다). 한 해시를 >>3, >>6 으로 나눠 쓰면 안
   된다 — id 가 '1'..'8' 처럼 끝 한 글자만 다를 때 상위 비트가 전부 같아 축이 통째로
   붕괴한다(실측: 끝자리만 다른 8개가 패턴 1종·각도 2종). 소금을 주면 고르게 퍼진다. */
export function axis(id: string, salt: string, n: number): number {
  return hash(id + "/" + salt) % n;
}

/* ── 치지직 category API 매핑 (ADR-0015) ─────────────────────────────────────
   게임 정보원은 치지직 category API 하나다. 반환 4필드만 쓰고 보드는 GAME 만 담는다.
   여기선 순수 타입·필터만 둔다 — 네트워크·인증은 features/chzzk, trim·empty→null
   정규화·상한·URL 스킴 검증은 쓰기 입력 경계(features/games/schema.ts::addGameInput)
   가 정본이다. 예전엔 이 파일에 별도 toGameSnapshot 정규화 함수가 있었지만 프로덕션
   호출자가 없었다(실트래픽은 전부 Zod 경계를 지난다) — 테스트만 보증하고 아무도 안
   쓰는 interface라 삭제했다. 정규화 정본은 하나만 남긴다. */

export type ChzzkCategory = {
  categoryType: string;
  categoryId: string;
  categoryValue: string;
  posterImageUrl: string | null;
};

// 보드는 GAME 카테고리만 담는다(ADR-0015). SPORTS·ETC 는 걸러낸다.
export function isGameCategory(c: ChzzkCategory): boolean {
  return c.categoryType === "GAME";
}
