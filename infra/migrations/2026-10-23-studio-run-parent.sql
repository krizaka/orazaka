-- orazaka-studio#62 — a step calls a published Studio (kind STUDIO): the run it starts names its parent. A called run
-- holds nothing (its work is settled inside the parent's hold) and its outcome becomes the parent step's, found by
-- the step's job_id = the called run's id. One level only.
--
-- infra/initdb/80-studio.sql (orazaka-studio) carries the same column and index for a fresh database; the two must
-- stay in step. Additive and idempotent: safe before the code ships.
\c orazaka_studio_db

ALTER TABLE studio_run ADD COLUMN IF NOT EXISTS parent_run_id UUID REFERENCES studio_run(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_studio_run_parent ON studio_run(parent_run_id) WHERE parent_run_id IS NOT NULL;
