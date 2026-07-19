-- games: status 드롭 + 날짜를 epoch ms(integer) → 'YYYY-MM-DD'(text) + category_id nullable.
-- SQLite 는 컬럼 변경이 없어 drizzle 이 테이블 재생성으로 만든다 — 정상이다.
--
-- 손으로 고친 곳 하나: 아래 SELECT 가 played_at/cleared_at 을 NULL 로 옮긴다. 생성기는 구
-- 컬럼을 그대로 복사하지만 구 값은 epoch ms 라 TEXT 친화도가 '1700000000000' 같은 문자열로
-- 굳혀 놓는다 — 날짜로 파싱도 정렬도 안 되는 쓰레기가 조용히 남는다. 형식이 바뀐 값은
-- 이관 대상이 아니라 버리는 값이다(status 와 같은 결정).
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` text,
	`category_type` text NOT NULL,
	`category_value` text NOT NULL,
	`poster_image_url` text,
	`played_at` text,
	`cleared_at` text,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	CONSTRAINT "games_category_type" CHECK("__new_games"."category_type" = 'GAME')
);
--> statement-breakpoint
INSERT INTO `__new_games`("id", "category_id", "category_type", "category_value", "poster_image_url", "played_at", "cleared_at", "created_at", "last_updated_at") SELECT "id", "category_id", "category_type", "category_value", "poster_image_url", NULL, NULL, "created_at", "last_updated_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `games_category_id_unique` ON `games` (`category_id`);