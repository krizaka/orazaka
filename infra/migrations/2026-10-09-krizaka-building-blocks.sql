-- 2026-10-09 — Krizaka building blocks (ADR-073): the users and billing contexts keep their data
-- under neutral names.
--
-- A fresh `orazaka start` creates them from krizaka/krizaka-users/infra/initdb/10-identity.sql and
-- krizaka/krizaka-billing/infra/initdb/70-billing.sql and needs nothing here. This script moves an
-- EXISTING local database without losing its rows:
--
--   docker exec -i <postgres> psql -U <superuser> -d postgres < infra/migrations/2026-10-09-krizaka-building-blocks.sql
--
-- Run it with every service stopped: a database cannot be renamed while anything is connected.
-- Renaming a role clears an MD5 password, so `node scripts/apply-db-role-passwords.mjs` runs after.

\set ON_ERROR_STOP on

-- ── Roles and databases (from the postgres database) ──────────────────────────────────────────
ALTER ROLE orazaka_identity RENAME TO krizaka_users;
ALTER DATABASE orazaka_identity_db RENAME TO krizaka_users_db;
ALTER ROLE orazaka_billing RENAME TO krizaka_billing;
ALTER DATABASE orazaka_billing_db RENAME TO krizaka_billing_db;

-- ── Users tables: the product prefix goes ─────────────────────────────────────────────────────
\c krizaka_users_db
BEGIN;
ALTER TABLE orazaka_rate_limit_tiers RENAME TO rate_limit_tiers;
ALTER TABLE orazaka_users RENAME TO users;
ALTER TABLE orazaka_authorities RENAME TO authorities;
ALTER TABLE orazaka_verification_tokens RENAME TO verification_tokens;
ALTER TABLE orazaka_user_interceptions RENAME TO user_interceptions;
ALTER TABLE orazaka_user_profiles RENAME TO user_profiles;
ALTER TABLE orazaka_api_keys RENAME TO api_keys;
ALTER TABLE orazaka_password_resets RENAME TO password_resets;
ALTER TABLE orazaka_rate_limits RENAME TO rate_limits;
ALTER TABLE orazaka_user_model_prefs RENAME TO user_model_prefs;
ALTER INDEX idx_orazaka_rate_limits_default RENAME TO idx_rate_limits_default;
COMMIT;

-- RabbitMQ: the building blocks now own their queues under krizaka.* names
-- (krizaka.notifications.*, krizaka.billing.*). The old orazaka.events.user.notifications,
-- orazaka.events.password.notifications, orazaka.notifications.requests, orazaka.events.billing,
-- orazaka.events.billing.unmetered queues (and their .dlq) are no longer consumed: drain or delete
-- them in the RabbitMQ console once empty.
