-- What the Studio form's model picker shows beside each model, for an existing database —
-- orazaka-job-service infra/initdb/30-jobs-config.sql carries the same columns and rows for a fresh one.
--
-- typical_seconds: seconds for one run, command to file, measured on this setup (content/docs/measured-runs.md, 2026-10-15).
-- price_cents: US cents for one run at the provider's rate card; NULL when it runs on the operator's own hardware.
-- A model never measured stays NULL: the picker says nothing rather than guessing. Idempotent.
\c orazaka_db

ALTER TABLE orazaka_models ADD COLUMN IF NOT EXISTS typical_seconds INT;
ALTER TABLE orazaka_models ADD COLUMN IF NOT EXISTS price_cents INT;
ALTER TABLE orazaka_models DROP CONSTRAINT IF EXISTS ck_models_measures;
ALTER TABLE orazaka_models ADD CONSTRAINT ck_models_measures
  CHECK ((typical_seconds IS NULL OR typical_seconds >= 0) AND (price_cents IS NULL OR price_cents >= 0));

UPDATE orazaka_models SET typical_seconds = 62 WHERE model_name = 'flux-2-klein-4b';
UPDATE orazaka_models SET typical_seconds = 58 WHERE model_name = 'v1-5-pruned-emaonly';
UPDATE orazaka_models SET typical_seconds = 157 WHERE model_name = 'z-image-turbo';
UPDATE orazaka_models SET typical_seconds = 8, price_cents = 8 WHERE model_name = 'stable-diffusion-3.5-large';
UPDATE orazaka_models SET typical_seconds = 131, price_cents = 60 WHERE model_name = 'wan2-2-t2v-a14b';
