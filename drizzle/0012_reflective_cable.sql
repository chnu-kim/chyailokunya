PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_schedule_weeks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_start_date` text NOT NULL,
	`note` text,
	`draft` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`fanart_image_url` text,
	`fanart_credit` text,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	CONSTRAINT "schedule_weeks_draft" CHECK("__new_schedule_weeks"."draft" = 0 OR "__new_schedule_weeks"."published_at" IS NULL),
	CONSTRAINT "schedule_weeks_fanart" CHECK("__new_schedule_weeks"."fanart_credit" IS NULL OR "__new_schedule_weeks"."fanart_image_url" IS NOT NULL)
);
--> statement-breakpoint
--> **손편집.** drizzle-kit 이 낸 판은 SELECT 에도 `"fanart_image_url", "fanart_credit"` 을 그대로
--> 적었는데, 그 시점 옛 `schedule_weeks` 엔 그 두 컬럼이 **아직 없어서** `no such column` 으로
--> 죽는다. 0008 이 정확히 같은 실수를 했고(그때는 draft), 로컬 게이트는 마이그레이션을 안 돌려
--> 전부 초록이었다 — 컬럼을 더하는 마이그레이션은 생성물의 INSERT…SELECT 를 반드시 열어 보고
--> 새 컬럼 자리를 손으로 채운다. 여기선 유도할 옛 값이 없으므로 NULL 이다(팬아트는 이 기능
--> 이전에 존재하지 않았다 — 없던 사실을 지어내지 않는다).
INSERT INTO `__new_schedule_weeks`("id", "week_start_date", "note", "draft", "published_at", "fanart_image_url", "fanart_credit", "created_at", "last_updated_at") SELECT "id", "week_start_date", "note", "draft", "published_at", NULL, NULL, "created_at", "last_updated_at" FROM `schedule_weeks`;--> statement-breakpoint
DROP TABLE `schedule_weeks`;--> statement-breakpoint
ALTER TABLE `__new_schedule_weeks` RENAME TO `schedule_weeks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_weeks_week_start_date_unique` ON `schedule_weeks` (`week_start_date`);
