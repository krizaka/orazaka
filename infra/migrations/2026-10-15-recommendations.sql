-- Recommendations (ADR-078, krizaka/orochia#226) on orazaka_knowledge_db. Idempotent.
-- The same DDL as orazaka-knowledge-service infra/initdb/40-knowledge.sql (fresh databases);
-- this script brings an existing one up to it: `node scripts/dev-deploy.mjs recommendations`.
-- pgvector must already be installed in the database (CREATE EXTENSION needs the cluster admin).
DO $$ BEGIN
    CREATE TYPE reco_event_kind AS ENUM
        ('VIEW', 'LIKE', 'SAVE', 'SHARE', 'TIP', 'UNLOCK', 'FOLLOW', 'UNFOLLOW', 'SKIP', 'REPORT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The parameters, versioned: a new version is a new row with its reason; the newest
-- row of the tenant wins, else the newest of '*' (every tenant).
CREATE TABLE IF NOT EXISTS reco_settings (
    tenant_id VARCHAR(64) NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    settings JSONB NOT NULL,
    reason TEXT NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, version)
);

CREATE TABLE IF NOT EXISTS reco_item (
    tenant_id VARCHAR(64) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    creator_id VARCHAR(64) NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    language VARCHAR(35),
    duration_seconds INTEGER,
    published_at TIMESTAMP WITH TIME ZONE NOT NULL,
    content_hash CHAR(64) NOT NULL,
    model VARCHAR(120),
    embedding vector(1024),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, item_id)
);
CREATE INDEX IF NOT EXISTS reco_item_embedding_idx ON reco_item USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS reco_item_published_idx ON reco_item (tenant_id, published_at DESC);
CREATE INDEX IF NOT EXISTS reco_item_creator_idx ON reco_item (tenant_id, creator_id);

CREATE TABLE IF NOT EXISTS reco_event (
    tenant_id VARCHAR(64) NOT NULL,
    event_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(128) NOT NULL,
    item_id VARCHAR(64),
    creator_id VARCHAR(64),
    kind reco_event_kind NOT NULL,
    watched_pct SMALLINT CHECK (watched_pct BETWEEN 0 AND 100),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, event_id),
    CHECK (item_id IS NOT NULL OR creator_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS reco_event_user_idx ON reco_event (tenant_id, user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS reco_event_item_idx ON reco_event (tenant_id, item_id);
CREATE INDEX IF NOT EXISTS reco_event_time_idx ON reco_event (tenant_id, occurred_at);

CREATE TABLE IF NOT EXISTS reco_user_profile (
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(128) NOT NULL,
    embedding vector(1024) NOT NULL,
    interactions INTEGER NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (tenant_id, user_id)
);

-- What was served, for measurement (CTR, offline evaluation) — ids only, purged after
-- the tenant's requestLogDays.
CREATE TABLE IF NOT EXISTS reco_request (
    request_id UUID PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(128),
    kind VARCHAR(16) NOT NULL,
    strategy VARCHAR(16) NOT NULL,
    item_ids TEXT[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX IF NOT EXISTS reco_request_time_idx ON reco_request (tenant_id, created_at);

-- Version 1 of the parameters, for every tenant (ADR-078 §5).
INSERT INTO reco_settings (tenant_id, version, settings, reason, created_by) VALUES ('*', 1, '{
  "enabled": true,
  "weights": {"similarity": 0.45, "coEngagement": 0.2, "freshness": 0.15, "followed": 0.12, "popularity": 0.08},
  "kindWeights": {"VIEW": 1, "LIKE": 3, "SAVE": 3, "SHARE": 2, "TIP": 5, "UNLOCK": 5,
                  "FOLLOW": 0, "UNFOLLOW": 0, "SKIP": -2, "REPORT": -5},
  "halfLifeHours": 168, "freshHalfLifeHours": 72, "mmrLambda": 0.7, "creatorCap": 2,
  "candidatePool": 100, "profileEvents": 200, "popularWindowDays": 7, "excludeSeen": true,
  "retentionDays": 180, "requestLogDays": 30, "minAudience": 3
}', 'ADR-078: the first transparent weights', 'migration')
ON CONFLICT (tenant_id, version) DO NOTHING;
