-- ADR-093 (Code on the Mac, krizaka/orazaka#450): the data of the Studio turn of `code.issue-to-pr`. Additive and
-- idempotent. Runs in orazaka_db. The prices are the billing database's own file: 2026-10-27-pricebook-code-agent.sql.
--
-- 1. Routing is data (ADR-029). A feature key maps to registry models, best first; the Mac never names a model or a
--    provider for this feature. Local first (a sovereign install is the same Mac): `qwen2.5-coder:7b`, the registry's
--    local code default. A provider model is added only by a row an administrator inserts where the workspace opted in
--    (none is seeded). The engine's reader of this table is a follow-up of orazaka-ai-engine (until it lands, the code
--    turn resolves the `code` category default, which is the same model).
CREATE TABLE IF NOT EXISTS orazaka_feature_models (
    feature_key VARCHAR(120) NOT NULL,
    rank        INT          NOT NULL CHECK (rank >= 1),
    model_name  VARCHAR(255) NOT NULL REFERENCES orazaka_models (model_name) ON UPDATE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (feature_key, rank)
);

INSERT INTO orazaka_feature_models (feature_key, rank, model_name)
SELECT 'agent.code.issue-to-pr', 1, model_name FROM orazaka_models WHERE model_name = 'qwen2.5-coder:7b'
ON CONFLICT (feature_key, rank) DO NOTHING;

-- 2. The roles of the tools the Mac runs (ADR-091, ADR-093 §4). The engine offers a client tool only to an actor holding
--    one of its roles, on every turn; a tool with no row is for administrators only. The closed list of the code agent:
--    four read tools, `propose_diff` (it produces a pending diff, it writes nothing) and `run_check` (by name, from the
--    list the user confirmed). The entitlement of the pack is checked separately, on every run, by the Studio.
INSERT INTO platform_tool_permissions (tool_id, required_role) VALUES
('read_file',    'ROLE_USER'),
('list_dir',     'ROLE_USER'),
('search_text',  'ROLE_USER'),
('outline',      'ROLE_USER'),
('propose_diff', 'ROLE_USER'),
('run_check',    'ROLE_USER')
ON CONFLICT (tool_id, required_role) DO NOTHING;
