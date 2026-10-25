-- orazaka-studio#72 (admin API for the Studio's runtime settings) and #71 (the saga's hot path): every setting carries
-- its default and its bounds, an admin's change is audited, and the saga's two new settings exist on dev.
--
-- infra/initdb/80-studio.sql (orazaka-studio) carries the same columns, rows and bounds for a fresh database; the two
-- must stay in step. Additive and idempotent: safe before the code ships (the old code never inserts these rows).
\c orazaka_studio_db

ALTER TABLE studio_runtime_config
    ADD COLUMN IF NOT EXISTS default_value TEXT,
    ADD COLUMN IF NOT EXISTS min_value BIGINT,
    ADD COLUMN IF NOT EXISTS max_value BIGINT,
    ADD COLUMN IF NOT EXISTS max_items INTEGER;

UPDATE studio_runtime_config
SET default_value = CASE config_key
    WHEN 'run.max-concurrent-per-actor' THEN '2'
    WHEN 'run.result-cache.studios' THEN ''
    WHEN 'run.max-seconds' THEN '14400'
    WHEN 'run.concurrency-retry-seconds' THEN '15'
    WHEN 'run.max-streams-per-actor' THEN '5'
    WHEN 'run.events.poll-millis' THEN '1500'
    WHEN 'run.events.heartbeat-seconds' THEN '15'
    WHEN 'run.events.max-seconds' THEN '1800'
    WHEN 'run.step-timeout-seconds.interactive' THEN '300'
    WHEN 'run.step-timeout-seconds.batch' THEN '1800'
    WHEN 'run.fan-out-max' THEN '10'
    WHEN 'marketplace.third-party-enabled' THEN 'false'
    WHEN 'retention.run-days' THEN '90'
    WHEN 'retention.sensitive-run-days' THEN '30'
    WHEN 'retention.revoked-installation-days' THEN '30'
    WHEN 'webhook.max-attempts' THEN '8'
    WHEN 'webhook.backoff-seconds' THEN '30'
    WHEN 'webhook.backoff-cap-seconds' THEN '3600'
    WHEN 'webhook.timeout-seconds' THEN '10'
    WHEN 'webhook.batch-size' THEN '20'
    WHEN 'webhook.max-endpoints-per-actor' THEN '5'
    WHEN 'webhook.rotation-grace-hours' THEN '24'
    ELSE config_value
END,
min_value = CASE
    WHEN config_key IN ('run.max-concurrent-per-actor', 'run.max-streams-per-actor',
        'run.concurrency-retry-seconds', 'run.events.heartbeat-seconds',
        'run.step-timeout-seconds.interactive', 'run.step-timeout-seconds.batch',
        'run.fan-out-max', 'webhook.max-attempts', 'webhook.backoff-seconds',
        'webhook.backoff-cap-seconds', 'webhook.timeout-seconds', 'webhook.batch-size',
        'webhook.max-endpoints-per-actor', 'retention.run-days',
        'retention.sensitive-run-days') THEN 1
    WHEN config_key IN ('run.max-seconds', 'run.events.max-seconds') THEN 60
    WHEN config_key = 'run.events.poll-millis' THEN 100
    WHEN config_key IN ('retention.revoked-installation-days',
        'webhook.rotation-grace-hours') THEN 0
    ELSE NULL
END,
max_value = CASE
    WHEN config_key IN ('run.max-concurrent-per-actor', 'run.max-streams-per-actor',
        'webhook.max-endpoints-per-actor') THEN 100
    WHEN config_key = 'run.concurrency-retry-seconds' THEN 300
    WHEN config_key = 'run.max-seconds' THEN 86400
    WHEN config_key = 'run.events.poll-millis' THEN 60000
    WHEN config_key = 'run.events.heartbeat-seconds' THEN 300
    WHEN config_key = 'run.events.max-seconds' THEN 86400
    WHEN config_key = 'run.step-timeout-seconds.interactive' THEN 3600
    WHEN config_key = 'run.step-timeout-seconds.batch' THEN 14400
    WHEN config_key = 'run.fan-out-max' THEN 1000
    WHEN config_key IN ('retention.run-days', 'retention.sensitive-run-days',
        'retention.revoked-installation-days') THEN 3650
    WHEN config_key = 'webhook.max-attempts' THEN 100
    WHEN config_key = 'webhook.backoff-seconds' THEN 86400
    WHEN config_key = 'webhook.backoff-cap-seconds' THEN 604800
    WHEN config_key = 'webhook.timeout-seconds' THEN 300
    WHEN config_key = 'webhook.batch-size' THEN 1000
    WHEN config_key = 'webhook.rotation-grace-hours' THEN 720
    ELSE NULL
END,
max_items = CASE WHEN config_key = 'run.result-cache.studios' THEN 100 ELSE NULL END;

-- The saga's settings (orazaka-studio#71): until now the code fell back to 100 and 2.
INSERT INTO studio_runtime_config
    (config_key, config_value, value_type, description, default_value, min_value, max_value, max_items)
VALUES
 ('run.blueprint-cache-size', '100', 'int', 'Maximum published blueprint versions parsed and cached per service instance; 0 disables the cache.', '100', 0, 10000, NULL),
 ('run.outcome-listener.concurrency', '2', 'int', 'Outcome listener consumer count per service instance, adjusted live on its virtual-thread executor.', '2', 1, 64, NULL)
ON CONFLICT (config_key) DO UPDATE SET
    default_value = EXCLUDED.default_value,
    min_value = EXCLUDED.min_value,
    max_value = EXCLUDED.max_value,
    max_items = EXCLUDED.max_items;

UPDATE studio_runtime_config SET description = '' WHERE description IS NULL;

ALTER TABLE studio_runtime_config
    ALTER COLUMN default_value SET NOT NULL;

CREATE TABLE IF NOT EXISTS studio_runtime_config_audit (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_id VARCHAR(255) NOT NULL,
    config_key VARCHAR(120) NOT NULL,
    before_value TEXT NOT NULL,
    after_value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_studio_runtime_config_audit_at
    ON studio_runtime_config_audit(at DESC);
