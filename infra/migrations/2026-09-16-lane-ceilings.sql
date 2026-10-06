-- ADR-067 — a ceiling per lane, and the step row that says which lane it was dispatched into.
--
-- infra/initdb/80-studio.sql carries the same column and the same rows for a fresh database.
\c orazaka_studio_db

ALTER TABLE studio_run_step ADD COLUMN IF NOT EXISTS latency_class VARCHAR(20);

INSERT INTO studio_runtime_config (config_key, config_value, value_type, description) VALUES
  ('run.step-timeout-seconds.interactive', '300',  'int', 'Per-step ceiling in the INTERACTIVE lane — 30x the measured p95 of a chat or analysis step.'),
  ('run.step-timeout-seconds.batch',       '1800', 'int', 'Per-step ceiling in the BATCH lane — room for queue wait behind ~25 image generations at the measured p50 of 67 s.')
ON CONFLICT (config_key) DO NOTHING;

-- The single ceiling served neither lane; it is replaced, not kept beside them.
DELETE FROM studio_runtime_config WHERE config_key = 'run.step-timeout-seconds';
