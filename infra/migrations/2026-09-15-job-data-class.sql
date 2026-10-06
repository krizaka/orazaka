-- ADR-065 — the job plane keeps a job's material only as long as its data class allows.
--
-- infra/initdb/30-jobs-config.sql carries the same column, index and table for a fresh database, and
-- the two must stay in step.
\c orazaka_db

ALTER TABLE orazaka_jobs ADD COLUMN IF NOT EXISTS data_class VARCHAR(20);

-- The one place a class is INFERRED, and only for rows written before producers declared one. A run
-- of a SENSITIVE pack stamped its scope guard on every step, and a REGULATED one its crisis terms
-- (ADR-051, ADR-055), so those keys are how a historical step says what it was. Everything else is
-- door 1 or a STANDARD run, which is what producers now declare for them. Inferring REGULATED from
-- the crisis key first, because a REGULATED step carries both.
UPDATE orazaka_jobs SET data_class = 'REGULATED'
 WHERE data_class IS NULL AND payload ? 'orazaka.safety.crisis-terms';
UPDATE orazaka_jobs SET data_class = 'SENSITIVE'
 WHERE data_class IS NULL AND payload ? 'orazaka.scope.refused-terms';
UPDATE orazaka_jobs SET data_class = 'STANDARD' WHERE data_class IS NULL;

ALTER TABLE orazaka_jobs ALTER COLUMN data_class SET NOT NULL;
ALTER TABLE orazaka_jobs DROP CONSTRAINT IF EXISTS ck_orazaka_jobs_data_class;
ALTER TABLE orazaka_jobs ADD CONSTRAINT ck_orazaka_jobs_data_class
    CHECK (data_class IN ('STANDARD','SENSITIVE','REGULATED'));

CREATE INDEX IF NOT EXISTS idx_orazaka_jobs_protected_terminal ON orazaka_jobs(updated_at)
    WHERE data_class <> 'STANDARD' AND status IN ('COMPLETED','FAILED');

CREATE TABLE IF NOT EXISTS orazaka_job_purge (
    job_id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(255),
    purged_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
