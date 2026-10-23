-- ADR-087 slice 1 (orazaka-job-service#62, orazaka-ai-engine#60): the grounded-research tables, settings and sources.
-- orazaka-job-service infra/initdb/30-jobs-config.sql carries the same block for a fresh database; the two must stay in
-- step. Additive and idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING); research stays off (research.enabled false)
-- and every source disabled. Runs in orazaka_db.
-- ============================================================================
-- GROUNDED RESEARCH (ADR-087, orazaka-job-service#62) — the engine reads a source and cites it.
-- Sources are rows the administrator manages; what was read is stored once (URL + content hash); every search or
-- fetch leaves an audit row, never the query or the path in clear (ADR-064). Off until research.enabled is true.
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_source (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key           VARCHAR(80)  NOT NULL UNIQUE,
    kind                 VARCHAR(20)  NOT NULL CHECK (kind IN ('SEARCH','FETCH','OFFICIAL','CODE_HOST','MCP')),
    -- A vendor is a value, never a type: searxng, brave, http, justice-laws, canlii, legisquebec, registraire, github, mcp.
    provider             VARCHAR(40)  NOT NULL,
    scope                VARCHAR(10)  NOT NULL DEFAULT 'GLOBAL' CHECK (scope IN ('GLOBAL','PACK','STUDIO','ACTOR')),
    scope_ref            VARCHAR(255),
    base_url             VARCHAR(1000),
    -- host[/path] globs (* within a segment run, ** across); empty = nothing is allowed (closed by default).
    allow_patterns       TEXT[]       NOT NULL DEFAULT '{}',
    deny_patterns        TEXT[]       NOT NULL DEFAULT '{}',
    allow_http           BOOLEAN      NOT NULL DEFAULT FALSE,
    freshness_seconds    INT          NOT NULL DEFAULT 86400 CHECK (freshness_seconds >= 0),
    rate_per_minute      INT          NOT NULL DEFAULT 30 CHECK (rate_per_minute > 0),
    allows_personal_data BOOLEAN      NOT NULL DEFAULT FALSE,
    -- The id of an encrypted credential (ADR-054), never the secret.
    credential_ref       VARCHAR(255),
    verify_mode          VARCHAR(10)  CHECK (verify_mode IN ('MARK','STRICT')),
    enabled              BOOLEAN      NOT NULL DEFAULT FALSE,
    created_by           VARCHAR(255),
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_research_source_scope_ref CHECK ((scope = 'GLOBAL') = (scope_ref IS NULL))
);

CREATE TABLE IF NOT EXISTS research_document (
    url            TEXT        NOT NULL,
    content_hash   CHAR(64)    NOT NULL,
    source_id      UUID        REFERENCES research_source(id) ON DELETE SET NULL,
    fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    http_status    SMALLINT    NOT NULL,
    content_type   VARCHAR(120),
    bytes          INT         NOT NULL,
    etag           TEXT,
    last_modified  TEXT,
    title          TEXT,
    text           TEXT        NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (url, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_research_document_fresh ON research_document (url, expires_at DESC);

CREATE TABLE IF NOT EXISTS research_fetch (
    id             BIGSERIAL   PRIMARY KEY,
    at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id       VARCHAR(255),
    run_id         UUID,
    chat_id        VARCHAR(255),
    source_id      UUID        REFERENCES research_source(id) ON DELETE SET NULL,
    operation      VARCHAR(10) NOT NULL CHECK (operation IN ('SEARCH','FETCH','LOOKUP','ROBOTS')),
    host           VARCHAR(255),
    path_hash      CHAR(64),
    http_status    SMALLINT,
    bytes          INT,
    duration_ms    INT,
    cache_hit      BOOLEAN     NOT NULL DEFAULT FALSE,
    refused_reason VARCHAR(20) CHECK (refused_reason IN
        ('SSRF','SCHEME','ROBOTS','ALLOWLIST','RATE','SIZE','TIMEOUT','CONSENT','CONTENT_TYPE','REDIRECTS','DISABLED','HTTP_ERROR'))
);
CREATE INDEX IF NOT EXISTS idx_research_fetch_at ON research_fetch (at DESC);
CREATE INDEX IF NOT EXISTS idx_research_fetch_source ON research_fetch (source_id, at DESC);

CREATE TABLE IF NOT EXISTS research_consent (
    actor_id    VARCHAR(255) NOT NULL,
    source_id   UUID         NOT NULL REFERENCES research_source(id) ON DELETE CASCADE,
    purpose     TEXT         NOT NULL,
    granted_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ,
    PRIMARY KEY (actor_id, source_id, granted_at)
);

-- The research settings. Off by default; production search stays off until SearXNG is validated (ADR-087 review).
-- First values, not measurements: slice 5 measures latency and cost before any default changes.
INSERT INTO orazaka_runtime_config (config_key, config_value, value_type, description) VALUES
('research.enabled', 'false', 'boolean', 'Master switch of grounded research (ADR-087).'),
('research.max-searches', '3', 'int', 'Searches per answer, declared into the run budget of ADR-088.'),
('research.max-fetches', '8', 'int', 'Page fetches per answer, declared into the run budget of ADR-088.'),
('research.fetch.timeout-ms', '10000', 'int', 'Connect + read time limit of one fetch.'),
('research.fetch.max-bytes', '2097152', 'int', 'Largest body read before extraction (2 MB).'),
('research.fetch.max-redirects', '3', 'int', 'Redirect hops followed, each one checked again.'),
('research.fetch.per-host-per-minute', '30', 'int', 'Fetches per host and minute, per instance.'),
('research.fetch.content-types', 'text/html,application/xhtml+xml,text/plain,application/xml', 'string', 'Content types read; PDF text comes in a later slice.'),
('research.quote.max-chars', '300', 'int', 'Longest quoted passage in a citation.'),
('research.verify.mode', 'MARK', 'string', 'MARK keeps an unverified claim as TO_VALIDATE; STRICT drops it.'),
('research.cache.default-freshness-seconds', '86400', 'int', 'Cache lifetime when a source sets none.'),
('research.user-agent', 'OrazakaResearch/0.1 (+https://www.orazaka.com)', 'string', 'The honest user agent of every research request.')
ON CONFLICT (config_key) DO NOTHING;

-- The first sources, all disabled: the administrator turns one on. LégisQuébec and the Registraire stay off until
-- their access conditions are validated (krizaka/orazaka#393).
INSERT INTO research_source (source_key, kind, provider, base_url, allow_patterns, freshness_seconds, enabled) VALUES
('justice-laws', 'OFFICIAL', 'justice-laws', 'https://laws-lois.justice.gc.ca', '{laws-lois.justice.gc.ca/**}', 604800, FALSE),
('canlii', 'OFFICIAL', 'canlii', 'https://api.canlii.org', '{api.canlii.org/**,www.canlii.org/**}', 604800, FALSE),
('legisquebec', 'OFFICIAL', 'legisquebec', 'https://www.legisquebec.gouv.qc.ca', '{www.legisquebec.gouv.qc.ca/**}', 604800, FALSE),
('registraire', 'OFFICIAL', 'registraire', 'https://www.registreentreprises.gouv.qc.ca', '{www.registreentreprises.gouv.qc.ca/**}', 604800, FALSE),
('github-krizaka', 'CODE_HOST', 'github', 'https://api.github.com', '{api.github.com/repos/krizaka/**,github.com/krizaka/**}', 3600, FALSE)
ON CONFLICT (source_key) DO NOTHING;

-- The verifier of grounded research (ADR-087 slice 2): OFF until the grounding flag of slice 5 turns it on per request.
INSERT INTO pipeline_interceptor_config (interceptor_key, display_label, execution_order, is_enabled, description) VALUES
('CitationVerifierInterceptor','Citation Verifier Interceptor',12, FALSE, 'Checks every claim of a grounded answer against what research read (ADR-087). OFF by default.')
ON CONFLICT (interceptor_key) DO NOTHING;
