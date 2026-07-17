/* 게임 보드 도메인 — 순수 로직(HTTP·DB·React·localStorage 무관). 구 games.js 의
   신뢰하지 않는 입력 처리를 이 레이어로 옮겨 workerd 안에서 단위 테스트로 못박는다.
   localStorage 접근(부수효과)은 UI(game-board.tsx)에 남고, 여기선 "받은 문자열을
   렌더 가능한 배열로 강제 변환"만 한다.

   v1 은 아직 클라이언트 전용 localStorage 보드다(D1 은 Phase 3+). 그래서 검증은 Zod
   대신 이 이식된 coerce/parseGames 로 한다 — 경계 케이스(프로토타입 체인·비배열 JSON·
   빈 배열 대 전부-걸러짐)가 이미 값비싸게 튜닝돼 있어 그 의미를 그대로 보존한다. Zod 는
   서버 쓰기 경계(tRPC)가 생기는 Phase 3/4 에서 제자리를 얻는다. */

export type Status = "playing" | "cleared" | "planned" | "played";

export type Game = {
  id: string;
  name: string;
  genre: string;
  platform: string;
  status: Status;
};

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

// 사용자 제공 예시 8종. 널리 알려진 게임만 장르를 채우고, 불확실하면 '—'.
const SEED: ReadonlyArray<Omit<Game, "id">> = [
  { name: "마이 보이스 주", genre: "—", platform: "—", status: "played" },
  { name: "마인크래프트", genre: "샌드박스", platform: "PC", status: "playing" },
  { name: "겟 투 워크", genre: "—", platform: "—", status: "played" },
  { name: "레이튼 교수와 이상한 마을", genre: "퍼즐 어드벤처", platform: "—", status: "cleared" },
  { name: "레이튼 교수와 악마의 상자", genre: "퍼즐 어드벤처", platform: "—", status: "played" },
  { name: "리그 오브 레전드", genre: "AOS", platform: "PC", status: "playing" },
  { name: "리틀 나이트메어", genre: "호러 퍼즐", platform: "—", status: "cleared" },
  { name: "엘든링", genre: "액션 RPG", platform: "PC", status: "played" },
];

export function seeds(): Game[] {
  return SEED.map((g, i) => ({ id: "seed-" + i, ...g }));
}

/* 어떤 레코드든 렌더 가능한 형태로 강제 변환한다. 문자열이 아닌 name 하나가 map() 안에서
   던지면 카드가 통째로 사라지므로 경계에서 막는다. name 이 비면 카드가 아니라 null. */
export function coerce(g: unknown, i: number): Game | null {
  if (!g || typeof g !== "object") return null;
  const rec = g as Record<string, unknown>;
  const name = String(rec.name == null ? "" : rec.name).trim();
  if (!name) return null;
  return {
    id: String(rec.id == null ? "" : rec.id) || "g-" + i + "-" + name.length,
    name,
    genre: String(rec.genre == null ? "" : rec.genre).trim() || "—",
    platform: String(rec.platform == null ? "" : rec.platform).trim() || "—",
    status:
      typeof rec.status === "string" && Object.prototype.hasOwnProperty.call(STATUS, rec.status)
        ? (rec.status as Status)
        : "played",
  };
}

export type ParseResult = {
  games: Game[];
  // 저장소를 지워야 하는가 — 손상(비배열·전부 걸러짐)일 때만 true. 호출측이 removeItem 한다.
  clear: boolean;
};

/* localStorage 문자열(또는 null)을 게임 배열로 강제 변환한다. 구 games.js load() 의
   판단을 그대로 옮겼다:
   - 비어 있음 → 시드(지울 것 없음)
   - JSON.parse 실패 또는 배열 아님 → 시드 + 저장소 클리어 (예: '{"a":1}'·'null'·'0' 도 파싱 통과)
   - 빈 배열 → 빈 배열 그대로. "저장소가 깨졌다"가 아니라 "사용자가 다 지웠다"이므로 시드로
     되살리면 삭제가 새로고침마다 취소되고 빈 상태 화면에 영영 닿지 못한다.
   - 레코드가 있었는데 전부 걸러짐 → 손상으로 보고 시드 + 클리어. */
export function parseGames(raw: string | null): ParseResult {
  if (!raw) return { games: seeds(), clear: false };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed)) return { games: seeds(), clear: true };
  const clean = parsed.map((g, i) => coerce(g, i)).filter((g): g is Game => g !== null);
  if (parsed.length > 0 && clean.length === 0) return { games: seeds(), clear: true };
  return { games: clean, clear: false };
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
   된다 — id 가 'seed-0'..'seed-7' 처럼 끝 한 글자만 다를 때 상위 비트가 전부 같아 축이
   통째로 붕괴한다(실측: 시드 8장이 패턴 1종·각도 2종). 소금을 주면 고르게 퍼진다. */
export function axis(id: string, salt: string, n: number): number {
  return hash(id + "/" + salt) % n;
}
