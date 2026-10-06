-- ADR-065 — the append-only run trail records that a run happened and how it ended, never what it
-- matched.
--
-- `detail` was documented as a reason code and filled with the failed step's message: for a guard
-- refusal, the pack's reviewed answer, and on a REGULATED pack the crisis response itself — a
-- permanent record of a sensitive inference about a person, in the one table retention cannot touch.
--
-- Dropping the column removes the rows' existing values too. That is an edit of an append-only
-- trail, done deliberately and said out loud: the column never held what its comment promised, no
-- code reads it, and the local phase has no production trail to preserve. The row trigger guards
-- UPDATE and DELETE, not DDL, which is why this is a migration and not an UPDATE.
\c orazaka_studio_db

ALTER TABLE studio_run_audit DROP COLUMN IF EXISTS detail;
