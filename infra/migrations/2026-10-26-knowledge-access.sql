-- orazaka-ai-engine#107 (ADR-091): access is enforced at retrieval and at the tool, per tenant, role and document.
-- Two databases, two parts; additive and idempotent, applied before the engine that reads them is deployed.
--
-- orazaka-knowledge-service infra/initdb/40-knowledge.sql and orazaka-ai-engine infra/initdb/60-governance.sql carry
-- the same DDL for a fresh database; the three must stay in step.

-- ── orazaka_knowledge_db ───────────────────────────────────────────────────────────────────────────────────────────
\c orazaka_knowledge_db

ALTER TABLE orazaka_tools_rag_source ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64);
ALTER TABLE orazaka_tools_rag_source ADD COLUMN IF NOT EXISTS acl_principals TEXT[] NOT NULL DEFAULT '{}';

-- What exists keeps the access it effectively had, and no more: a user's own source is theirs (a tenant of one, readable
-- by its owner alone); a platform-wide source (no user) becomes the platform's ('*') and stays readable by any signed-in
-- user. Narrow either with the ACL endpoint.
UPDATE orazaka_tools_rag_source SET tenant_id = COALESCE(user_id, '*') WHERE tenant_id IS NULL;
UPDATE orazaka_tools_rag_source SET acl_principals = '{role:ROLE_USER}'
 WHERE user_id IS NULL AND acl_principals = '{}';
ALTER TABLE orazaka_tools_rag_source ALTER COLUMN tenant_id SET NOT NULL;

-- The same text may be indexed by two tenants.
ALTER TABLE orazaka_tools_rag_source DROP CONSTRAINT IF EXISTS unique_tool_content;
ALTER TABLE orazaka_tools_rag_source ADD CONSTRAINT unique_tool_content UNIQUE (tenant_id, tool_id, content);
CREATE INDEX IF NOT EXISTS idx_tools_rag_source_tenant ON orazaka_tools_rag_source(tenant_id, tool_id);

-- Every refused read: who, which resource, why. Never the query or the content (ADR-064).
CREATE TABLE IF NOT EXISTS knowledge_access_audit (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tenant_id VARCHAR(64),
    subject VARCHAR(255),
    action VARCHAR(32) NOT NULL,
    resource_kind VARCHAR(32) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    reason VARCHAR(64) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_access_audit_time ON knowledge_access_audit(occurred_at);

-- Vectors already indexed carry no tenant or ACL metadata: they would match no filter, so nothing is served from them.
-- Mark every source for indexing again.
UPDATE orazaka_tools_rag_source SET ingested = FALSE;

-- ── orazaka_db ─────────────────────────────────────────────────────────────────────────────────────────────────────
\c orazaka_db

-- The roles an administrator granted a tool (ADR-091). A tool with no row uses the roles it declared when it registered
-- (a tool that declared none is for administrators only). Read on every call: a change holds on the next request.
CREATE TABLE IF NOT EXISTS platform_tool_permissions (
    id SERIAL PRIMARY KEY,
    tool_id VARCHAR(255) NOT NULL,
    required_role VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_platform_tool_permissions UNIQUE (tool_id, required_role)
);
