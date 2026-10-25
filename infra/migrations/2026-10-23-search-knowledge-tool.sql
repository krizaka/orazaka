-- orazaka-ai-engine#59 (ADR-087 slice 0): the corpus search tool is `searchKnowledge`; it was called `searchWeb`,
-- which told the model it could look things up live. Its cache settings are keyed by the tool name.
--
-- orazaka-job-service infra/initdb/30-jobs-config.sql seeds the new name for a fresh database; the two must stay in
-- step. Additive and idempotent: the old row stays until the engine that reads the new name is deployed everywhere,
-- then a cleanup removes it.
INSERT INTO platform_tool_configs (tool_id, cache_enabled, cache_ttl_seconds, rag_enabled, chunker_type, source_table)
SELECT 'searchKnowledge', cache_enabled, cache_ttl_seconds, rag_enabled, chunker_type, source_table
  FROM platform_tool_configs
 WHERE tool_id = 'searchWeb'
ON CONFLICT (tool_id) DO NOTHING;
