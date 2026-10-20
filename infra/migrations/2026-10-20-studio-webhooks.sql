-- ─────────────────────────────────────────────────────────────────────────────
-- SIGNED WEBHOOKS (orazaka#189 slice B, ADR-083): a client that cannot hold a stream open is told when a run is over.
-- An endpoint belongs to one actor (the API key's owner); `secret` signs the body (Standard Webhooks, HMAC-SHA256) and
-- `previous_secret` stays valid until `previous_secret_until`, so a receiver can rotate without losing a delivery.
-- A delivery is one (endpoint, run, event): at-least-once, retried with exponential backoff, then DEAD — the log of
-- what was tried is the table itself. Idempotent: safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS studio_webhook_endpoint (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id              VARCHAR(255) NOT NULL,          -- OPAQUE — no FK into identity
    url                   TEXT         NOT NULL,
    secret                VARCHAR(120) NOT NULL,
    previous_secret       VARCHAR(120),
    previous_secret_until TIMESTAMPTZ,
    events                TEXT         NOT NULL DEFAULT 'run.completed,run.failed',
    enabled               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_webhook_endpoint_actor ON studio_webhook_endpoint (actor_id) WHERE enabled;

CREATE TABLE IF NOT EXISTS studio_webhook_delivery (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id     UUID         NOT NULL REFERENCES studio_webhook_endpoint(id) ON DELETE CASCADE,
    run_id          UUID         NOT NULL,
    event           VARCHAR(40)  NOT NULL,
    payload         TEXT         NOT NULL,
    status          VARCHAR(12)  NOT NULL DEFAULT 'PENDING',
    attempts        INT          NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_http_status INT,
    last_error      VARCHAR(500),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ,
    CONSTRAINT ck_webhook_delivery_status CHECK (status IN ('PENDING','DELIVERED','DEAD')),
    CONSTRAINT ux_webhook_delivery UNIQUE (endpoint_id, run_id, event)
);
CREATE INDEX IF NOT EXISTS idx_studio_webhook_delivery_due ON studio_webhook_delivery (next_attempt_at) WHERE status = 'PENDING';

INSERT INTO studio_runtime_config (config_key, config_value, value_type, description) VALUES
 ('webhook.max-attempts',          '8',    'int', 'Deliveries tried before a webhook is DEAD.'),
 ('webhook.backoff-seconds',       '30',   'int', 'Wait after the first failed delivery; it doubles at each attempt.'),
 ('webhook.backoff-cap-seconds',   '3600', 'int', 'Longest wait between two attempts.'),
 ('webhook.timeout-seconds',       '10',   'int', 'How long a receiver has to answer.'),
 ('webhook.batch-size',            '20',   'int', 'Deliveries taken per sweep and instance.'),
 ('webhook.rotation-grace-hours',  '24',   'int', 'How long the previous secret keeps signing next to the new one.')
ON CONFLICT (config_key) DO NOTHING;
