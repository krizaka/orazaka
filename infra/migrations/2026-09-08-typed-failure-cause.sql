-- ADR-053 — the typed failure cause, for a database that already has runs in it.
--
-- Three columns, all nullable and all unconstrained by a CHECK: the vocabulary is a Java enum and
-- a database CHECK listing its members would be the same closed set written twice, drifting the
-- day a cause is added. What the database does own is the DEFAULT for a row written before this
-- migration existed, and it is deliberately absent: NULL means "written before causes existed",
-- which FailureCause.of() reads as EXECUTOR_FAULT — release, blame nobody.
\c orazaka_studio_db

ALTER TABLE studio_run_step ADD COLUMN IF NOT EXISTS failure_cause VARCHAR(32);
ALTER TABLE studio_run      ADD COLUMN IF NOT EXISTS failure_cause VARCHAR(32);
ALTER TABLE studio_run_audit ADD COLUMN IF NOT EXISTS failure_cause VARCHAR(32);

-- The audit log's whole reason for carrying this: a SENSITIVE pack must be able to show that a
-- refused run was PROTECTED and not BROKEN, and until now both were the same row (ADR-053 §1).
CREATE INDEX IF NOT EXISTS idx_run_audit_cause
    ON studio_run_audit (failure_cause) WHERE failure_cause IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_studio_run_failure_cause
    ON studio_run (failure_cause) WHERE failure_cause IS NOT NULL;
