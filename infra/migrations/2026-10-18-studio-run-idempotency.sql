-- ADR-083 — a run start can carry an Idempotency-Key: the same key and the same request answer the
-- run it already started instead of starting (and holding credits for) another.
--
-- infra/initdb/80-studio.sql (orazaka-studio) carries the same columns and index for a fresh
-- database; the two must stay in step.
\c orazaka_studio_db

ALTER TABLE studio_run ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
ALTER TABLE studio_run ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64);

-- One run per (actor, key), whatever the code does: the backstop of the advisory lock.
CREATE UNIQUE INDEX IF NOT EXISTS ux_studio_run_idempotency
    ON studio_run (actor_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Run event streams (orazaka#189 slice A, ADR-083): the limits of GET /runs/{id}/events, as rows.
INSERT INTO studio_runtime_config (config_key, config_value, value_type, description) VALUES
 ('run.max-streams-per-actor',   '5',    'int', 'Run event streams (SSE) one actor may hold open per instance.'),
 ('run.events.poll-millis',      '1500', 'int', 'How often an open run event stream reads the run.'),
 ('run.events.heartbeat-seconds','15',   'int', 'Silence after which a run event stream sends a keep-alive comment.'),
 ('run.events.max-seconds',      '1800', 'int', 'Longest a run event stream stays open; the client reconnects.')
ON CONFLICT (config_key) DO NOTHING;
