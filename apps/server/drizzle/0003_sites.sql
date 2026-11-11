-- Deployments and aliases become sites: one URL (the slug), one access setting.
-- A deployment with aliases takes the name and access of its oldest alias; other aliases go.
-- A deployment without an alias gets a random slug, so its /u/<id>/ URL stops working.
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text,
	`entrypoint` text,
	`spa` integer NOT NULL,
	`access` text NOT NULL,
	`password_hash` text,
	`indexable` integer DEFAULT false NOT NULL,
	`file_count` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_slug_unique` ON `sites` (`slug`);--> statement-breakpoint
CREATE TABLE `site_files` (
	`site_id` text NOT NULL,
	`path` text NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	`content_type` text NOT NULL,
	PRIMARY KEY(`site_id`, `path`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `site_files_hash` ON `site_files` (`hash`);--> statement-breakpoint
INSERT INTO `sites`
SELECT
	d.`id`,
	coalesce(a.`name`, lower(hex(randomblob(10)))),
	d.`title`,
	d.`entrypoint`,
	d.`spa`,
	coalesce(a.`access`, d.`access`),
	CASE WHEN a.`name` IS NULL THEN d.`password_hash` ELSE a.`password_hash` END,
	coalesce(a.`indexable`, false),
	d.`file_count`,
	d.`total_bytes`,
	d.`source`,
	d.`created_at`,
	coalesce(a.`updated_at`, d.`created_at`),
	d.`expires_at`
FROM `deployments` d
LEFT JOIN `aliases` a ON a.`name` = (
	SELECT `name` FROM `aliases` WHERE `deployment_id` = d.`id` ORDER BY `created_at`, `name` LIMIT 1
);
--> statement-breakpoint
INSERT INTO `site_files` SELECT `deployment_id`, `path`, `hash`, `size`, `content_type` FROM `deployment_files`;--> statement-breakpoint
DROP TABLE `aliases`;--> statement-breakpoint
DROP TABLE `deployment_files`;--> statement-breakpoint
DROP TABLE `deployments`;
