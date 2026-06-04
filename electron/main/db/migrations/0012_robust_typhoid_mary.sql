CREATE TABLE `work_analysis_reports`
(
    `id`            text PRIMARY KEY NOT NULL,
    `rangeStart`    integer          NOT NULL,
    `rangeEnd`      integer          NOT NULL,
    `recordCount`   integer          NOT NULL,
    `providerId`    text             NOT NULL,
    `providerLabel` text             NOT NULL,
    `modelUsed`     text             NOT NULL,
    `reportJson`    text             NOT NULL,
    `inputTokens`   integer,
    `outputTokens`  integer,
    `createdAt`     integer          NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_work_analysis_createdAt` ON `work_analysis_reports` (`createdAt`);
