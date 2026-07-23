import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/* 마이그레이션 0007 의 **데이터 이관**을 트랜잭션 안에서 재생해 못박는다(이슈 #56).
   0007 은 games 를 재생성하면서(SQLite 는 컬럼 드롭이 없다) 옛 played_at 을 schedule_entries
   항목으로 옮긴다 — 그 항목의 game_id 가 살아 있어야 보드가 MAX(scheduled_date)로 과거 플레이
   날짜를 되유도한다(결정 16 "손실 0").

   **왜 굳이 트랜잭션 안에서 재생하나.** 초판은 schedule_entries 를 먼저 채운 뒤 games 를 드롭했고
   `PRAGMA foreign_keys=OFF` 로 ON DELETE SET NULL 을 막으려 했다. 그 pragma 는 pending BEGIN 이
   있으면 **무시된다**(SQLite 명세) — 마이그레이션을 트랜잭션으로 감싸는 러너에서는 드롭이
   SET NULL 을 발동시켜 방금 이관한 game_id 가 전부 NULL 이 된다. 자동커밋(스크래치 sqlite CLI)
   에서는 pragma 가 먹어 통과하므로, **검증을 자동커밋으로만 하면 이 결함이 안 보인다**
   (실측: 자동커밋 game_id=1 · 트랜잭션 game_id=NULL). 그래서 여기서는 적대적인 쪽,
   즉 트랜잭션 안에서 돌린다. 순서를 초판으로 되돌리면 이 테스트가 빨개진다(음성 대조 실행함).

   **왜 unit 이 아니라 e2e 인가.** 단위 테스트는 workerd 안에서 돌아 `fs` 도 `node:sqlite` 도
   없다 — 마이그레이션 파일을 읽어 재생할 수가 없다. Playwright 스펙은 Node 라 가능하다
   (routes.spec.ts 와 같은 근거로 브라우저를 안 쓰는 스펙이 여기 산다). CI 도 Node 26 이라
   node:sqlite 가 그대로 있다. */

const DRIZZLE_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

function migrationFiles(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

test("0007 이관: 트랜잭션 안에서 돌려도 항목의 game_id 가 살아남는다", () => {
  const files = migrationFiles();
  const target = files.find((f) => f.startsWith("0007"));
  expect(target, "0007 마이그레이션 파일이 있어야 한다").toBeTruthy();

  const db = new DatabaseSync(":memory:");
  // D1 은 FK 를 켜고 돈다 — 끄고 재생하면 이 테스트가 검증하려는 위험 자체가 사라진다.
  db.exec("PRAGMA foreign_keys=ON;");

  // 0007 **이전** 상태까지 세운다(자동커밋). 여기까지가 프로덕션 D1 의 현재 모습이다.
  for (const f of files.filter((f) => f < target!)) {
    db.exec(readFileSync(join(DRIZZLE_DIR, f), "utf8"));
  }

  // 이관 대상 실데이터: 플레이한 적 있고 깬 적도 있는 게임 + 플레이만 한 게임 + 아무것도 없는 게임.
  db.exec(`INSERT INTO games (id, category_id, category_type, category_value, poster_image_url, played_at, cleared_at, created_at, last_updated_at) VALUES
    (1, 'c-elden',  'GAME', '엘든 링',      NULL, '2026-03-01', NULL,         1700000000000, 1700000000000),
    (2, 'c-little', 'GAME', '리틀 나이트메어', NULL, '2026-04-11', '2026-04-14', 1700000001000, 1700000001000),
    (3, 'c-none',   'GAME', '안 한 게임',    NULL, NULL,         NULL,         1700000002000, 1700000002000);`);

  // 러너가 트랜잭션으로 감쌀 때를 재현한다 — pragma 로 FK 를 못 끄는 바로 그 조건.
  db.exec("BEGIN;");
  db.exec(readFileSync(join(DRIZZLE_DIR, target!), "utf8"));
  db.exec("COMMIT;");

  // 이관: played_at 있는 둘만 항목이 되고, **game_id 가 살아 있어야 한다**(여기가 회귀 지점).
  const entries = db
    .prepare(
      "SELECT scheduled_date, start_time, title, game_id FROM schedule_entries ORDER BY game_id",
    )
    .all();
  expect(entries).toEqual([
    { scheduled_date: "2026-03-01", start_time: null, title: "엘든 링", game_id: 1 },
    { scheduled_date: "2026-04-11", start_time: null, title: "리틀 나이트메어", game_id: 2 },
  ]);

  // 클리어 매핑: cleared_at 있으면 플래그 1 + 날짜 보존, 없으면 0 + null(CHECK 를 만족한다).
  const games = db.prepare("SELECT id, cleared, cleared_date FROM games ORDER BY id").all();
  expect(games).toEqual([
    { id: 1, cleared: 0, cleared_date: null },
    { id: 2, cleared: 1, cleared_date: "2026-04-14" },
    { id: 3, cleared: 0, cleared_date: null },
  ]);

  /* 임시 이관 테이블은 남지 않는다(마이그레이션이 자기 뒤를 치운다). LIKE 를 안 쓰는 이유가
     있다 — LIKE 에서 `_` 는 단일 문자 와일드카드라 '__%' 는 두 글자 이상인 **모든** 이름에
     걸린다(실측: games·schedule_weeks 까지 잡혔다). substr 로 접두사를 곧이곧대로 본다. */
  const leftover = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND substr(name, 1, 2) = '__'")
    .all();
  expect(leftover).toEqual([]);

  db.close();
});
