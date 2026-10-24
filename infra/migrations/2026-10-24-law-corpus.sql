-- ADR-089 cut 2 (orazaka-job-service#67): the law corpus tables, the settings' default and bounds, the law.* settings and
-- the research sources law-corpus and donnees-quebec. orazaka-job-service infra/initdb/30-jobs-config.sql carries the
-- same block for a fresh database; the two must stay in step. Additive and idempotent (IF NOT EXISTS, ON CONFLICT DO
-- NOTHING, constraints added once); the corpus stays off (law.corpus.enabled false, law.lecture.enabled false) and both
-- sources disabled. Needs the research tables (2026-10-23-research-tables.sql). Runs in orazaka_db.
-- ============================================================================
-- LAW CORPUS (ADR-089 §2 and §10, orazaka-job-service#67) — the dated, hashed text of the law the engine derives its
-- checks from. Beside the research tables, in this service's database (connection budget, ADR-083). Off until
-- law.corpus.enabled is true; the sources law-corpus and donnees-quebec are seeded disabled. The same block is the
-- dev-deploy migration `law-corpus` (krizaka/orazaka): additive and idempotent, the two must stay in step.
-- ============================================================================

-- Settings carry their default and bounds, like studio_runtime_config. A row without a default is as before; a row
-- with one is checked by the database itself: an out-of-range int, a list longer than max_items or a boolean that is
-- not true/false is refused whoever writes it (the admin API, a script, a console).
ALTER TABLE orazaka_runtime_config
    ADD COLUMN IF NOT EXISTS default_value VARCHAR(255),
    ADD COLUMN IF NOT EXISTS min_value     BIGINT,
    ADD COLUMN IF NOT EXISTS max_value     BIGINT,
    ADD COLUMN IF NOT EXISTS max_items     INTEGER;

CREATE OR REPLACE FUNCTION orazaka_config_value_ok(vtype TEXT, val TEXT, lo BIGINT, hi BIGINT, items INTEGER)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE vtype
        WHEN 'int' THEN CASE WHEN val ~ '^-?[0-9]{1,18}$'
            THEN val::bigint BETWEEN COALESCE(lo, -9223372036854775807) AND COALESCE(hi, 9223372036854775807)
            ELSE FALSE END
        WHEN 'boolean' THEN val IN ('true', 'false')
        WHEN 'list' THEN items IS NULL OR cardinality(string_to_array(val, ',')) <= items
        ELSE TRUE
    END
$fn$;

DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_orazaka_runtime_config_bounds') THEN
        ALTER TABLE orazaka_runtime_config ADD CONSTRAINT ck_orazaka_runtime_config_bounds CHECK (
            (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
            AND (max_items IS NULL OR max_items >= 0));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_orazaka_runtime_config_value') THEN
        ALTER TABLE orazaka_runtime_config ADD CONSTRAINT ck_orazaka_runtime_config_value CHECK (
            default_value IS NULL
            OR (orazaka_config_value_ok(value_type, config_value, min_value, max_value, max_items)
                AND orazaka_config_value_ok(value_type, default_value, min_value, max_value, max_items)));
    END IF;
END
$do$;

-- One row per act or regulation.
CREATE TABLE IF NOT EXISTS law_instrument (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction          VARCHAR(10)  NOT NULL CHECK (jurisdiction IN ('CA','QC','FR','BE-WAL')),
    -- CCQ-1991, C-11, T-0.1, T-15.01-r3, E-15, SOR-91-45.
    code                  VARCHAR(60)  NOT NULL,
    title_fr              TEXT,
    title_en              TEXT,
    -- The address every citation shows, with {ref} for the article (e.g. ...?code=se:{ref}).
    official_url_template TEXT         NOT NULL,
    source_key            VARCHAR(80)  NOT NULL REFERENCES research_source(source_key) ON UPDATE CASCADE,
    licence               TEXT,
    access_note           TEXT,
    UNIQUE (jurisdiction, code)
);

-- Every import is traceable, a manual one included: who, which file, its hash.
CREATE TABLE IF NOT EXISTS law_import (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key          VARCHAR(80)  NOT NULL REFERENCES research_source(source_key) ON UPDATE CASCADE,
    mode                VARCHAR(10)  NOT NULL CHECK (mode IN ('AUTOMATED','MANUAL')),
    dataset_url         TEXT,
    dataset_etag        TEXT,
    dataset_sha256      CHAR(64)     CHECK (dataset_sha256 ~ '^[0-9a-f]{64}$'),
    consolidated_to     DATE,
    imported_by         VARCHAR(255),
    started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    articles_new        INT          NOT NULL DEFAULT 0 CHECK (articles_new >= 0),
    articles_changed    INT          NOT NULL DEFAULT 0 CHECK (articles_changed >= 0),
    articles_unchanged  INT          NOT NULL DEFAULT 0 CHECK (articles_unchanged >= 0),
    -- ADR-089 names the column, not its values: RUNNING until finished_at is set, then SUCCEEDED or FAILED.
    status              VARCHAR(10)  NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
    CONSTRAINT ck_law_import_manual_traceable
        CHECK (mode = 'AUTOMATED' OR (imported_by IS NOT NULL AND dataset_sha256 IS NOT NULL))
);

-- The key is the period, not the text: a reverted amendment brings back an earlier text, so its hash is already a row
-- and the new period must still be a new row. A changed text is a new row; the previous row gets in_force_to. The hash is the SHA-256 of the article's text (label
-- and subsections; the historical note is stored, not hashed), NFC, whitespace collapsed. asOf selects the version
-- with in_force_from <= asOf < in_force_to.
CREATE TABLE IF NOT EXISTS law_article_version (
    instrument_id  UUID         NOT NULL REFERENCES law_instrument(id),
    ref            VARCHAR(40)  NOT NULL,
    language       VARCHAR(2)   NOT NULL CHECK (language IN ('fr','en')),
    in_force_from  DATE         NOT NULL,
    in_force_to    DATE,
    heading_path   TEXT,
    text           TEXT         NOT NULL,
    content_hash   CHAR(64)     NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    history_note   TEXT,
    import_id      UUID         NOT NULL REFERENCES law_import(id),
    first_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (instrument_id, ref, language, in_force_from),
    CONSTRAINT ck_law_article_version_span CHECK (in_force_to IS NULL OR in_force_to >= in_force_from)
);
-- At most one open version of an article: the importer closes the old row (in_force_to) before it writes the new one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_law_article_version_open
    ON law_article_version (instrument_id, ref, language) WHERE in_force_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_law_article_version_as_of
    ON law_article_version (instrument_id, ref, language, in_force_from DESC);
CREATE INDEX IF NOT EXISTS idx_law_article_version_hash
    ON law_article_version (instrument_id, ref, language, content_hash);
CREATE INDEX IF NOT EXISTS idx_law_article_version_import ON law_article_version (import_id);

-- The cache of stage 2: the articles kept for a kind, with the verified claims, redone when one of them changes.
CREATE TABLE IF NOT EXISTS law_retrieval (
    jurisdiction  VARCHAR(10) NOT NULL,
    kind_id       VARCHAR(80) NOT NULL,
    -- The language of the claims: a French retrieval is never served for an English request.
    language      VARCHAR(2)  NOT NULL CHECK (language IN ('fr','en')),
    -- The in_force_from of the newest article it used.
    as_of_bucket  DATE        NOT NULL,
    -- [{instrument, ref, language, contentHash}]
    articles      JSONB       NOT NULL DEFAULT '[]',
    -- ADR-087 claims.
    claims        JSONB       NOT NULL DEFAULT '[]',
    run_id        UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    stale         BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (jurisdiction, kind_id, language, as_of_bucket)
);

-- A proposal never leaves this table except through promotion (stage 5). An edit is a new proposal_revision.
CREATE TABLE IF NOT EXISTS rule_proposal (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction        VARCHAR(10)  NOT NULL,
    kind_id             VARCHAR(80)  NOT NULL,
    rule_id             VARCHAR(120) NOT NULL,
    proposal_revision   INT          NOT NULL DEFAULT 1 CHECK (proposal_revision >= 1),
    rule                JSONB        NOT NULL,
    law                 JSONB        NOT NULL,
    derivation_run_id   UUID,
    status              VARCHAR(20)  NOT NULL DEFAULT 'PROPOSED' CHECK (status IN
        ('PROPOSED','REJECTED_AUTO','APPROVED','REJECTED','PROMOTED','SUPERSEDED')),
    vet_report          JSONB,
    reviewed_by         VARCHAR(255),
    reviewed_at         TIMESTAMPTZ,
    decision_note       TEXT,
    packs_pr_url        TEXT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (jurisdiction, kind_id, rule_id, proposal_revision),
    CONSTRAINT ck_rule_proposal_reviewed
        CHECK (status NOT IN ('APPROVED','REJECTED','PROMOTED') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_rule_proposal_queue ON rule_proposal (status, kind_id);

-- Unsupported and unknown kinds, counted: never a document, never its content (ADR-064).
CREATE TABLE IF NOT EXISTS kind_demand (
    jurisdiction  VARCHAR(10) NOT NULL,
    -- A kind id, or UNKNOWN.
    kind_id       VARCHAR(80) NOT NULL,
    count         BIGINT      NOT NULL DEFAULT 0 CHECK (count >= 0),
    first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (jurisdiction, kind_id)
);

-- The law settings (ADR-089 §10). Every switch is off; the numbers are first values, not measurements.
INSERT INTO orazaka_runtime_config
    (config_key, config_value, value_type, description, default_value, min_value, max_value, max_items) VALUES
('law.corpus.enabled', 'false', 'boolean', 'Master switch of the law corpus (imports, the law-corpus source, lookupStatute on the corpus).', 'false', NULL, NULL, NULL),
('law.import.instruments', 'QC:CCQ-1991,QC:C-11,QC:T-15.01,QC:T-15.01-r1.1,QC:T-15.01-r3,QC:T-0.1,QC:T-0.1-r2,QC:P-39.1,CA:E-15,CA:SOR-91-45', 'list', 'The targeted instruments; nothing else is stored.', 'QC:CCQ-1991,QC:C-11,QC:T-15.01,QC:T-15.01-r1.1,QC:T-15.01-r3,QC:T-0.1,QC:T-0.1-r2,QC:P-39.1,CA:E-15,CA:SOR-91-45', NULL, NULL, 200),
('law.import.max-article-chars', '20000', 'int', 'Longest article text stored; a longer one fails the import loudly.', '20000', 1000, 200000, NULL),
('law.identify.min-signal-weight', '2', 'int', 'Signal weight a detected kind needs to win over the declared one.', '2', 1, 10, NULL),
('law.identify.model-fallback', 'true', 'boolean', 'Ask the model to choose among the kinds when signals are ambiguous (quote checked).', 'true', NULL, NULL, NULL),
('law.identify.classify-max-tokens', '200', 'int', 'Output cap of the classify call.', '200', 50, 1000, NULL),
('law.retrieval.max-articles', '40', 'int', 'Articles one retrieval may keep for a kind.', '40', 1, 200, NULL),
('law.retrieval.max-age-days', '90', 'int', 'A cached retrieval is redone after this even if no cited article changed (new articles may apply).', '90', 7, 365, NULL),
('law.derive.max-rules-per-kind', '30', 'int', 'Rules one derivation may propose.', '30', 1, 100, NULL),
('law.derive.max-credits', '2000', 'int', 'Credit cap of one derivation run, declared into the ADR-088 run budget; 0 = derivation off.', '2000', 0, 100000, NULL),
('law.review.min-golden-cases', '3', 'int', 'Golden documents a kind needs before promotion (one clean, one with errors, the blank form).', '3', 2, 50, NULL),
('law.lecture.enabled', 'false', 'boolean', 'Allow the unaudited lecture for unsupported kinds.', 'false', NULL, NULL, NULL),
('law.lecture.max-credits', '60', 'int', 'Hold of one lecture.', '60', 0, 1000, NULL)
ON CONFLICT (config_key) DO NOTHING;

-- The two sources of the corpus, disabled: law-corpus reads law_article_version (no network, so no pattern);
-- donnees-quebec downloads the Données Québec zips. legisquebec stays disabled above; its URL is the one every
-- citation shows. The Données Québec licence is krizaka/orazaka#393.
INSERT INTO research_source (source_key, kind, provider, base_url, allow_patterns, freshness_seconds, enabled) VALUES
('law-corpus', 'OFFICIAL', 'law-corpus', NULL, '{}', 86400, FALSE),
('donnees-quebec', 'OFFICIAL', 'donnees-quebec', 'https://www.donneesquebec.ca',
 '{www.donneesquebec.ca/recherche/dataset/c8433300-f752-4815-8ea2-69cad416dd80/**}', 604800, FALSE)
ON CONFLICT (source_key) DO NOTHING;
