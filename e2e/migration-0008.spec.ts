import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/* 마이그레이션 0008 — 주 메타에 draft 축을 더한다(이슈 #64 · ADR-0022). 두 가지를 못박는다:

   1. **이관문이 실제로 돈다.** drizzle-kit 이 낸 초판은 테이블을 재생성하면서
      `SELECT ... "draft" ... FROM schedule_weeks` 로 **아직 없는 컬럼**을 읽으려 했다 —
      그대로 두면 배포에서 마이그레이션이 죽는다. 손으로 CASE 이관문을 넣었고, 이 테스트가
      그 손편집이 살아 있는지 본다(되돌리면 exec 가 던진다).

   2. **화면이 안 바뀐다.** 기존 행의 draft 를 published_at 에서 유도하므로, 보드가 세는 항목이
      마이그레이션 전후로 같아야 한다. 옛 규칙(메타 없음 OR 발행됨)과 새 규칙(초안 아님)을 각각
      전/후에 돌려 **같은 집합**이 나오는지 직접 대조한다 — "보존한다"는 주장을 문장이 아니라
      쿼리로 증명하는 자리다.

   0007 과 같은 이유로 e2e 에 산다(workerd 엔 fs·node:sqlite 가 없다). 트랜잭션 안에서 재생하는
   것도 같은 이유다 — 러너가 감쌀 때를 재현한다. 0007 의 FK 지뢰 자체는 여기 없다:
   schedule_weeks 를 참조하는 자식 테이블이 없어 DROP 이 SET NULL 을 발동시킬 대상이 없다. */

const DRIZZLE_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

function migrationFiles(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/* 보드가 세는 항목 — 옛 규칙. LEFT JOIN 미스(메타 없음)이거나 발행된 주. */
const COUNTED_BEFORE = `
  SELECT e.scheduled_date FROM schedule_entries e
  LEFT JOIN schedule_weeks w
    ON w.week_start_date = date(e.scheduled_date, '-' || ((strftime('%w', e.scheduled_date) + 6) % 7) || ' days')
  WHERE w.week_start_date IS NULL OR w.published_at IS NOT NULL
  ORDER BY e.scheduled_date`;

/* 같은 질문 — 새 규칙. 초안이 아닌 주의 항목(메타 없음은 coalesce 로 기본값 0 과 합류). */
const COUNTED_AFTER = `
  SELECT e.scheduled_date FROM schedule_entries e
  LEFT JOIN schedule_weeks w
    ON w.week_start_date = date(e.scheduled_date, '-' || ((strftime('%w', e.scheduled_date) + 6) % 7) || ' days')
  WHERE coalesce(w.draft, 0) = 0
  ORDER BY e.scheduled_date`;

test("0008 이관: draft 를 유도해도 보드가 세는 항목이 그대로다", () => {
  const files = migrationFiles();
  const target = files.find((f) => f.startsWith("0008"));
  expect(target, "0008 마이그레이션 파일이 있어야 한다").toBeTruthy();

  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  for (const f of files.filter((f) => f < target!)) {
    db.exec(readFileSync(join(DRIZZLE_DIR, f), "utf8"));
  }

  /* 프로덕션이 가질 수 있는 네 모양을 다 넣는다: 발행된 주 · 초안 주 · 게임 폼이 청구해
     발행된 채 선 주(이슈 #64 가 만든 상태) · 메타가 아예 없는 레거시 주. */
  db.exec(`INSERT INTO games (id, category_id, category_type, category_value, cleared, cleared_date, created_at, last_updated_at) VALUES
    (1, 'c-elden', 'GAME', '엘든 링', 0, NULL, 1700000000000, 1700000000000);`);
  db.exec(`INSERT INTO schedule_weeks (week_start_date, note, published_at, created_at, last_updated_at) VALUES
    ('2026-07-20', '이번 주 공지', 1784000000000, 1784000000000, 1784000000000),
    ('2026-07-27', NULL,          NULL,          1784000001000, 1784000001000),
    ('2026-08-03', NULL,          1784000002000, 1784000002000, 1784000002000);`);
  db.exec(`INSERT INTO schedule_entries (scheduled_date, start_time, title, game_id, created_at, last_updated_at) VALUES
    ('2026-07-22', '20:00', '발행된 주 방송',  1, 1784000000000, 1784000000000),
    ('2026-07-29', '21:00', '초안 주 방송',    1, 1784000001000, 1784000001000),
    ('2026-08-05', NULL,    '폼이 넣은 날짜',  1, 1784000002000, 1784000002000),
    ('2026-05-13', '20:00', '레거시 방송',     1, 1784000003000, 1784000003000);`);

  const countedBefore = db.prepare(COUNTED_BEFORE).all();
  // 초안 주(07-29)만 빠진 상태가 마이그레이션 이전의 정답이다.
  expect(countedBefore).toEqual([
    { scheduled_date: "2026-05-13" },
    { scheduled_date: "2026-07-22" },
    { scheduled_date: "2026-08-05" },
  ]);

  db.exec("BEGIN;");
  db.exec(readFileSync(join(DRIZZLE_DIR, target!), "utf8"));
  db.exec("COMMIT;");

  // 같은 질문, 새 규칙 — 집합이 한 줄도 안 달라진다.
  expect(db.prepare(COUNTED_AFTER).all()).toEqual(countedBefore);

  // draft 유도: 미발행 주만 초안이고, 발행 시각과 공지는 그대로 보존된다.
  expect(
    db
      .prepare(
        "SELECT week_start_date, note, draft, published_at FROM schedule_weeks ORDER BY week_start_date",
      )
      .all(),
  ).toEqual([
    { week_start_date: "2026-07-20", note: "이번 주 공지", draft: 0, published_at: 1784000000000 },
    { week_start_date: "2026-07-27", note: null, draft: 1, published_at: null },
    { week_start_date: "2026-08-03", note: null, draft: 0, published_at: 1784000002000 },
  ]);

  // 레거시 주는 메타 행이 없던 그대로다 — 없던 발행 사건을 지어내지 않는다(ADR-0022).
  expect(
    db
      .prepare("SELECT count(*) AS n FROM schedule_weeks WHERE week_start_date = '2026-05-11'")
      .get(),
  ).toEqual({ n: 0 });

  // 항목은 한 줄도 안 잃는다(재생성 대상이 아니지만, 이관이 옆 테이블을 건드리지 않았음을 못박는다).
  expect(db.prepare("SELECT count(*) AS n FROM schedule_entries").get()).toEqual({ n: 4 });

  // CHECK 가 서 있다 — 짜는 중인데 공개된 주는 DB 가 거절한다.
  expect(() =>
    db.exec(
      `INSERT INTO schedule_weeks (week_start_date, draft, published_at, created_at, last_updated_at)
       VALUES ('2026-09-07', 1, 1784000004000, 1784000004000, 1784000004000);`,
    ),
  ).toThrow();

  // 임시 이관 테이블은 남지 않는다(0007 스펙과 같은 규율).
  const leftover = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND substr(name, 1, 2) = '__'")
    .all();
  expect(leftover).toEqual([]);

  db.close();
});
