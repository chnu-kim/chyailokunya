/* 게임 보드 시드(ADR-0014·0015). 8개 게임명을 치지직 category API 로 categoryId 해결해 games
   에 넣는다. 구조=마이그레이션, 내용=이 스크립트(테스트 DB 엔 안 섞인다). 1회성이라 재배포로
   되살아나지 않고, category_id UNIQUE + INSERT OR IGNORE 라 재실행에도 중복이 안 생긴다.

   실행(1Password Environment chyailokunya-prod 의 값 필요):
     CHZZK_CLIENT_ID=… CHZZK_CLIENT_SECRET=… node scripts/seed.mjs --local    # dev(로컬 D1)
     CHZZK_CLIENT_ID=… CHZZK_CLIENT_SECRET=… CLOUDFLARE_API_TOKEN=… \
       CLOUDFLARE_ACCOUNT_ID=… node scripts/seed.mjs --remote                  # 컷오버(원격 D1)

   검색 매핑은 src/features/chzzk/client.ts 를 그대로 옮긴 것 — 스크립트라 @/ 별칭·번들러 없이
   node 로 바로 돌게 인라인했다(의존 최소). node 22+ 의 전역 fetch 를 쓴다. */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE_URL = "https://openapi.chzzk.naver.com";

/* 이름 → 플레이/클리어 날짜. status 컬럼은 드롭됐다 — 이제 날짜 두 개가 상태의 정본이고
   "클리어"는 cleared_at 이 있다는 뜻이다. 날짜를 모르는 시드는 둘 다 null 로 둔다(보드에선
   날짜 줄 없이 뜬다). 치지직 GAME 카테고리에 없는 이름은 검색이 비어 제외된다
   (ADR-0015: 예 "마이 보이스 주"·"겟 투 워크"). */
const SEED = [
  { q: "마인크래프트", playedAt: "2026-07-12", clearedAt: null },
  { q: "리그 오브 레전드", playedAt: "2026-07-05", clearedAt: null },
  { q: "레이튼 교수와 이상한 마을", playedAt: "2026-05-02", clearedAt: "2026-05-19" },
  { q: "레이튼 교수와 악마의 상자", playedAt: "2026-06-08", clearedAt: null },
  { q: "리틀 나이트메어", playedAt: "2026-04-11", clearedAt: "2026-04-14" },
  { q: "엘든 링", playedAt: "2026-03-01", clearedAt: null },
  { q: "마이 보이스 주", playedAt: null, clearedAt: null },
  { q: "겟 투 워크", playedAt: null, clearedAt: null },
];

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const clientId = process.env.CHZZK_CLIENT_ID;
const clientSecret = process.env.CHZZK_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("CHZZK_CLIENT_ID/CHZZK_CLIENT_SECRET 가 필요합니다(1Password Environment).");
  process.exit(1);
}

async function searchGame(query) {
  const url = new URL("/open/v1/categories/search", BASE_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("size", "10");
  const res = await fetch(url, {
    headers: { "Client-Id": clientId, "Client-Secret": clientSecret },
  });
  if (!res.ok) throw new Error(`검색 실패 ${query}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.code !== 200) throw new Error(`검색 오류 ${query}: ${body.code} ${body.message ?? ""}`);
  const rows = Array.isArray(body?.content?.data) ? body.content.data : [];
  const games = rows.filter((r) => r?.categoryType === "GAME");
  // 정확 일치를 우선, 없으면 첫 GAME 결과.
  return games.find((r) => r.categoryValue === query) ?? games[0] ?? null;
}

function sqlStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const now = Date.now();
const values = [];
for (const { q, playedAt, clearedAt } of SEED) {
  const cat = await searchGame(q);
  if (!cat) {
    console.warn(`제외(치지직 GAME 카테고리 없음): ${q}`);
    continue;
  }
  const poster = cat.posterImageUrl ? sqlStr(cat.posterImageUrl) : "NULL";
  const played = playedAt ? sqlStr(playedAt) : "NULL";
  const cleared = clearedAt ? sqlStr(clearedAt) : "NULL";
  values.push(
    `(${sqlStr(cat.categoryId)}, 'GAME', ${sqlStr(cat.categoryValue)}, ${poster}, ${played}, ${cleared}, ${now}, ${now})`,
  );
  console.log(`해결: ${q} → ${cat.categoryValue} (${cat.categoryId})`);
}

if (values.length === 0) {
  console.error("해결된 게임이 없습니다.");
  process.exit(1);
}

const sql =
  "INSERT OR IGNORE INTO games\n" +
  "  (category_id, category_type, category_value, poster_image_url, played_at, cleared_at, created_at, last_updated_at)\n" +
  "VALUES\n  " +
  values.join(",\n  ") +
  ";\n";

const tmp = join(tmpdir(), `ck-seed-${now}.sql`);
writeFileSync(tmp, sql);
console.log(`\n${values.length}개 삽입 → wrangler d1 execute ${target}`);
execFileSync("npx", ["wrangler", "d1", "execute", "chyailokunya", target, "--file", tmp, "--yes"], {
  stdio: "inherit",
});
