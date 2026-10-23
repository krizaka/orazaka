-- orazaka-studio#61 — the exact result cache: an identical run (same actor, Studio version, inputs and installation
-- configuration) answers from the recorded result, with no hold and no model call, and names the run it copies.
--
-- infra/initdb/80-studio.sql (orazaka-studio) carries the same columns, index and setting for a fresh database; the two
-- must stay in step. Additive and idempotent: safe before the code ships.
\c orazaka_studio_db

ALTER TABLE studio_run ADD COLUMN IF NOT EXISTS input_fingerprint VARCHAR(64);
ALTER TABLE studio_run ADD COLUMN IF NOT EXISTS cached_from UUID;

CREATE INDEX IF NOT EXISTS idx_studio_run_result_cache
    ON studio_run (actor_id, studio_key, blueprint_version, input_fingerprint)
    WHERE status = 'SUCCEEDED' AND cached_from IS NULL;

-- On in dev for the one deterministic document Studio (no model step: the same file gives the same signals).
-- compliance-check is not listed: its judgment step asks a model.
INSERT INTO studio_runtime_config (config_key, config_value, value_type, description) VALUES
 ('run.result-cache.studios', 'document-authenticity', 'list', 'Studios whose identical runs (same actor, version, inputs, configuration) answer from the recorded result, with no hold and no model call (orazaka-studio#61). Deterministic Studios only; empty = off.')
ON CONFLICT (config_key) DO NOTHING;
