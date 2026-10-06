-- ADR-064 — work served without a credit hold, recorded so it can be reconciled.
--
-- The credit gate fails open when billing is unreachable, and records the turn in the serving
-- service's outbox; billing collects the record here. infra/initdb/70-billing.sql carries the same
-- table for a fresh database, and the two must stay in step.
\c orazaka_billing_db
SET ROLE orazaka_billing;

CREATE TABLE IF NOT EXISTS unmetered_turn (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id       VARCHAR(255) NOT NULL,
    capability     VARCHAR(50)  NOT NULL,
    correlation_id VARCHAR(255) NOT NULL,
    reason         VARCHAR(255) NOT NULL,
    occurred_at    TIMESTAMPTZ  NOT NULL,
    recorded_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_unmetered_turn_time ON unmetered_turn(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_unmetered_turn_actor_time ON unmetered_turn(actor_id, occurred_at DESC);
