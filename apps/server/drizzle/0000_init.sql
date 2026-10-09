CREATE TABLE `aliases` (
	`name` text PRIMARY KEY NOT NULL,
	`deployment_id` text NOT NULL,
	`access` text NOT NULL,
	`password_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `aliases_deployment` ON `aliases` (`deployment_id`);--> statement-breakpoint
CREATE TABLE `deployment_files` (
	`deployment_id` text NOT NULL,
	`path` text NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	`content_type` text NOT NULL,
	PRIMARY KEY(`deployment_id`, `path`),
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deployment_files_hash` ON `deployment_files` (`hash`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`entrypoint` text,
	`spa` integer NOT NULL,
	`access` text NOT NULL,
	`password_hash` text,
	`file_count` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
