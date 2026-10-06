-- The SENSITIVE regulatory class becomes four working controls (ADR-051).
--
-- regulatory_class has been a column read by nothing for four runs (ADR-036). This is the
-- migration that gives it effect on a database that already exists; infra/initdb/80-studio.sql
-- carries the same destination for a fresh one, and the two must stay in step.
\c orazaka_studio_db

-- 1. The domain a pack refuses, declared by the pack and never named by the engine.
ALTER TABLE pack ADD COLUMN IF NOT EXISTS scope_guard JSONB;

-- 2. The class travels with the run, because the obligation attaches to the data and not to a
--    pack row somebody can still re-classify or withdraw.
ALTER TABLE studio_run ADD COLUMN IF NOT EXISTS data_class VARCHAR(20) NOT NULL DEFAULT 'STANDARD';
ALTER TABLE studio_run DROP CONSTRAINT IF EXISTS ck_run_data_class;
ALTER TABLE studio_run ADD CONSTRAINT ck_run_data_class
  CHECK (data_class IN ('STANDARD','SENSITIVE','REGULATED'));
CREATE INDEX IF NOT EXISTS idx_run_data_class
  ON studio_run(data_class, finished_at) WHERE data_class <> 'STANDARD';

-- 3. The append-only trail. Same construction as credit_ledger_entry, trigger included.
CREATE TABLE IF NOT EXISTS studio_run_audit (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      UUID         NOT NULL,
    actor_id    VARCHAR(255) NOT NULL,
    pack_key    VARCHAR(50)  NOT NULL,
    studio_key  VARCHAR(60)  NOT NULL,
    data_class  VARCHAR(20)  NOT NULL,
    event       VARCHAR(40)  NOT NULL,
    step_id     VARCHAR(60),
    detail      VARCHAR(255),
    recorded_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_audit_data_class CHECK (data_class IN ('SENSITIVE','REGULATED'))
);
CREATE INDEX IF NOT EXISTS idx_run_audit_run   ON studio_run_audit(run_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_run_audit_actor ON studio_run_audit(actor_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION studio_run_audit_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'studio_run_audit is append-only (ADR-051) — % rejected', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_studio_run_audit_immutable ON studio_run_audit;
CREATE TRIGGER trg_studio_run_audit_immutable
  BEFORE UPDATE OR DELETE ON studio_run_audit
  FOR EACH ROW EXECUTE FUNCTION studio_run_audit_immutable();

-- 4. The shorter window SENSITIVE runs age out on. A platform default the user may lower and
--    never raise (ADR-051); the sweeper takes the minimum of the two.
INSERT INTO studio_runtime_config (config_key, config_value, value_type, description) VALUES
('retention.sensitive-run-days', '30', 'int',
 'Retention window for runs of a SENSITIVE pack. Shorter than retention.run-days; an installation may lower it, never raise it.')
ON CONFLICT (config_key) DO NOTHING;

-- 5. The scope guard needs no row: it is a CORE_INTERCEPTOR_KEY in PipelineRegistry, so it runs
--    first in the non-bypassable Phase 1 whatever this database says. A row here would surface a
--    toggle in the admin console that the executor ignores for core keys — an off switch that does
--    not switch off is worse than no switch. Remove the one an earlier draft of this file inserted.
\c orazaka_db
DELETE FROM interceptor_policy WHERE interceptor_name = 'ScopeGuardInterceptor';
