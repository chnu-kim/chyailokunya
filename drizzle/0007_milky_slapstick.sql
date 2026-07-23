-- 일정 정본 도입 + games 모델 이전(이슈 #56 작업순서 3, ADR-0019 보강).
--   · schedule_weeks·schedule_entries 신설(일정이 캘린더·주간표·게임 날짜의 정본).
--   · games: played_at 드롭(플레이 날짜를 일정에서 유도), cleared_at → cleared_date +
--     cleared 플래그(깼는데 날짜 모름을 표현). SQLite 는 컬럼 변경이 없어 테이블 재생성.
--
-- 손으로 고친 곳 둘(생성기는 못 하는 데이터 이관):
--   1) played_at 을 schedule_entries 항목으로 옮긴다(결정 16, 손실 0). 반드시 구 games 가
--      아직 살아 있을 때(DROP 전에) 돌아야 한다 — 재생성 뒤엔 played_at 컬럼이 없다.
--      created_at/last_updated_at 은 게임의 것을 잇는다("그 게임을 기록한 이래 있던 항목").
--   2) 재생성 INSERT…SELECT 의 컬럼 매핑: 구 games 엔 cleared/cleared_date 가 없다(cleared_at
--      뿐). cleared = (cleared_at IS NOT NULL), cleared_date = cleared_at 으로 옮긴다 —
--      깨진 적 있으면 1·날짜 보존, 아니면 0·null. CHECK(cleared=1 OR cleared_date IS NULL)
--      를 그대로 만족한다.
CREATE TABLE `schedule_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scheduled_date` text NOT NULL,
	`start_time` text,
	`title` text NOT NULL,
	`game_id` integer,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `schedule_weeks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_start_date` text NOT NULL,
	`note` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_weeks_week_start_date_unique` ON `schedule_weeks` (`week_start_date`);--> statement-breakpoint
-- 손편집 1: played_at → schedule_entries. 구 games 가 살아 있을 때(재생성 전에) 돈다.
-- 항목 제목은 게임명(category_value), start_time 은 미상이라 NULL. game_id 로 게임에 이어져
-- 보드가 MAX(scheduled_date)로 플레이 날짜를 되유도한다(features/games/service.listGames).
INSERT INTO `schedule_entries` (`scheduled_date`, `start_time`, `title`, `game_id`, `created_at`, `last_updated_at`)
SELECT `played_at`, NULL, `category_value`, `id`, `created_at`, `last_updated_at`
FROM `games` WHERE `played_at` IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` text,
	`category_type` text NOT NULL,
	`category_value` text NOT NULL,
	`poster_image_url` text,
	`cleared` integer DEFAULT false NOT NULL,
	`cleared_date` text,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	CONSTRAINT "games_category_type" CHECK("__new_games"."category_type" = 'GAME'),
	CONSTRAINT "games_cleared_date" CHECK("__new_games"."cleared" = 1 OR "__new_games"."cleared_date" IS NULL)
);
--> statement-breakpoint
-- 손편집 2: cleared_at → cleared_date + cleared 플래그 매핑(생성기는 구 컬럼을 그대로 복사한다).
INSERT INTO `__new_games`("id", "category_id", "category_type", "category_value", "poster_image_url", "cleared", "cleared_date", "created_at", "last_updated_at") SELECT "id", "category_id", "category_type", "category_value", "poster_image_url", CASE WHEN "cleared_at" IS NOT NULL THEN 1 ELSE 0 END, "cleared_at", "created_at", "last_updated_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `games_category_id_unique` ON `games` (`category_id`);
