import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/* 마이그레이션 0011 — 시각을 항목에서 하루로 옮긴다(이슈 #117, #56 결정 8 을 뒤집었다).

   **0008 과 증명할 명제가 다르다.** 0008 은 "화면이 안 바뀐다"를 증명했지만 여기선 화면이
   **의도적으로** 바뀐다(항목마다 있던 시각이 하루 하나로 접힌다). 그래서 증명 가능한 불변은
   더 좁다:

     모든 날짜에 대해, 이관 전 그날 항목들이 갖던 시각의 **최솟값** ≡ 이관 후 그날의 단일 시각.

   그리고 그 접힘이 **무손실인지**는 데이터가 정한다 — 하루에 서로 다른 시각이 둘 이상이면
   하나가 사라진다. 아래 마지막 테스트가 그 경계를 명시적으로 재서, 접힘이 일어나는 조건과
   결과를 코드로 남긴다(프로덕션 데이터에 그런 날이 있는지는 별도로 확인한다 — 이슈 #117).

   0007·0008 과 같은 이유로 e2e 에 산다(workerd 엔 fs·node:sqlite 가 없다). 트랜잭션 안에서
   재생하는 것도 같은 이유다 — 러너가 감쌀 때를 재현한다. 0007 의 FK 지뢰는 여기 없다:
   drizzle 이 테이블 재생성이 아니라 `ALTER TABLE … DROP COLUMN` 을 냈고(SQLite 3.35+),
   schedule_entries 를 참조하는 자식 테이블도 없다. */

const DRIZZLE_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

function migrationFiles(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function target(): string {
  const t = migrationFiles().find((f) => f.startsWith("0011"));
  expect(t, "0011 마이그레이션 파일이 있어야 한다").toBeTruthy();
  return t!;
}

/* 0011 직전까지의 스키마를 세우고 인자로 받은 항목을 심는다. 항목은 [날짜, 시각, 제목] 이다. */
function seed(entries: [string, string | null, string][]): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  const t = target();
  for (const f of migrationFiles().filter((f) => f < t)) {
    db.exec(readFileSync(join(DRIZZLE_DIR, f), "utf8"));
  }
  db.exec(`INSERT INTO games (id, category_id, category_type, category_value, cleared, cleared_date, created_at, last_updated_at) VALUES
    (1, 'c-elden', 'GAME', '엘든 링', 0, NULL, 1700000000000, 1700000000000);`);
  const values = entries
    .map(
      ([date, time, title], i) =>
        `('${date}', ${time === null ? "NULL" : `'${time}'`}, '${title}', 1, ${1784000000000 + i}, ${1784000000000 + i})`,
    )
    .join(",\n");
  db.exec(`INSERT INTO schedule_entries (scheduled_date, start_time, title, game_id, created_at, last_updated_at) VALUES
    ${values};`);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec("BEGIN;");
  db.exec(readFileSync(join(DRIZZLE_DIR, target()), "utf8"));
  db.exec("COMMIT;");
}

test("0011 이관: 그날 항목들의 시각이 하루의 시각 하나로 접힌다", () => {
  const db = seed([
    ["2026-07-27", "19:00", "월요일 방송"],
    ["2026-07-28", "20:00", "화요일 방송"],
    ["2026-07-30", null, "시각 미정 방송"],
    ["2026-05-13", null, "이관된 레거시 방송"], // 0007 이 played_at 에서 옮긴 항목은 시각이 없다
  ]);

  /* 이관 전 정답을 **쿼리로** 뽑아 둔다 — 손으로 적은 기대값과 대조하면 이관문과 같은 실수를
     두 번 할 수 있다(둘 다 MIN 을 잘못 이해하면 나란히 틀린다). 마이그레이션이 읽을 바로 그
     사실을 독립적으로 계산해 둔 뒤, 이관 결과가 그것과 같은지 본다. */
  const expected = db
    .prepare(
      `SELECT scheduled_date, MIN(start_time) AS start_time FROM schedule_entries
       WHERE start_time IS NOT NULL GROUP BY scheduled_date ORDER BY scheduled_date`,
    )
    .all();
  expect(expected).toEqual([
    { scheduled_date: "2026-07-27", start_time: "19:00" },
    { scheduled_date: "2026-07-28", start_time: "20:00" },
  ]);

  migrate(db);

  expect(
    db
      .prepare("SELECT scheduled_date, start_time FROM schedule_days ORDER BY scheduled_date")
      .all(),
  ).toEqual(expected);

  // 시각이 없던 날은 **행이 안 생긴다** — 행 없음 = 기본값(시각 미정·휴방 아님), schema.ts 주석.
  expect(
    db
      .prepare(
        "SELECT count(*) AS n FROM schedule_days WHERE scheduled_date IN ('2026-07-30', '2026-05-13')",
      )
      .get(),
  ).toEqual({ n: 0 });

  // 휴방은 이관이 만들지 않는다 — 옛 데이터엔 그 사실이 없었다(지어내면 안 된다).
  expect(db.prepare("SELECT count(*) AS n FROM schedule_days WHERE rest <> 0").get()).toEqual({
    n: 0,
  });

  // 항목은 한 줄도 안 잃는다. 컬럼만 빠진다.
  expect(db.prepare("SELECT count(*) AS n FROM schedule_entries").get()).toEqual({ n: 4 });
  expect(() => db.prepare("SELECT start_time FROM schedule_entries").all()).toThrow();

  db.close();
});

test("0011 이관문이 DROP COLUMN 보다 위에 있다 — 순서가 뒤집히면 읽을 컬럼이 없다", () => {
  /* 이 파일의 손편집이 살아 있는지 보는 자리다(0008 스펙과 같은 규율). 두 문장의 **순서**가
     계약이라, 파일을 읽어 그 순서를 직접 확인하고 뒤집힌 판이 실제로 죽는지도 재생한다 —
     "위에 둬야 한다"를 주석으로만 남기면 다음 사람이 정렬하다 조용히 깨뜨린다. */
  const sql = readFileSync(join(DRIZZLE_DIR, target()), "utf8");
  const insertAt = sql.indexOf("INSERT INTO `schedule_days`");
  /* 실제 문장으로 찾는다 — 그냥 "DROP COLUMN" 으로 찾으면 그 위 주석에 적힌 같은 낱말을
     먼저 집어 순서가 늘 뒤집혀 보인다(첫 판이 그렇게 빨갰다). 테스트가 보는 대상은 문서가
     아니라 실행될 SQL 이어야 한다. */
  const dropAt = sql.indexOf("ALTER TABLE `schedule_entries` DROP COLUMN");
  expect(insertAt, "이관 INSERT 가 있어야 한다").toBeGreaterThan(-1);
  expect(dropAt, "DROP COLUMN 이 있어야 한다").toBeGreaterThan(-1);
  expect(insertAt, "이관은 DROP COLUMN 보다 위여야 한다").toBeLessThan(dropAt);

  // 뒤집으면 죽는다 — 이 단언이 위 순서 검사에 이빨을 준다.
  const statements = sql.split("--> statement-breakpoint");
  const swapped = [...statements.slice(0, -2), statements.at(-1)!, statements.at(-2)!].join(";\n");
  const db = seed([["2026-07-27", "19:00", "월요일 방송"]]);
  expect(() => db.exec(swapped)).toThrow();
  db.close();
});

test("0011 이관: 하루에 시각이 여럿이면 가장 이른 것만 남는다 — 접힘의 경계", () => {
  /* MIN 이 무손실인 것은 하루에 서로 다른 시각이 둘 이상인 날이 **없을 때뿐**이다. 그런 날이
     있으면 어떻게 되는지를 여기서 명시적으로 재 둔다 — 이슈 #117 결정 6 이 받아들인 결과이고,
     나중에 누가 "이관이 값을 지웠다"를 만났을 때 의도된 동작임을 이 테스트가 말해 준다. */
  const db = seed([
    ["2026-07-27", "22:00", "밤 게임"],
    ["2026-07-27", "19:00", "오후 저챗"],
  ]);
  migrate(db);

  expect(db.prepare("SELECT scheduled_date, start_time FROM schedule_days").all()).toEqual([
    { scheduled_date: "2026-07-27", start_time: "19:00" },
  ]);

  // 항목 둘은 그대로 남는다 — 사라지는 건 시각 하나지 편성이 아니다.
  expect(db.prepare("SELECT count(*) AS n FROM schedule_entries").get()).toEqual({ n: 2 });

  db.close();
});
