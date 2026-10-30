-- orazaka-packs#162 (orazaka-job-service#79): NONE, the explicit "not billable on its own" of a step that only
-- orchestrates or presents (tenant-screening-qc's plan and consent steps). The column's named check
-- ck_orazaka_capabilities_billable_capability now accepts it. orazaka-job-service infra/initdb/30-jobs-config.sql carries
-- the same list for a fresh database; the two must stay in step. Additive and idempotent (the constraint is replaced by
-- name; no row changes). Runs in orazaka_db.
ALTER TABLE orazaka_capabilities DROP CONSTRAINT IF EXISTS ck_orazaka_capabilities_billable_capability;
ALTER TABLE orazaka_capabilities ADD CONSTRAINT ck_orazaka_capabilities_billable_capability
    CHECK (billable_capability IN ('CHAT','IMAGE','AUDIO','VIDEO','AGENT','EXTERNAL_CHECK','NONE'));
