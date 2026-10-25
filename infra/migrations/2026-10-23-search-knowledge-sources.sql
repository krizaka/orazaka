-- orazaka-ai-engine#59 (ADR-087 slice 0): the knowledge sources of the corpus search tool are keyed by its name, now
-- `searchKnowledge`. Copied, not moved: additive and idempotent (UNIQUE (tool_id, content)); `ingested` is reset so
-- the copies are indexed under the new key. The `searchWeb` rows go in the cleanup after the deploy.
\c orazaka_knowledge_db

INSERT INTO orazaka_tools_rag_source (tool_id, content, metadata, ingested, user_id)
SELECT 'searchKnowledge', content, metadata, FALSE, user_id
  FROM orazaka_tools_rag_source
 WHERE tool_id = 'searchWeb'
ON CONFLICT (tool_id, content) DO NOTHING;
