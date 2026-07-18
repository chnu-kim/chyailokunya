CREATE TABLE `role_audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer NOT NULL,
	`target_user_id` integer NOT NULL,
	`action` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "role_audit_logs_action" CHECK("role_audit_logs"."action" IN ('grant', 'revoke')),
	CONSTRAINT "role_audit_logs_role" CHECK("role_audit_logs"."role" IN ('admin', 'superadmin'))
);
