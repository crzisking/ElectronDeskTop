CREATE TABLE `work_template_cache`
(
    `id`         integer PRIMARY KEY NOT NULL,
    `templateId` integer             NOT NULL,
    `version`    integer             NOT NULL,
    `detailJson` text                NOT NULL,
    `updatedAt`  integer             NOT NULL
);
