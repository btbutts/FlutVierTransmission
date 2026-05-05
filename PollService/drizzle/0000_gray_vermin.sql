CREATE TABLE `geo_cache` (
	`ip` text PRIMARY KEY NOT NULL,
	`country_code` text NOT NULL,
	`country` text NOT NULL,
	`city` text NOT NULL,
	`region_name` text NOT NULL,
	`cached_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `torrents` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
