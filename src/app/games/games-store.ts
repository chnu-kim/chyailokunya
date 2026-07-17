import { parseGames, seeds, type Game } from "@/core/games";

/* localStorage 를 외부 스토어로 다뤄 useSyncExternalStore 로 읽는다. effect 안 동기
   setState 는 Next 16 에서 error 이고(AGENTS 지뢰), 마운트 시 localStorage 를 읽어 시드를
   바로잡는 흔한 패턴이 정확히 거기 걸린다. useSyncExternalStore 는 SSR·수화 때 getServerSnap
   (시드)로 그리고 마운트 후 getSnap(실제 저장 목록)으로 다시 그려, 수화 불일치 없이 이걸
   해결한다 — 테마 토글이 data-theme 를 다루는 방식과 같다.

   스냅샷은 { games, storageOK } 한 객체로 캐시해 참조를 안정화한다(getSnapshot 이 매번 새
   객체를 만들면 무한 루프). commit() 이 목록을 바꿀 때만 새 스냅샷을 만들고 구독자에게 알린다.
   모듈 단일 인스턴스라 클라이언트 내비게이션 사이에도 목록이 유지된다(localStorage 와 일치). */

const KEY = "ck-games-v1";

export type GamesSnapshot = { games: Game[]; storageOK: boolean };

// SSR/수화용 안정 참조 — 서버엔 localStorage 가 없으므로 늘 시드.
const serverSnapshot: GamesSnapshot = { games: seeds(), storageOK: true };

let snapshot: GamesSnapshot | null = null;
const listeners = new Set<() => void>();

function ensure(): GamesSnapshot {
  if (snapshot) return snapshot;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // 저장소 자체를 못 읽으면(시크릿 모드 등) 시드로 두고 경고를 켠다.
    snapshot = { games: seeds(), storageOK: false };
    return snapshot;
  }
  const { games, clear } = parseGames(raw);
  if (clear) {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // 지우기가 막혀도 화면은 시드로 정상 동작한다.
    }
  }
  snapshot = { games, storageOK: true };
  return snapshot;
}

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeGames(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getGamesSnapshot(): GamesSnapshot {
  return ensure();
}

export function getGamesServerSnapshot(): GamesSnapshot {
  return serverSnapshot;
}

/* 목록을 통째로 바꾸고 저장한다(add/delete/undo 가 다음 배열을 계산해 넘긴다). setItem 이
   실패하면 "이 브라우저에 저장돼요" 약속을 지킬 수 없으니 storageOK 를 내린다. */
export function commitGames(next: Game[]): void {
  let storageOK = ensure().storageOK;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    storageOK = false;
  }
  snapshot = { games: next, storageOK };
  emit();
}
