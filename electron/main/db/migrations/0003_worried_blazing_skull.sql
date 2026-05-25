CREATE TABLE `app_settings_kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `internal_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`openMode` text NOT NULL,
	`routeName` text,
	`url` text,
	`ord` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_internal_tools_ord` ON `internal_tools` (`ord`);--> statement-breakpoint
CREATE TABLE `personal_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`openMode` text NOT NULL,
	`routeName` text,
	`ord` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_personal_tools_ord` ON `personal_tools` (`ord`);--> statement-breakpoint
CREATE TABLE `quick_menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`icon` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`separator` integer DEFAULT 0 NOT NULL,
	`actionType` text NOT NULL,
	`actionRouteName` text,
	`actionUrl` text,
	`actionTarget` text,
	`ord` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_quick_menu_items_ord` ON `quick_menu_items` (`ord`);--> statement-breakpoint
CREATE TABLE `sidebar_items` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`icon` text NOT NULL,
	`routeName` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`badge` text,
	`ord` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sidebar_items_ord` ON `sidebar_items` (`ord`);--> statement-breakpoint
CREATE TABLE `system_links` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`icon` text NOT NULL,
	`url` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`ord` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_system_links_ord` ON `system_links` (`ord`);--> statement-breakpoint
CREATE TABLE `unified_platform_systems` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`iconUrl` text,
	`openMode` text NOT NULL,
	`ssoEnabled` integer DEFAULT 0 NOT NULL,
	`ssoTokenParam` text,
	`ord` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_unified_platform_systems_ord` ON `unified_platform_systems` (`ord`);