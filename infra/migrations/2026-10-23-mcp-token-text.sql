-- orazaka-ai-engine#58: MCP server tokens are stored sealed; a sealed envelope outgrows VARCHAR(1000). Widening a
-- varchar to TEXT keeps every value and needs no rewrite of the rows. Idempotent. Runs in orazaka_db.
-- orazaka-job-service infra/initdb/30-jobs-config.sql declares TEXT for a fresh database.
ALTER TABLE user_mcp_servers ALTER COLUMN auth_token TYPE TEXT;
ALTER TABLE platform_mcp_servers ALTER COLUMN auth_token TYPE TEXT;
