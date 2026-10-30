-- ADR-029 / ADR-094 §4.1 (krizaka/orazaka-ai-engine#169): the most tool rounds one turn of a feature key may take is
-- DATA an administrator edits, not a constant a deploy changes. Additive and idempotent. Runs in orazaka_db.
--
-- The row `*` is the default of every feature without a row of its own; it is seeded here so a local install and a
-- deployed one start from the same number (8, the value the engine used as a constant until now). The engine reads
-- the row on every turn (not cached): the next turn sees an edit. Exceeding the bound ends the turn with an explicit
-- reason (tool_rounds_exceeded), never a silent cut.
CREATE TABLE IF NOT EXISTS orazaka_feature_tool_bounds (
    feature_key     VARCHAR(120) PRIMARY KEY,
    max_tool_rounds INT          NOT NULL CHECK (max_tool_rounds BETWEEN 1 AND 32),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO orazaka_feature_tool_bounds (feature_key, max_tool_rounds)
VALUES ('*', 8)
ON CONFLICT (feature_key) DO NOTHING;
