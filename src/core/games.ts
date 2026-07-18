/* 게임 보드 도메인 — 순수 로직(HTTP·DB·React 무관). 표시용 상태 메타·카드 회전/패턴 해시,
   그리고 치지직 category → games 매핑을 담는다.

   localStorage 시대의 coerce/parseGames/seeds 는 제거됐다 — D1(서버 권위)이 목록의 정본이
   되면서(ADR-0014·이슈 #5) "신뢰하지 않는 문자열을 배열로 강제 변환"하던 경계가 서버 입력
   검증(Zod, features/games/schema)으로 옮겨갔다. 이 파일엔 UI 가 쓰는 순수 표시 로직만 남는다. */

// 상태 키 — 이 배열이 타입·DB enum·CHECK 의 단일 원천이다(db/schema.ts 가 import 한다).
export const STATUS_KEYS = ["playing", "cleared", "planned", "played"] as const;
export type Status = (typeof STATUS_KEYS)[number];

export type StatusMeta = { label: string; cls: string };

// 상태 정의 — 칩 색 매핑
export const STATUS: Record<Status, StatusMeta> = {
  playing: { label: "플레이중", cls: "chip--live" },
  cleared: { label: "클리어", cls: "chip--ok" },
  planned: { label: "예정", cls: "chip--warn" },
  played: { label: "플레이함", cls: "" },
};

// 대괄호 조회는 프로토타입 체인을 탄다: key='constructor' 면 Object 가 반환돼 폴백이
// 안 걸리고 'undefined' 가 화면에 찍힌다. hasOwnProperty 로 자기 속성만 인정한다.
export function statusOf(key: string): StatusMeta {
  return Object.prototype.hasOwnProperty.call(STATUS, key) ? STATUS[key as Status] : STATUS.played;
}

// Zod 밖에서도 상태를 좁힐 때(서버 입력·매핑 경계). statusOf 와 같은 자기속성 검사라
// 프로토타입 체인 키('constructor' 등)를 상태로 오인하지 않는다.
export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(STATUS, v);
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
   여기선 순수 변환·필터만 한다 — 네트워크·인증은 features/chzzk 가, 저장은 db 가 맡는다. */

export type ChzzkCategory = {
  categoryType: string;
  categoryId: string;
  categoryValue: string;
  posterImageUrl: string | null;
};

// games 테이블에 스냅샷으로 박히는 4필드(denormalize). status·날짜는 우리 도메인이라 별도.
export type GameSnapshot = {
  categoryId: string;
  categoryType: "GAME";
  categoryValue: string;
  posterImageUrl: string | null;
};

// 보드는 GAME 카테고리만 담는다(ADR-0015). SPORTS·ETC 는 걸러낸다.
export function isGameCategory(c: ChzzkCategory): boolean {
  return c.categoryType === "GAME";
}

/* category → games 스냅샷. GAME 이 아니거나 식별자·이름이 비면 null(호출측이 거른다).
   poster 의 빈 문자열은 null 로 정규화한다 — DB 는 "없음"을 null 로 표현하고, 카드
   렌더가 poster 유무로 이니셜 폴백을 가른다. */
export function toGameSnapshot(c: ChzzkCategory): GameSnapshot | null {
  if (!isGameCategory(c)) return null;
  const categoryId = c.categoryId.trim();
  const categoryValue = c.categoryValue.trim();
  if (!categoryId || !categoryValue) return null;
  const poster = (c.posterImageUrl ?? "").trim();
  return { categoryId, categoryType: "GAME", categoryValue, posterImageUrl: poster || null };
}
