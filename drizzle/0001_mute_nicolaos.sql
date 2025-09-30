CREATE TABLE `extracted_videos_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`thumbnail` text,
	`format` text,
	`source` text NOT NULL,
	`source_url` text NOT NULL,
	`page_title` text,
	`extracted_at` integer NOT NULL
);
