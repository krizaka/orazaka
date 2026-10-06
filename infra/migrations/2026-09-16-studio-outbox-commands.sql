-- ADR-067 — the studio outbox carries step dispatches, not only events.
--
-- infra/initdb/80-studio.sql carries the same columns for a fresh database, and the two must stay
-- in step (SeedBootstrapIT loads it).
\c orazaka_studio_db

ALTER TABLE studio_outbox ADD COLUMN IF NOT EXISTS exchange VARCHAR(100) NOT NULL DEFAULT 'orazaka.events';
ALTER TABLE studio_outbox ADD COLUMN IF NOT EXISTS message_id VARCHAR(64);
