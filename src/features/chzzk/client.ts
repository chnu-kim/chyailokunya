/* 치지직 category API 클라이언트(ADR-0015). client_credentials 는 Client-Id/Client-Secret
   헤더로 받는다 — 별도 토큰 교환이 없다(실측: GET /open/v1/categories/search 가 헤더만으로
   200). 시크릿을 공개 트래픽에 노출하지 않도록 이 호출은 서버(features)에서만 하고, 공개
   읽기는 games 스냅샷만 읽는다. 반환은 GAME 카테고리만 정규화해 돌려준다. */

import { isGameCategory, type ChzzkCategory } from "@/core/games";

const BASE_URL = "https://openapi.chzzk.naver.com";

export type ChzzkCreds = { clientId: string; clientSecret: string };

// 응답 래퍼: { code, message, content: { data: [...] } }. 성공은 code === 200.
type SearchEnvelope = {
  code?: number;
  message?: string | null;
  content?: { data?: unknown[] } | null;
};

// size 는 1..50(스펙). 범위 밖은 조인다 — 잘못된 입력이 그대로 API 로 새지 않게.
function clampSize(size: number): number {
  if (!Number.isFinite(size)) return 20;
  return Math.min(50, Math.max(1, Math.trunc(size)));
}

// 신뢰하지 않는 외부 응답을 ChzzkCategory 로 강제한다. 필수 문자열이 없으면 null(호출측 필터).
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
  const url = new URL("/open/v1/categories/search", BASE_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("size", String(clampSize(size)));

  const res = await fetchImpl(url, {
    headers: { "Client-Id": creds.clientId, "Client-Secret": creds.clientSecret },
  });
  if (!res.ok) throw new Error(`치지직 category 검색 실패: HTTP ${res.status}`);

  const body = (await res.json()) as SearchEnvelope;
  if (body.code !== 200) {
    throw new Error(`치지직 category 검색 오류 ${body.code ?? "?"}: ${body.message ?? ""}`);
  }
  const rows = Array.isArray(body.content?.data) ? body.content.data : [];
  return rows.map(toCategory).filter((c): c is ChzzkCategory => c !== null && isGameCategory(c));
}
