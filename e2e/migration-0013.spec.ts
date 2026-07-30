import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/* 마이그레이션 0013 — 팬아트에 픽셀 치수 두 칸을 더한다(읽기 화면의 자리 예약, ADR-0028).

   **0008·0012 와 같은 자리다.** drizzle-kit 이 CHECK 추가 때문에 테이블을 재생성하며
   `INSERT … SELECT "fanart_image_width", "fanart_image_height" … FROM schedule_weeks` 를 냈는데
   그 시점 옛 테이블엔 그 둘이 아직 없어 `no such column` 으로 죽는다. 손으로 NULL 을 채웠고,
   이 테스트가 그 손편집이 살아 있는지 본다(되돌리면 migrate 가 던진다).

   **0012 스펙과 다른 질문 하나:** 이번 이관은 이미 걸려 있는 **팬아트를 옮긴다.** 0012 때는
   팬아트 자체가 존재하지 않아 "새 칸이 전부 NULL"이면 끝이었지만, 여기서는 키·표기가 그대로
   살아야 하고 치수만 NULL 이어야 한다 — 새 컬럼 자리를 손으로 채우다 **엉뚱한 칸까지 NULL 로
   덮는** 실수가 정확히 이 대조에서 걸린다(그 실수는 단위 테스트가 못 본다).

   0007·0008·0011·0012 와 같은 이유로 e2e 에 산다(workerd 엔 fs·node:sqlite 가 없다). 트랜잭션
   안에서 재생하는 것도 같은 이유다 — 러너가 감쌀 때를 재현한다. */

const DRIZZLE_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));
const KEY = "0189d1f0-3a4b-7c8d-9e0f-1a2b3c4d5e6f.png";

function migrationFiles(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function target(): string {
  const t = migrationFiles().find((f) => f.startsWith("0013"));
  expect(t, "0013 마이그레이션 파일이 있어야 한다").toBeTruthy();
  return t!;
}

function seed(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  const t = target();
  for (const f of migrationFiles().filter((f) => f < t)) {
    db.exec(readFileSync(join(DRIZZLE_DIR, f), "utf8"));
  }
  /* 0012 의 세 모양 + **팬아트가 걸린 주 두 개**(표기 있는 것과 없는 것). 뒤 둘이 이 스펙의
     고유한 질문을 만든다 — 치수만 NULL 로 붙고 키·표기는 그대로 살아야 한다. */
  db.exec(`INSERT INTO schedule_weeks (week_start_date, note, draft, published_at, fanart_image_key, fanart_credit, created_at, last_updated_at) VALUES
    ('2026-07-20', '이번 주 공지', 0, 1784000000000, NULL,   NULL,       1784000000000, 1784000000000),
    ('2026-07-27', NULL,          1, NULL,          NULL,   NULL,       1784000001000, 1784000001000),
    ('2026-08-03', '공지만',      0, NULL,          NULL,   NULL,       1784000002000, 1784000002000),
    ('2026-08-10', NULL,          0, 1784000003000, '${KEY}', '그린 사람', 1784000003000, 1784000003000),
    ('2026-08-17', NULL,          1, NULL,          '${KEY}', NULL,       1784000004000, 1784000004000);`);
  return db;
}

/* 팬아트 두 칸을 **대조에 포함한다** — 여기 빼면 이관이 그 값을 날려도 초록이다(0012 스펙은
   그 컬럼이 이관 대상이 아니었으므로 뺄 이유가 있었지만, 0013 은 그게 질문 자체다). */
const COLUMNS =
  "week_start_date, note, draft, published_at, fanart_image_key, fanart_credit, created_at, last_updated_at" as const;

function migrate(db: DatabaseSync) {
  db.exec("BEGIN;");
  db.exec(readFileSync(join(DRIZZLE_DIR, target()), "utf8"));
  db.exec("COMMIT;");
}

test("0013 이관: 걸려 있던 팬아트가 그대로 살고 치수 두 칸만 NULL 로 붙는다", () => {
  const db = seed();
  const before = db.prepare(`SELECT ${COLUMNS} FROM schedule_weeks ORDER BY week_start_date`).all();

  migrate(db);

  // 기존 칸은 한 글자도 안 바뀐다 — 팬아트 키·표기까지 포함해 직접 대조한다.
  expect(
    db.prepare(`SELECT ${COLUMNS} FROM schedule_weeks ORDER BY week_start_date`).all(),
  ).toEqual(before);

  /* 새 칸은 전부 NULL — 이미 걸린 그림의 치수는 R2 바이트 안에만 있고 어느 경로도 이미지를
     만지지 않으므로(ADR-0028) 유도할 값이 없다. 없던 사실을 지어내지 않는다. */
  expect(
    db
      .prepare(
        "SELECT count(*) AS n FROM schedule_weeks WHERE fanart_image_width IS NOT NULL OR fanart_image_height IS NOT NULL",
      )
      .get(),
  ).toEqual({ n: 0 });

  // 임시 이관 테이블은 안 남는다(0007·0008·0012 스펙과 같은 규율).
  expect(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND substr(name, 1, 2) = '__'")
      .all(),
  ).toEqual([]);

  db.close();
});

test("0013: 치수는 한 쌍이고 그림에 딸린다 — 셋을 DB 가 거절한다", () => {
  /* 화면이 자리를 예약하려면 두 값이 함께 있어야 하고, 가리킬 그림이 없는 치수는 뜻이 없다.
     0 이하는 비율 계산이 깨진다. 반대로 **그림만 있고 치수가 없는 행은 정상이다** — 브라우저가
     못 읽은 파일이 그 경로이고, 그때 화면은 예약 없이 그린다(db/schema.ts 의 nullable 근거).
     그 정상 조합까지 함께 못박아, 제약을 조이다 저하 경로를 막아 버리는 실수를 잡는다. */
  const db = seed();
  migrate(db);

  /* 거절되는 INSERT 는 행을 안 남기지만 주 날짜는 매번 다르게 준다 — 어긋난 기대로 하나가
     통과해 버리면 UNIQUE 가 그 뒤를 대신 거절해, 진짜 이유(CHECK)가 아닌 것으로 초록이 된다. */
  let n = 0;
  const insert = (cols: string, values: string) =>
    db.exec(
      `INSERT INTO schedule_weeks (week_start_date, ${cols}, created_at, last_updated_at)
       VALUES ('2026-09-0${++n}', ${values}, 1784000009000, 1784000009000);`,
    );

  // 한쪽만 있는 행.
  expect(() => insert("fanart_image_key, fanart_image_width", `'${KEY}', 800`)).toThrow();
  expect(() => insert("fanart_image_key, fanart_image_height", `'${KEY}', 600`)).toThrow();
  // 그림 없이 치수만.
  expect(() => insert("fanart_image_width, fanart_image_height", "800, 600")).toThrow();
  // 0 이하.
  expect(() =>
    insert("fanart_image_key, fanart_image_width, fanart_image_height", `'${KEY}', 0, 600`),
  ).toThrow();
  expect(() =>
    insert("fanart_image_key, fanart_image_width, fanart_image_height", `'${KEY}', 800, -1`),
  ).toThrow();

  // 그림 + 치수 한 쌍은 통과한다(위 거절들이 정상 조합까지 막지 않는지 함께 본다).
  db.exec(
    `INSERT INTO schedule_weeks (week_start_date, fanart_image_key, fanart_image_width, fanart_image_height, created_at, last_updated_at)
     VALUES ('2026-09-21', '${KEY}', 800, 600, 1784000010000, 1784000010000);`,
  );
  expect(
    db
      .prepare(
        "SELECT fanart_image_width AS w, fanart_image_height AS h FROM schedule_weeks WHERE week_start_date = '2026-09-21'",
      )
      .get(),
  ).toEqual({ w: 800, h: 600 });

  db.close();
});
