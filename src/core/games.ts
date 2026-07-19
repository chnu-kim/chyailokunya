/* 게임 보드 도메인 — 순수 로직(HTTP·DB·React 무관). 날짜 값 객체(YYYY-MM-DD)·카드 회전/
   패턴 해시, 그리고 치지직 category → games 매핑을 담는다.

   상태(STATUS/statusOf/isStatus)는 제거됐다 — 별도 컬럼으로 두면 날짜와 어긋난 상태
   ("클리어인데 cleared_at 이 null")가 저장 가능해진다. 이제 정본은 날짜 두 개뿐이고
   "클리어했나"는 clearedAt !== null 로 유도한다.

   localStorage 시대의 coerce/parseGames/seeds 는 제거됐다 — D1(서버 권위)이 목록의 정본이
   되면서(ADR-0014·이슈 #5) "신뢰하지 않는 문자열을 배열로 강제 변환"하던 경계가 서버 입력
   검증(Zod, features/games/schema)으로 옮겨갔다. 이 파일엔 UI 가 쓰는 순수 표시 로직만 남는다. */

/* ── 날짜(YYYY-MM-DD) ────────────────────────────────────────────────────────
   played_at·cleared_at 은 "달력의 하루"지 시각이 아니다. epoch ms 로 두면 저장·표시
   양쪽에서 타임존이 개입해 KST 자정 근처의 하루가 밀린다 — 텍스트 'YYYY-MM-DD' 로
   저장하면 저장은 타임존 무관이 되고, 타임존은 "오늘이 며칠인가"(입력 기본값)에서만
   한 번 고려하면 된다. 상태(status)는 이 두 날짜에서 유도되므로 컬럼을 없앴다. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* 형식만 맞고 실재하지 않는 날짜(2026-02-31·2026-13-01)를 걸러낸다. Date 파싱은 이런
   값을 조용히 다음 달로 굴리므로(2026-02-31 → 3/3), 되돌려 찍은 문자열이 입력과
   같은지로 확인해야 롤오버가 잡힌다. */
export function isDateString(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  // Z 를 붙여 UTC 로 파싱한다 — 로컬 타임존이 개입하면 toISOString 왕복이 하루 밀린다.
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// 표시용: '2026-07-20' → '2026.07.20'. 구 사이트의 점 구분 표기를 잇는다.
export function formatDate(date: string): string {
  return date.replaceAll("-", ".");
}

/* "오늘"(KST)을 구하는 todayKST 가 여기 있었다 — 프로덕션 호출자가 한 번도 안 생겨 삭제했다.
   유일한 후보였던 날짜 입력 기본값은 game-dialog.tsx 가 의도적으로 비워 두기로 결정했고
   (그 근거는 그 파일 주석에 있다), 테스트만 보증하는 API 는 남기지 않는다(ADR-0010). */

/* 클리어가 플레이보다 앞설 수는 없다. 한쪽이 null 이면(플레이 없이 클리어만 아는
   경우 포함) 비교할 게 없으니 참이다. 'YYYY-MM-DD' 는 사전순 = 시간순이라 문자열
   비교로 충분하다. */
export function isDateOrderValid(playedAt: string | null, clearedAt: string | null): boolean {
  if (playedAt === null || clearedAt === null) return true;
  return clearedAt >= playedAt;
}

/* 기울기·종이결·썸네일 패턴은 카드의 정체성이지 목록 위치가 아니다. 인덱스로 고르면
   하나 추가·삭제할 때마다 보드 전체가 다시 기울어진다 — id 해시로 안정적으로 고른다. */
export const ROT = ["-1.4deg", "0.8deg", "-0.6deg", "1.3deg", "-1deg", "0.5deg"] as const;
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
