CREATE TABLE `security_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`family_id` text,
	`event_type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_oauth_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`channel_name` text,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "oauth_accounts_provider" CHECK("__new_oauth_accounts"."provider" IN ('chzzk'))
);
--> statement-breakpoint
-- channel_name 은 *이 마이그레이션이 도입하는* 컬럼이라 구 테이블엔 없다. drizzle-kit 이 생성한
-- 원본은 구 테이블에서 그대로 SELECT 해 "no such column" 으로 죽었다 — 새 컬럼은 NULL 로 채운다.
INSERT INTO `__new_oauth_accounts`("id", "user_id", "provider", "provider_user_id", "channel_name", "created_at", "last_updated_at") SELECT "id", "user_id", "provider", "provider_user_id", NULL, "created_at", "last_updated_at" FROM `oauth_accounts`;--> statement-breakpoint
DROP TABLE `oauth_accounts`;--> statement-breakpoint
ALTER TABLE `__new_oauth_accounts` RENAME TO `oauth_accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_accounts_provider_provider_user_id_unique` ON `oauth_accounts` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE TABLE `__new_refresh_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`family_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`family_expires_at` integer NOT NULL,
	`superseded_at` integer,
	`revoked_at` integer,
	`replaced_by_token` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- replaced_by_token 도 같은 이유로 NULL 로 채운다(0003 까지의 refresh_tokens 엔 없는 컬럼).
INSERT INTO `__new_refresh_tokens`("id", "user_id", "family_id", "token_hash", "expires_at", "family_expires_at", "superseded_at", "revoked_at", "replaced_by_token", "created_at") SELECT "id", "user_id", "family_id", "token_hash", "expires_at", "family_expires_at", "superseded_at", "revoked_at", NULL, "created_at" FROM `refresh_tokens`;--> statement-breakpoint
DROP TABLE `refresh_tokens`;--> statement-breakpoint
ALTER TABLE `__new_refresh_tokens` RENAME TO `refresh_tokens`;--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_token_hash_unique` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_id` ON `refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_id` ON `refresh_tokens` (`user_id`);