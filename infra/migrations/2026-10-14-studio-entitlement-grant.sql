-- Operator grants (krizaka/orazaka-studio#9): a Studio entitlement given to an actor outside any plan — a first-party
-- product's service account (Yomizaka runs the document Studios), a pilot, an environment that sells nothing.
-- krizaka/orazaka-studio infra/initdb/80-studio.sql carries the same table for a fresh database.
\c orazaka_studio_db

CREATE TABLE IF NOT EXISTS studio_entitlement_grant (
    actor_id        VARCHAR(255) NOT NULL,
    entitlement_key VARCHAR(120) NOT NULL,
    reason          TEXT         NOT NULL CHECK (length(trim(reason)) > 0),
    granted_by      VARCHAR(255) NOT NULL,
    granted_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    PRIMARY KEY (actor_id, entitlement_key)
);
