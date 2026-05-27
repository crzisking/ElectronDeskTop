-- Migration 手動加上 IF NOT EXISTS:
-- 既有使用者 (1.3.x) 透過 AgentService.ensureTables() 已建好兩張表,
-- 純 CREATE TABLE 會在他們的環境上炸。新環境(空 DB)沒影響,因為本來就要建。
-- 全新 dev 環境 / build:此 migration 從 0 開始一樣建好兩張表 + index。
CREATE TABLE IF NOT EXISTS `agent_configs`
(
    `key`
    text
    PRIMARY
    KEY
    NOT
    NULL,
    `value`
    text
    NOT
    NULL,
    `updatedAt`
    integer
    NOT
    NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agent_messages`
(
    `id`
    text
    PRIMARY
    KEY
    NOT
    NULL,
    `conversationId`
    text
    NOT
    NULL,
    `role`
    text
    NOT
    NULL,
    `content`
    text,
    `toolCalls`
    text,
    `toolCallId`
    text,
    `timestamp`
    integer
    NOT
    NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_agent_messages_conv` ON `agent_messages` (`conversationId`,`timestamp`);
