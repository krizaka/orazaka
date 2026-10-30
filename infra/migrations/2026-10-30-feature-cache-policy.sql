-- ADR-094 slice 5 (krizaka/orazaka-ai-engine#173): what of a feature's prompt a provider may cache is DATA an
-- administrator edits, not a constant a deploy changes. Additive and idempotent. Runs in orazaka_db.
--
-- The row `*` is the default of every feature without a row of its own; it is seeded SYSTEM_AND_TOOLS (the system
-- prompt and the tool definitions are the stable prefix, as before this table). A feature set to NONE is never cached.
-- A SENSITIVE turn is never cached whatever the row says: the engine does not ask. The engine reads the row on every
-- call (not cached): the next call sees an edit.
CREATE TABLE IF NOT EXISTS orazaka_feature_cache_policy (
    feature_key VARCHAR(120) PRIMARY KEY,
    strategy    VARCHAR(32)  NOT NULL CHECK (strategy IN ('NONE', 'SYSTEM_ONLY', 'SYSTEM_AND_TOOLS')),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO orazaka_feature_cache_policy (feature_key, strategy)
VALUES ('*', 'SYSTEM_AND_TOOLS')
ON CONFLICT (feature_key) DO NOTHING;
