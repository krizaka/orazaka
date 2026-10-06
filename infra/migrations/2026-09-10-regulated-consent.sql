-- ADR-055 — the two REGULATED controls, for a database that already has installations in it.
\c orazaka_studio_db

-- The pack states what it requires; the installation records what was given.
ALTER TABLE pack ADD COLUMN IF NOT EXISTS consent_version  VARCHAR(16);
ALTER TABLE pack ADD COLUMN IF NOT EXISTS consent_statement TEXT;
ALTER TABLE pack ADD COLUMN IF NOT EXISTS safety           JSONB;

-- Consent is to a STATEMENT, not to a checkbox: the version is stored so that changing the
-- statement invalidates what was agreed to and the installation asks again (GDPR Art. 9, Loi 25).
ALTER TABLE studio_installation ADD COLUMN IF NOT EXISTS consent_version   VARCHAR(16);
ALTER TABLE studio_installation ADD COLUMN IF NOT EXISTS consent_recorded_at TIMESTAMPTZ;
-- Age is ATTESTED, not derived: the identity context holds no date of birth, and collecting one
-- from every user because one pack needs a gate is data minimisation backwards (ADR-055 §6).
ALTER TABLE studio_installation ADD COLUMN IF NOT EXISTS age_attested_at   TIMESTAMPTZ;
-- Which region's crisis line this installation is answered with. No default: a pack is available
-- only where it has a verified resource, so an unstated region is an install that does not happen.
ALTER TABLE studio_installation ADD COLUMN IF NOT EXISTS region            VARCHAR(8);

-- Both halves or neither: a recorded date with no version says consent was given to nothing.
ALTER TABLE studio_installation DROP CONSTRAINT IF EXISTS ck_installation_consent;
ALTER TABLE studio_installation
    ADD CONSTRAINT ck_installation_consent
    CHECK ((consent_version IS NULL) = (consent_recorded_at IS NULL));

CREATE INDEX IF NOT EXISTS idx_installation_consent
    ON studio_installation (studio_key, consent_version) WHERE consent_version IS NOT NULL;
