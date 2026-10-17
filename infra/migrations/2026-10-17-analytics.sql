-- Product analytics (ADR-081, RFC #174) on orazaka_knowledge_db. Idempotent.
-- The same DDL as orazaka-knowledge-service infra/initdb/40-knowledge.sql (fresh databases);
-- this script brings an existing one up to it: `node scripts/dev-deploy.mjs analytics`.
-- Needs the recommender's tables (2026-10-15-recommendations.sql) — the view reads them.
DO $$ BEGIN
    CREATE TYPE analytics_value_unit AS ENUM ('none', 'percent', 'seconds', 'cents', 'count');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE analytics_kind_source AS ENUM ('analytics', 'recommender');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS analytics_event_kind (
    tenant_id VARCHAR(64) NOT NULL,
    kind VARCHAR(32) NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,31}$'),
    unit analytics_value_unit NOT NULL DEFAULT 'none',
    source analytics_kind_source NOT NULL DEFAULT 'analytics',
    description TEXT NOT NULL,
    PRIMARY KEY (tenant_id, kind)
);

CREATE TABLE IF NOT EXISTS analytics_event (
    tenant_id VARCHAR(64) NOT NULL,
    event_id VARCHAR(64) NOT NULL,
    subject_id VARCHAR(128) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    item_id VARCHAR(64),
    owner_id VARCHAR(64),
    value DOUBLE PRECISION,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, event_id)
);
CREATE INDEX IF NOT EXISTS analytics_event_time_idx ON analytics_event (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS analytics_event_subject_idx ON analytics_event (tenant_id, subject_id, occurred_at);
CREATE INDEX IF NOT EXISTS analytics_event_owner_idx ON analytics_event (tenant_id, owner_id, occurred_at);

CREATE OR REPLACE VIEW analytics_event_all AS
    SELECT tenant_id, event_id, subject_id, kind, item_id, owner_id, value, occurred_at
      FROM analytics_event
    UNION ALL
    SELECT e.tenant_id, e.event_id, e.user_id, lower(e.kind::text), e.item_id,
           COALESCE(e.creator_id, i.creator_id), e.watched_pct::double precision, e.occurred_at
      FROM reco_event e
      LEFT JOIN reco_item i ON i.tenant_id = e.tenant_id AND i.item_id = e.item_id;

CREATE TABLE IF NOT EXISTS analytics_settings (
    tenant_id VARCHAR(64) NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    settings JSONB NOT NULL,
    reason TEXT NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, version)
);

INSERT INTO analytics_event_kind (tenant_id, kind, unit, source, description) VALUES
    ('*', 'view', 'percent', 'recommender', 'An item was viewed; the value is the share watched.'),
    ('*', 'like', 'none', 'recommender', 'An item was liked.'),
    ('*', 'save', 'none', 'recommender', 'An item was saved.'),
    ('*', 'share', 'none', 'recommender', 'An item was shared.'),
    ('*', 'tip', 'none', 'recommender', 'A creator was tipped on an item.'),
    ('*', 'unlock', 'none', 'recommender', 'A paid item was unlocked.'),
    ('*', 'follow', 'none', 'recommender', 'A creator was followed.'),
    ('*', 'unfollow', 'none', 'recommender', 'A creator was unfollowed.'),
    ('*', 'skip', 'none', 'recommender', 'An item was skipped.'),
    ('*', 'report', 'none', 'recommender', 'An item was reported.'),
    ('*', 'session_start', 'none', 'analytics', 'A person opened the product.'),
    ('*', 'watch', 'percent', 'analytics', 'A person left an item; the value is the share watched.'),
    ('*', 'talk', 'seconds', 'analytics', 'A voice conversation ended; the value is its length.'),
    ('*', 'batch_open', 'none', 'analytics', 'A batch of candidates was opened.'),
    ('*', 'batch_answer', 'none', 'analytics', 'A candidate of a batch was answered.'),
    ('*', 'intro_start', 'none', 'analytics', 'An introduction was started.'),
    ('*', 'report_filed', 'none', 'analytics', 'A person was reported.'),
    ('*', 'purchase', 'cents', 'analytics', 'Something was bought; the value is its price.')
ON CONFLICT (tenant_id, kind) DO NOTHING;

INSERT INTO analytics_settings (tenant_id, version, settings, reason, created_by) VALUES ('*', 1, '{
  "retentionDays": 180, "minAudience": 3, "maxRangeDays": 366, "cohortWeeks": 8,
  "funnelWindowHours": 168, "topItems": 10,
  "positiveKinds": ["like", "save", "share", "tip", "unlock", "batch_answer", "intro_start", "purchase"]
}', 'ADR-081: the first analytics parameters', 'migration')
ON CONFLICT (tenant_id, version) DO NOTHING;
