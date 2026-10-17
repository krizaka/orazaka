-- Existing dev database: the app version contract (krizaka-app-config). Idempotent. Same text as the end of
-- infra/initdb/20-conversation.sql.
-- krizaka-app-config: the parameters of the app-version contract, one row per platform.
-- Version 1 is seeded here (permissive: no minimum, no maintenance, one contract); a product's own
-- migration publishes its real values through the admin API, never by editing the row by hand.
CREATE TABLE IF NOT EXISTS app_config (
    platform              VARCHAR(16)  PRIMARY KEY,
    min_supported_version VARCHAR(32)  NOT NULL DEFAULT '0.0.0',
    latest_version        VARCHAR(32)  NOT NULL DEFAULT '0.0.0',
    update_override       VARCHAR(8),
    store_url             TEXT,
    maintenance_on        BOOLEAN      NOT NULL DEFAULT FALSE,
    maintenance_message   JSONB        NOT NULL DEFAULT '{}'::jsonb,
    message               JSONB        NOT NULL DEFAULT '{}'::jsonb,
    contract_min          INTEGER      NOT NULL DEFAULT 1,
    contract_max          INTEGER      NOT NULL DEFAULT 1,
    contract_sunset       DATE,
    flags                 JSONB        NOT NULL DEFAULT '{}'::jsonb,
    revision              INTEGER      NOT NULL DEFAULT 1,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by            VARCHAR(255) NOT NULL DEFAULT 'seed',
    CONSTRAINT app_config_platform_known CHECK (platform IN ('ios', 'android', 'macos', 'windows', 'linux', 'web')),
    CONSTRAINT app_config_contract_range CHECK (contract_min >= 1 AND contract_max >= contract_min)
);

-- Every published revision, append-only: the audit trail and the source of a rollback.
CREATE TABLE IF NOT EXISTS app_config_history (
    id                    BIGSERIAL    PRIMARY KEY,
    platform              VARCHAR(16)  NOT NULL,
    revision              INTEGER      NOT NULL,
    min_supported_version VARCHAR(32)  NOT NULL,
    latest_version        VARCHAR(32)  NOT NULL,
    update_override       VARCHAR(8),
    store_url             TEXT,
    maintenance_on        BOOLEAN      NOT NULL,
    maintenance_message   JSONB        NOT NULL,
    message               JSONB        NOT NULL,
    contract_min          INTEGER      NOT NULL,
    contract_max          INTEGER      NOT NULL,
    contract_sunset       DATE,
    flags                 JSONB        NOT NULL,
    reason                TEXT         NOT NULL,
    changed_by            VARCHAR(255) NOT NULL,
    changed_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT app_config_history_revision UNIQUE (platform, revision)
);

INSERT INTO app_config (platform)
VALUES ('ios'), ('android'), ('macos'), ('windows'), ('linux'), ('web')
ON CONFLICT (platform) DO NOTHING;

INSERT INTO app_config_history (platform, revision, min_supported_version, latest_version, update_override,
                                store_url, maintenance_on, maintenance_message, message, contract_min,
                                contract_max, contract_sunset, flags, reason, changed_by, changed_at)
SELECT platform, revision, min_supported_version, latest_version, update_override, store_url, maintenance_on,
       maintenance_message, message, contract_min, contract_max, contract_sunset, flags, 'seed', updated_by,
       updated_at
FROM app_config
ON CONFLICT (platform, revision) DO NOTHING;
