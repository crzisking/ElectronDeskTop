-- logs 表加 traceId / meta 兩個欄位 + 對應索引(對齊 docs/08 §13)。
-- 目的:跨模組關聯查詢 + 結構化 metadata 查詢。
ALTER TABLE `logs`
    ADD `traceId` text;
--> statement-breakpoint
ALTER TABLE `logs`
    ADD `meta` text;
--> statement-breakpoint
CREATE INDEX `idx_logs_traceId` ON `logs` (`traceId`);
