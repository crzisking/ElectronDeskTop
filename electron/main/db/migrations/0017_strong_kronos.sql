CREATE TABLE `todos`
(
    `id`               text PRIMARY KEY           NOT NULL,
    `content`          text                       NOT NULL,
    `title`            text                       NOT NULL,
    `note`             text,
    `status`           text    DEFAULT 'active'   NOT NULL,
    `kind`             text    DEFAULT 'task'     NOT NULL,
    `priority`         integer DEFAULT 1          NOT NULL,
    `category`         text    DEFAULT ''         NOT NULL,
    `owner`            text,
    `dueAt`            integer,
    `dueKind`          text    DEFAULT 'none'     NOT NULL,
    `source`           text    DEFAULT 'keyboard' NOT NULL,
    `aiState`          text    DEFAULT 'skipped'  NOT NULL,
    `enrichPromptedAt` integer,
    `createdAt`        integer                    NOT NULL,
    `updatedAt`        integer                    NOT NULL,
    `completedAt`      integer
);
--> statement-breakpoint
CREATE INDEX `todos_status_idx` ON `todos` (`status`);--> statement-breakpoint
CREATE INDEX `todos_due_idx` ON `todos` (`dueAt`);
