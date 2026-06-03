CREATE INDEX `idx_logs_module` ON `logs` (`module`);--> statement-breakpoint
CREATE INDEX `idx_work_capturedAt_activityState` ON `work_records` (`capturedAt`, `activityState`);
