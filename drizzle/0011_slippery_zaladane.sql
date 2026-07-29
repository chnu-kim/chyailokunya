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
--> 하루의 시각 = 그날의 시각. 시각이 하나도 없는 날은 **행을 안 만든다** — `start_time NULL` +
--> `rest 0` 은 행이 없는 것과 같은 뜻이라(schema.ts 의 "행이 없는 것 = 기본값"), 만들면 그
--> 불변만 흐려진다.
-->
--> ── **이 문장은 fail-closed 다**(적대적 리뷰 지적) ────────────────────────────────
--> 옛 스키마는 하루에 항목마다 다른 시각을 허용했다. 그런 날이 프로덕션에 하나라도 있으면
--> "가장 이른 것만 남긴다"는 접힘은 **되돌릴 수 없는 손실**이고, 그걸 조용히 하면 배포가
--> 성공한 채로 값이 사라진다 — 복구가 백업 뒤지기가 된다.
-->
--> 그래서 GROUP BY + MIN 으로 미리 접지 않고 **DISTINCT 로 시각마다 한 행씩** 넣는다.
--> scheduled_date 가 UNIQUE 라, 하루에 서로 다른 시각이 둘 이상이면 두 번째 행이 UNIQUE 위반을
--> 내고 **마이그레이션 전체가 그 자리에서 죽는다**(러너가 트랜잭션으로 감싸므로 아무것도 안
--> 남는다). 손실이 없을 때만 통과하고, 있으면 배포가 멈춰 사람이 먼저 결정하게 된다 —
--> 별도 가드 구문 없이 제약 하나로 그 계약이 선다.
-->
--> created_at·last_updated_at 은 NOT NULL 인데 기본값이 없다. unixepoch() 대신 strftime 를 쓰는
--> 건 더 오래된 SQLite 에서도 같은 값이 나오게 하기 위해서다(회귀 스펙이 node:sqlite 로 이 파일을
--> 그대로 재생한다).
INSERT INTO `schedule_days` (`scheduled_date`, `start_time`, `rest`, `created_at`, `last_updated_at`)
SELECT DISTINCT `scheduled_date`, `start_time`, 0,
       CAST(strftime('%s','now') AS INTEGER) * 1000,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM `schedule_entries`
WHERE `start_time` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `schedule_entries` DROP COLUMN `start_time`;
