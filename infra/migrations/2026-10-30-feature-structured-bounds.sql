-- ADR-094 §4.6 (krizaka/orazaka-ai-engine#172): the most answers one structured-output call of a feature key may ask a
-- model for (the first plus the corrections that name the schema violation) is DATA an administrator edits, not a
-- constant a deploy changes. Additive and idempotent. Runs in orazaka_db.
--
-- The row `*` is the default of every feature without a row of its own; it is seeded here so a local install and a
-- deployed one start from the same number (2: one answer and one correction). The engine reads the row on every call
-- (not cached): the next call sees an edit. Out of attempts the call fails with a typed error, never a default value.
CREATE TABLE IF NOT EXISTS orazaka_feature_structured_bounds (
    feature_key  VARCHAR(120) PRIMARY KEY,
    max_attempts INT          NOT NULL CHECK (max_attempts BETWEEN 1 AND 5),
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO orazaka_feature_structured_bounds (feature_key, max_attempts)
VALUES ('*', 2)
ON CONFLICT (feature_key) DO NOTHING;
