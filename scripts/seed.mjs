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

/* 이름 → 플레이 날짜 · 클리어 날짜. 플레이 날짜의 정본은 이제 일정(schedule_entries)이고
   보드는 그 항목의 MAX(scheduled_date)로 유도한다(이슈 #56 결정 3). 그래서 playedAt 은
   games 컬럼이 아니라 게임에 걸린 일정 항목으로 심는다. 클리어는 게임 자체의 사실이라 games 에
   남는다 — clearedAt 이 있으면 cleared=1·cleared_date=그 날짜, 없으면 cleared=0(안 깼거나 미정).
   playedAt 이 null 인 시드는 일정 항목 없이 게임만 선다(보드에선 날짜 줄 없이 뒤로). 치지직
   GAME 카테고리에 없는 이름은 검색이 비어 제외된다(ADR-0015: 예 "마이 보이스 주"·"겟 투 워크"). */
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
// 플레이 날짜는 일정 항목으로 심는다. category_id 로 방금 넣은 게임 행에 이어 붙이고, 같은
// (게임, 날짜) 항목이 이미 있으면 건너뛴다 — 재실행에도 중복 항목이 안 생긴다(games 의
// INSERT OR IGNORE 와 짝이 맞는 멱등성).
const scheduleStmts = [];
for (const { q, playedAt, clearedAt } of SEED) {
  const cat = await searchGame(q);
  if (!cat) {
    console.warn(`제외(치지직 GAME 카테고리 없음): ${q}`);
    continue;
  }
  const poster = cat.posterImageUrl ? sqlStr(cat.posterImageUrl) : "NULL";
  const cleared = clearedAt ? "1" : "0";
  const clearedDate = clearedAt ? sqlStr(clearedAt) : "NULL";
  values.push(
    `(${sqlStr(cat.categoryId)}, 'GAME', ${sqlStr(cat.categoryValue)}, ${poster}, ${cleared}, ${clearedDate}, ${now}, ${now})`,
  );
  if (playedAt) {
    const catId = sqlStr(cat.categoryId);
    const date = sqlStr(playedAt);
    scheduleStmts.push(
      "INSERT INTO schedule_entries (scheduled_date, start_time, title, game_id, created_at, last_updated_at)\n" +
        `SELECT ${date}, NULL, category_value, id, ${now}, ${now} FROM games\n` +
        `WHERE category_id = ${catId}\n` +
        "  AND NOT EXISTS (SELECT 1 FROM schedule_entries se " +
        `WHERE se.game_id = games.id AND se.scheduled_date = ${date});`,
    );
  }
  console.log(`해결: ${q} → ${cat.categoryValue} (${cat.categoryId})`);
}

if (values.length === 0) {
  console.error("해결된 게임이 없습니다.");
  process.exit(1);
}

const sql =
  "INSERT OR IGNORE INTO games\n" +
  "  (category_id, category_type, category_value, poster_image_url, cleared, cleared_date, created_at, last_updated_at)\n" +
  "VALUES\n  " +
  values.join(",\n  ") +
  ";\n" +
  scheduleStmts.join("\n") +
  "\n";

const tmp = join(tmpdir(), `ck-seed-${now}.sql`);
writeFileSync(tmp, sql);
console.log(`\n${values.length}개 삽입 → wrangler d1 execute ${target}`);
execFileSync("npx", ["wrangler", "d1", "execute", "chyailokunya", target, "--file", tmp, "--yes"], {
  stdio: "inherit",
});
