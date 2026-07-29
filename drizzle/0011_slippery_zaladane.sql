CREATE TABLE `schedule_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scheduled_date` text NOT NULL,
	`start_time` text,
	`rest` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_days_scheduled_date_unique` ON `schedule_days` (`scheduled_date`);--> statement-breakpoint
--> 손으로 더한 이관문. **아래 DROP COLUMN 보다 반드시 위에 있어야 한다** — 아래면 읽으려는
--> start_time 이 이미 없다. 0008 이 반대 방향으로 같은 실수를 했다(생성물의 INSERT…SELECT 가
--> 아직 없는 컬럼을 읽어 `no such column` 으로 죽었고, 로컬 게이트는 마이그레이션을 안 돌려
--> 전부 초록이었다). 컬럼을 옮기는 마이그레이션은 생성물을 열어 순서를 손으로 확인한다.
-->
--> 하루의 시각 = 그날 항목들의 MIN(start_time). "그날 방송 시작"이므로 가장 이른 값이다.
--> 시각이 하나도 없는 날은 **행을 안 만든다** — `start_time NULL` + `rest 0` 은 행이 없는 것과
--> 같은 뜻이라(schema.ts 의 "행이 없는 것 = 기본값"), 만들면 그 불변만 흐려진다.
-->
--> created_at·last_updated_at 은 NOT NULL 인데 기본값이 없다. unixepoch() 대신 strftime 를 쓰는
--> 건 더 오래된 SQLite 에서도 같은 값이 나오게 하기 위해서다(회귀 스펙이 node:sqlite 로 이 파일을
--> 그대로 재생한다).
INSERT INTO `schedule_days` (`scheduled_date`, `start_time`, `rest`, `created_at`, `last_updated_at`)
SELECT `scheduled_date`, MIN(`start_time`), 0,
       CAST(strftime('%s','now') AS INTEGER) * 1000,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM `schedule_entries`
WHERE `start_time` IS NOT NULL
GROUP BY `scheduled_date`;--> statement-breakpoint
ALTER TABLE `schedule_entries` DROP COLUMN `start_time`;
