-- Frost ID 数据库扩展：仅保存 Blades of Hex 的玩家档案，不修改 Frost ID 账户数据。
CREATE TABLE IF NOT EXISTS `blades_of_hex_player_profiles` (
    `user_id` VARCHAR(36) NOT NULL,
    `schema_version` INT NOT NULL,
    `profile_json` JSON NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
