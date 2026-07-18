CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` text NOT NULL,
	`category_type` text NOT NULL,
	`category_value` text NOT NULL,
	`poster_image_url` text,
	`status` text DEFAULT 'played' NOT NULL,
	`played_at` integer,
	`cleared_at` integer,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	CONSTRAINT "games_category_type" CHECK("games"."category_type" = 'GAME'),
	CONSTRAINT "games_status" CHECK("games"."status" IN ('playing', 'cleared', 'planned', 'played'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_category_id_unique` ON `games` (`category_id`);--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "oauth_accounts_provider" CHECK("oauth_accounts"."provider" IN ('chzzk'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_accounts_provider_provider_user_id_unique` ON `oauth_accounts` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users_roles` (
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `role`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "users_roles_role" CHECK("users_roles"."role" IN ('admin', 'superadmin'))
);
