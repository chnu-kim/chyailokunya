/* 치지직 open API 공통 어댑터. auth 의 사용자 OAuth(exchangeCodeForTokens·fetchChzzkUser,
   ADR-0006)와 chzzk 의 category 검색(searchCategories, ADR-0015)이 같은 origin·envelope·
   오류 문구·narrowing 헬퍼·creds 조립을 병렬로 구현하던 걸 여기 하나로 모았다. 두 도메인
   함수는 이 위에서 매핑만 하고, fetchImpl 주입 seam 은 그대로 이 층으로 옮겨왔다 — 실제
   네트워크 없이 테스트가 여기 하나만 목하면 된다. */

const BASE_URL = "https://openapi.chzzk.naver.com";

export type ChzzkCreds = { clientId: string; clientSecret: string };

// 응답 래퍼: { code, message, content }. 성공은 code === 200. content 모양은 엔드포인트마다
// 달라(레코드 vs {data:[...]}) unknown 으로 열어 두고, 각 도메인 함수가 asRecord 로 좁힌다.
type Envelope = { code?: number; message?: string | null; content?: unknown };

// path 는 BASE_URL 기준 상대경로. query 는 있으면 URLSearchParams 로 붙인다(category 검색의
// query·size 처럼) — 조립 위치를 한 곳으로 모아 URL 문자열 이어붙이기 실수를 없앤다.
export function chzzkUrl(path: string, query?: Record<string, string>): URL {
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }
  return url;
}

// 신뢰하지 않는 응답 content 를 안전하게 열기 위한 좁힘(객체 아니면 빈 레코드).
export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// env 의 두 값이 모두 있어야 유효한 creds — 하나만 있으면 null. 콜백 라우트·trpc 컨텍스트·
// chzzk 라우터 3곳이 각자 이 null-guard 를 반복하던 걸 여기로 모았다.
export function credsFromEnv(
  clientId: string | undefined,
  clientSecret: string | undefined,
): ChzzkCreds | null {
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/* 치지직 open API 호출 공통부: fetch → HTTP 상태 확인 → envelope 언랩 → code!==200 검사.
   label 은 오류 문구에 박히는 한국어 동작명("토큰 교환"·"사용자 조회"·"category 검색") —
   실패 지점을 사용자·로그 양쪽에서 구분할 수 있게 문구 자체는 호출부가 아니라 여기서 짓는다.
   fetchImpl 은 테스트에서 주입한다(런타임 기본은 전역 fetch) — 실제 네트워크 없이 매핑·
   에러 경로를 단위테스트한다. 성공 시 content(unknown)를 그대로 돌려주고 좁힘은 호출부 몫. */
export async function callChzzkApi(
  url: URL,
  init: RequestInit,
  label: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const res = await fetchImpl(url, init);
  if (!res.ok) throw new Error(`치지직 ${label} 실패: HTTP ${res.status}`);

  const body = (await res.json()) as Envelope;
  if (body.code !== 200) {
    throw new Error(`치지직 ${label} 오류 ${body.code ?? "?"}: ${body.message ?? ""}`);
  }
  return body.content;
}
