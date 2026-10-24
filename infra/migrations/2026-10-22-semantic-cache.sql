-- The semantic cache for an existing database (ai-engine#40) — orazaka-job-service
-- infra/initdb/30-jobs-config.sql carries the same table and row for a fresh one. OFF by default:
-- the row is disabled and a pack must declare orazaka.cache.mode. Idempotent.
\c orazaka_db

CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS semantic_cache_entry (
    id               BIGSERIAL    PRIMARY KEY,
    tenant_id        VARCHAR(255) NOT NULL,
    scope_guard_hash CHAR(64)     NOT NULL,
    model_tier       VARCHAR(100) NOT NULL,
    exact_key        CHAR(64)     NOT NULL,
    embedding        vector(1024),                 -- NULL for an entry kept for the exact tier only
    signature        TEXT         NOT NULL,        -- the turn's numbers and negations (TurnSignature)
    response         TEXT         NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ  NOT NULL,
    CONSTRAINT uq_semantic_cache_key UNIQUE (tenant_id, scope_guard_hash, model_tier, exact_key)
);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_expiry ON semantic_cache_entry (expires_at);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding
    ON semantic_cache_entry USING hnsw (embedding vector_cosine_ops);

INSERT INTO pipeline_interceptor_config (interceptor_key, display_label, execution_order, is_enabled, description) VALUES
('SemanticCacheInterceptor','Semantic Cache Interceptor',8, FALSE, 'Answers a repeated question from a cache before any model (ai-engine#40). OFF by default, and a pack must also declare orazaka.pipeline.cache.mode. Runs after the Refiner row (same order, created later), before the Router.')
ON CONFLICT (interceptor_key) DO NOTHING;
