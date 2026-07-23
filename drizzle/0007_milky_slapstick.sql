-- 일정 정본 도입 + games 모델 이전(이슈 #56 작업순서 3, ADR-0019 보강).
--   · schedule_weeks·schedule_entries 신설(일정이 캘린더·주간표·게임 날짜의 정본).
--   · games: played_at 드롭(플레이 날짜를 일정에서 유도), cleared_at → cleared_date +
--     cleared 플래그(깼는데 날짜 모름을 표현). SQLite 는 컬럼 변경이 없어 테이블 재생성.
--
-- **순서가 안전의 전부다.** games 를 재생성(DROP → RENAME)하는 순간 games 를 참조하는 자식
-- 행이 하나도 없어야 한다. 초판은 schedule_entries 를 먼저 만들어 이관까지 끝낸 뒤 games 를
-- 드롭했고, 그걸 `PRAGMA foreign_keys=OFF` 로 막으려 했다 — 그 pragma 는 **트랜잭션 안에서
-- no-op** 이라(SQLite 명세: pending BEGIN 이 있으면 무시된다) 마이그레이션을 트랜잭션으로
-- 감싸는 러너에서는 DROP TABLE games 가 ON DELETE SET NULL 을 발동시켜 방금 이관한 항목의
-- game_id 를 전부 NULL 로 만든다. 그러면 보드가 MAX(scheduled_date)를 유도할 대상을 잃어
-- **과거 플레이 날짜가 통째로 사라진다** — 결정 16 의 "손실 0"이 조용히 깨진다.
-- 자동커밋(스크래치 sqlite CLI)에서는 pragma 가 먹어 통과하므로 그 차이가 가려졌었다
-- (실측: 자동커밋 game_id=1 · 트랜잭션 game_id=NULL). e2e/migration-0007.spec.ts 가 이 파일을
-- **트랜잭션 안에서** 재생해 링크 보존을 못박는다.
--
-- 그래서 이 순서다:
--   1) 옛 played_at 을 **FK 없는** 임시 테이블에 옮긴다(games 를 드롭해도 안 딸려 간다).
--   2) games 를 재생성한다 — 이 시점에 games 를 참조하는 테이블이 아직 없다(자식 0).
--   3) schedule_entries 를 만들고(새 games 를 참조) 임시 테이블에서 되채운 뒤 임시를 버린다.
-- pragma 에 기대지 않으므로 러너가 트랜잭션을 쓰든 안 쓰든 결과가 같다.
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
-- 손편집 1(단계 1): played_at 을 FK 없는 임시 테이블로 옮긴다. 항목 제목은 게임명, start_time 은
-- 미상이라 나중에 NULL 로 넣는다. created_at/last_updated_at 은 게임의 것을 잇는다
-- ("그 게임을 기록한 이래 있던 항목"). game_id 는 옛 id 이고, 재생성이 id 를 보존하므로
-- 단계 3 의 FK 가 그대로 성립한다.
CREATE TABLE `__played_backfill` (
	`game_id` integer NOT NULL,
	`scheduled_date` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__played_backfill` (`game_id`, `scheduled_date`, `title`, `created_at`, `last_updated_at`)
SELECT `id`, `played_at`, `category_value`, `created_at`, `last_updated_at`
FROM `games` WHERE `played_at` IS NOT NULL;--> statement-breakpoint
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
-- 손편집 2(단계 2): cleared_at → cleared_date + cleared 플래그 매핑(생성기는 구 컬럼을 그대로
-- 복사한다). 깨진 적 있으면 1·날짜 보존, 아니면 0·null — CHECK(cleared=1 OR cleared_date IS NULL)
-- 를 그대로 만족한다. 이 시점에 games 를 참조하는 자식 테이블이 없어 아래 DROP 이 안전하다.
INSERT INTO `__new_games`("id", "category_id", "category_type", "category_value", "poster_image_url", "cleared", "cleared_date", "created_at", "last_updated_at") SELECT "id", "category_id", "category_type", "category_value", "poster_image_url", CASE WHEN "cleared_at" IS NOT NULL THEN 1 ELSE 0 END, "cleared_at", "created_at", "last_updated_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
CREATE UNIQUE INDEX `games_category_id_unique` ON `games` (`category_id`);--> statement-breakpoint
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
-- 손편집 1(단계 3): 임시 테이블 → schedule_entries. game_id 로 게임에 이어져 보드가
-- MAX(scheduled_date)로 플레이 날짜를 되유도한다(features/games/service.listGames).
INSERT INTO `schedule_entries` (`scheduled_date`, `start_time`, `title`, `game_id`, `created_at`, `last_updated_at`)
SELECT `scheduled_date`, NULL, `title`, `game_id`, `created_at`, `last_updated_at`
FROM `__played_backfill`;--> statement-breakpoint
DROP TABLE `__played_backfill`;
