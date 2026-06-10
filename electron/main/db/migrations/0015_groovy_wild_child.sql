CREATE TABLE `daily_advice`
(
    `id`           integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `dateKey`      text    NOT NULL,
    `contentJson`  text    NOT NULL,
    `templateName` text,
    `modelUsed`    text,
    `recordCount`  integer NOT NULL,
    `createdAt`    integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_advice_dateKey_unique` ON `daily_advice` (`dateKey`);--> statement-breakpoint
CREATE INDEX `idx_daily_advice_dateKey` ON `daily_advice` (`dateKey`);
