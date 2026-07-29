import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/* 마이그레이션 0012 — 주 메타에 팬아트 두 칸을 더한다(이슈 #117).

   **0008 과 정확히 같은 자리다.** drizzle-kit 이 CHECK 추가 때문에 테이블을 재생성하면서
   `INSERT … SELECT "fanart_image_url", "fanart_credit" … FROM schedule_weeks` 를 냈는데, 그
   시점 옛 테이블엔 그 컬럼이 **아직 없어서** `no such column` 으로 죽는다. 손으로 NULL 을
   채웠고, 이 테스트가 그 손편집이 살아 있는지 본다(되돌리면 exec 가 던진다).

   그리고 이관이 **기존 주를 하나도 안 바꾸는지** 본다 — 팬아트는 이 기능 이전에 존재하지
   않았으므로 모든 옛 행이 NULL 두 칸을 얻고 나머지는 그대로여야 한다.

   0007·0008·0011 과 같은 이유로 e2e 에 산다(workerd 엔 fs·node:sqlite 가 없다). 트랜잭션 안에서
   재생하는 것도 같은 이유다 — 러너가 감쌀 때를 재현한다. */

const DRIZZLE_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

function migrationFiles(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function target(): string {
  const t = migrationFiles().find((f) => f.startsWith("0012"));
  expect(t, "0012 마이그레이션 파일이 있어야 한다").toBeTruthy();
  return t!;
}

function seed(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  const t = target();
  for (const f of migrationFiles().filter((f) => f < t)) {
    db.exec(readFileSync(join(DRIZZLE_DIR, f), "utf8"));
  }
  /* 프로덕션이 가질 수 있는 세 모양: 발행된 주 · 초안 주 · 공지만 있는 주. 재생성이 이 셋을
     그대로 옮기는지가 이 테스트의 두 번째 질문이다. */
  db.exec(`INSERT INTO schedule_weeks (week_start_date, note, draft, published_at, created_at, last_updated_at) VALUES
    ('2026-07-20', '이번 주 공지', 0, 1784000000000, 1784000000000, 1784000000000),
    ('2026-07-27', NULL,          1, NULL,          1784000001000, 1784000001000),
    ('2026-08-03', '공지만',      0, NULL,          1784000002000, 1784000002000);`);
  return db;
}

test("0012 이관: 기존 주가 그대로 살고 팬아트 두 칸이 NULL 로 붙는다", () => {
  const db = seed();
  const before = db
    .prepare(
      "SELECT week_start_date, note, draft, published_at, created_at, last_updated_at FROM schedule_weeks ORDER BY week_start_date",
    )
    .all();

  db.exec("BEGIN;");
  db.exec(readFileSync(join(DRIZZLE_DIR, target()), "utf8"));
  db.exec("COMMIT;");

  // 기존 칸은 한 글자도 안 바뀐다 — 재생성이 값을 옮기기만 했는지 직접 대조한다.
  expect(
    db
      .prepare(
        "SELECT week_start_date, note, draft, published_at, created_at, last_updated_at FROM schedule_weeks ORDER BY week_start_date",
      )
      .all(),
  ).toEqual(before);

  // 새 칸은 전부 NULL — 없던 팬아트를 지어내지 않는다.
  expect(
    db
      .prepare(
        "SELECT count(*) AS n FROM schedule_weeks WHERE fanart_image_url IS NOT NULL OR fanart_credit IS NOT NULL",
      )
      .get(),
  ).toEqual({ n: 0 });

  // 임시 이관 테이블은 안 남는다(0007·0008 스펙과 같은 규율).
  expect(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND substr(name, 1, 2) = '__'")
      .all(),
  ).toEqual([]);

  db.close();
});

test("0012: 작가 표기만 있고 그림이 없는 조합을 DB 가 거절한다", () => {
  /* 그 조합은 화면에 아무것도 안 뜨는데 값만 남아, 다음 사람이 "왜 안 보이지"를 데이터에서
     찾게 된다. 반대(그림만 있고 표기 없음)는 정상이라 함께 못박는다 — 작가를 모르거나 본인이
     그린 경우가 있다. */
  const db = seed();
  db.exec("BEGIN;");
  db.exec(readFileSync(join(DRIZZLE_DIR, target()), "utf8"));
  db.exec("COMMIT;");

  expect(() =>
    db.exec(
      `INSERT INTO schedule_weeks (week_start_date, fanart_credit, created_at, last_updated_at)
       VALUES ('2026-09-07', '누군가', 1784000004000, 1784000004000);`,
    ),
  ).toThrow();

  db.exec(
    `INSERT INTO schedule_weeks (week_start_date, fanart_image_url, created_at, last_updated_at)
     VALUES ('2026-09-14', 'https://example.com/a.png', 1784000005000, 1784000005000);`,
  );
  expect(
    db
      .prepare("SELECT fanart_credit FROM schedule_weeks WHERE week_start_date = '2026-09-14'")
      .get(),
  ).toEqual({ fanart_credit: null });

  db.close();
});
