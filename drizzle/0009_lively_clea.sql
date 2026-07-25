CREATE TABLE `game_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`game_id` integer,
	`author_user_id` integer NOT NULL,
	`proposed_title` text,
	`proposed_cleared` integer DEFAULT false NOT NULL,
	`proposed_cleared_date` text,
	`proposed_played_date` text,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolved_at` integer,
	`resolved_by_user_id` integer,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "game_suggestions_kind" CHECK("game_suggestions"."kind" IN ('edit', 'add')),
	CONSTRAINT "game_suggestions_status" CHECK("game_suggestions"."status" IN ('pending', 'accepted', 'rejected')),
	CONSTRAINT "game_suggestions_shape" CHECK(("game_suggestions"."kind" = 'edit' AND "game_suggestions"."game_id" IS NOT NULL AND "game_suggestions"."proposed_title" IS NULL)
          OR ("game_suggestions"."kind" = 'add' AND "game_suggestions"."game_id" IS NULL AND "game_suggestions"."proposed_title" IS NOT NULL)),
	CONSTRAINT "game_suggestions_cleared_date" CHECK("game_suggestions"."proposed_cleared" = 1 OR "game_suggestions"."proposed_cleared_date" IS NULL),
	CONSTRAINT "game_suggestions_resolution" CHECK(("game_suggestions"."status" = 'pending' AND "game_suggestions"."resolved_at" IS NULL AND "game_suggestions"."resolved_by_user_id" IS NULL)
          OR ("game_suggestions"."status" <> 'pending' AND "game_suggestions"."resolved_at" IS NOT NULL AND "game_suggestions"."resolved_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_suggestions_open_per_author` ON `game_suggestions` (`game_id`,`author_user_id`) WHERE "game_suggestions"."status" = 'pending' AND "game_suggestions"."game_id" IS NOT NULL;