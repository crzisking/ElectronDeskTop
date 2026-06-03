CREATE TABLE `saved_credentials`
(
    `userId`    text PRIMARY KEY NOT NULL,
    `password`  text             NOT NULL,
    `updatedAt` integer          NOT NULL
);
