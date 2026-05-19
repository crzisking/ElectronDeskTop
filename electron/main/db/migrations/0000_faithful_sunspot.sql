CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`createdAt` integer NOT NULL,
	`level` text NOT NULL,
	`source` text NOT NULL,
	`module` text,
	`message` text NOT NULL,
	`args` text,
	`errorStack` text
);
--> statement-breakpoint
CREATE INDEX `idx_logs_createdAt` ON `logs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_logs_level_createdAt` ON `logs` (`level`,`createdAt`);