-- ADR-061 — pack.kind and derived installation, for a database that already has packs and runs.
\c orazaka_studio_db

-- How a pack reaches the user. Every existing pack is a VERTICAL: the default IS the migration, and
-- it is the kind that grants nothing by itself. Orthogonal to tier (pack.yaml) and regulatory_class.
ALTER TABLE pack ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'VERTICAL';

ALTER TABLE pack DROP CONSTRAINT IF EXISTS ck_pack_kind;
ALTER TABLE pack ADD CONSTRAINT ck_pack_kind CHECK (kind IN ('VERTICAL','TOOLKIT'));

-- Consent is recorded on an installation, and a TOOLKIT has none.
ALTER TABLE pack DROP CONSTRAINT IF EXISTS ck_pack_toolkit_not_regulated;
ALTER TABLE pack ADD CONSTRAINT ck_pack_toolkit_not_regulated
    CHECK (kind <> 'TOOLKIT' OR regulatory_class <> 'REGULATED');

-- Consent and the region-chosen crisis reply both need an installation row, at any class.
ALTER TABLE pack DROP CONSTRAINT IF EXISTS ck_pack_toolkit_no_installation_controls;
ALTER TABLE pack ADD CONSTRAINT ck_pack_toolkit_no_installation_controls
    CHECK (kind <> 'TOOLKIT' OR (consent_version IS NULL AND safety IS NULL));

-- A TOOLKIT run has no installation row to point at.
ALTER TABLE studio_run ALTER COLUMN installation_id DROP NOT NULL;

-- ...and so it can never carry REGULATED data, whose consent lives on that row.
ALTER TABLE studio_run DROP CONSTRAINT IF EXISTS ck_run_uninstalled_not_regulated;
ALTER TABLE studio_run ADD CONSTRAINT ck_run_uninstalled_not_regulated
    CHECK (installation_id IS NOT NULL OR data_class <> 'REGULATED');
