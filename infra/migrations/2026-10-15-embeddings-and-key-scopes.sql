-- Embeddings and scoped API keys (ORO-ORAZAKA). Idempotent; run against the right database.
--
-- 1. krizaka_users_db: an API key may carry area:action scopes (comma-separated) that the edge enforces.
--    '' = the owner's full rights (every key created before).
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes VARCHAR(255) NOT NULL DEFAULT '';
