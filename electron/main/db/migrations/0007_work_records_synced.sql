-- 工作採集集中化(docs/19 / docs/20):
-- work_records 加 synced / syncedAt 兩欄位,desktop 用於追蹤批次上傳到 server 的狀態。
-- 既有歷史資料 synced=0,首次啟動 safety net 會一次性 batch upload。
ALTER TABLE `work_records`
    ADD `synced` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `work_records`
    ADD `syncedAt` integer;
--> statement-breakpoint
CREATE INDEX `idx_work_records_synced` ON `work_records` (`synced`, `capturedAt`);
