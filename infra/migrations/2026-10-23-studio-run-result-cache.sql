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

-- On in dev for the deterministic document Studio (no model step: the same file gives the same signals), and for
-- compliance-check since its 2.0 (ADR-089 §4, orazaka-studio#80): its ruleset is resolved from the document's kind and
-- asOf, so an identical run answers with the recorded report, judgment included.
INSERT INTO studio_runtime_config (config_key, config_value, value_type, description) VALUES
 ('run.result-cache.studios', 'document-authenticity,compliance-check', 'list', 'Studios whose identical runs (same actor, version, inputs, configuration) answer from the recorded result, with no hold and no model call (orazaka-studio#61). Only a Studio whose result is a function of its inputs and version: a deterministic one, or compliance-check, whose ruleset is pinned by (kind, asOf) and whose judgment is recorded (ADR-089 §4). Empty = off.')
ON CONFLICT (config_key) DO NOTHING;

-- An environment migrated before ADR-089 cut 5 keeps its list and gains compliance-check once (re-runnable).
UPDATE studio_runtime_config
   SET config_value = CASE WHEN config_value = '' THEN 'compliance-check' ELSE config_value || ',compliance-check' END
 WHERE config_key = 'run.result-cache.studios'
   AND NOT ('compliance-check' = ANY (string_to_array(replace(config_value, ' ', ''), ',')));
