-- 工作採集模板化(docs/11 §8):
-- work_records 加 activityState 欄位,將「閒置」從 category 拆出來變狀態。
-- active = 正常採集;idle = 鍵鼠空閒時本地落格(不打 AI)。
-- 歷史資料:原 category='idle' 的紀錄 backfill 為 idle,其他為 active。
ALTER TABLE `work_records`
    ADD `activityState` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
UPDATE `work_records`
SET `activityState` = CASE WHEN `category` = 'idle' THEN 'idle' ELSE 'active' END;
