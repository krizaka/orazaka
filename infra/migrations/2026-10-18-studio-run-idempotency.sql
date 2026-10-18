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
