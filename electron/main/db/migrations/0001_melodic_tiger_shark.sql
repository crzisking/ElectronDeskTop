CREATE TABLE `work_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`capturedAt` integer NOT NULL,
	`activeApp` text,
	`activeWindowTitle` text,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`confidence` real
);
--> statement-breakpoint
CREATE INDEX `idx_work_capturedAt` ON `work_records` (`capturedAt`);