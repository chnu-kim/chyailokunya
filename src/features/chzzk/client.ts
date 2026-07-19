/* 치지직 category API 클라이언트(ADR-0015). client_credentials 는 Client-Id/Client-Secret
   헤더로 받는다 — 별도 토큰 교환이 없다(실측: GET /open/v1/categories/search 가 헤더만으로
   200). 공통 어댑터(features/chzzk-http.ts)를 auth 의 사용자 OAuth 와 함께 쓴다. 시크릿을
   공개 트래픽에 노출하지 않도록 이 호출은 서버(features)에서만 하고, 공개 읽기는 games
   스냅샷만 읽는다. 반환은 GAME 카테고리만 정규화해 돌려준다. */

import { isGameCategory, type ChzzkCategory } from "@/core/games";
import { asRecord, callChzzkApi, chzzkUrl, type ChzzkCreds } from "@/features/chzzk-http";

export type { ChzzkCreds };

// size 는 1..50(스펙). 범위 밖은 조인다 — 잘못된 입력이 그대로 API 로 새지 않게.
function clampSize(size: number): number {
  if (!Number.isFinite(size)) return 20;
  return Math.min(50, Math.max(1, Math.trunc(size)));
}

/* 신뢰하지 않는 외부 응답을 ChzzkCategory 로 강제한다. 필수 문자열이 없으면 null(호출측 필터).
   여기 poster 의 빈 문자열→null 은 검색 결과 표시용 타입 정리일 뿐 저장 정규화가 아니다 —
   저장 시 정규화(trim·empty→null·상한·스킴 검증)의 정본은 features/games/schema.ts::addGameInput
   하나다. 이 함수가 반환한 값도 사용자가 고르면 결국 그 경계를 다시 통과한다. */
function toCategory(raw: unknown): ChzzkCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const categoryType = typeof r.categoryType === "string" ? r.categoryType : "";
  const categoryId = typeof r.categoryId === "string" ? r.categoryId : "";
  const categoryValue = typeof r.categoryValue === "string" ? r.categoryValue : "";
  if (!categoryType || !categoryId || !categoryValue) return null;
  const poster = typeof r.posterImageUrl === "string" ? r.posterImageUrl : "";
  return { categoryType, categoryId, categoryValue, posterImageUrl: poster || null };
}

/* 카테고리 검색. fetchImpl 은 테스트에서 주입한다(런타임 기본은 전역 fetch) — 실제 네트워크
   없이 매핑·GAME 필터·에러 경로를 단위테스트한다. GAME 만 남긴다(보드는 GAME 만). */
export async function searchCategories(
  creds: ChzzkCreds,
  query: string,
  size = 20,
  fetchImpl: typeof fetch = fetch,
): Promise<ChzzkCategory[]> {
  const content = await callChzzkApi(
    chzzkUrl("/open/v1/categories/search", { query, size: String(clampSize(size)) }),
    { headers: { "Client-Id": creds.clientId, "Client-Secret": creds.clientSecret } },
    "category 검색",
    fetchImpl,
  );

  // content 모양은 { data?: unknown[] } — asRecord 로 좁힌 뒤 Array.isArray 로 배열만 남긴다.
  const rows = asRecord(content).data;
  return (Array.isArray(rows) ? rows : [])
    .map(toCategory)
    .filter((c): c is ChzzkCategory => c !== null && isGameCategory(c));
}
