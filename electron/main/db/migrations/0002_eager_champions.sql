CREATE TABLE `user_profiles` (
	`userId` text PRIMARY KEY NOT NULL,
	`dingId` text NOT NULL,
	`unionId` text NOT NULL,
	`displayName` text,
	`email` text,
	`syncedAt` integer NOT NULL
);
