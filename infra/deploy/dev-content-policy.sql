-- =============================================================================
-- Orazaka dev (App Platform) — content policy configuration (docs/CONTENT_POLICY.md)
-- -----------------------------------------------------------------------------
-- The engine is permissive by default; the OPERATOR configures it. The hosted dev instance respects
-- DigitalOcean's acceptable-use terms: the video capability is served by DigitalOcean serverless
-- inference (Wan 2.2 A14B), which does not allow adult content, so a run that would reach it with such
-- a prompt is refused BEFORE the provider is called. Applied to orazaka_studio_db; idempotent.
-- minors_risk is refused always and is not a row.
-- =============================================================================
BEGIN;
-- One-off dev migration of the tables added to orazaka-studio's 80-studio.sql (idempotent).
-- Per tenant: what to do with a label. subject = '*' (install-wide) or one actor id.
CREATE TABLE IF NOT EXISTS content_policy_tenant (
    subject  VARCHAR(255) NOT NULL,
    label    VARCHAR(30)  NOT NULL,
    action   VARCHAR(10)  NOT NULL,
    PRIMARY KEY (subject, label),
    CONSTRAINT ck_cpt_label  CHECK (label IN ('SEXUAL_EXPLICIT','SEXUAL_SUGGESTIVE','VIOLENCE_GRAPHIC','REAL_PERSON_LIKENESS')),
    CONSTRAINT ck_cpt_action CHECK (action IN ('ALLOW','REFUSE'))
);
-- Per provider (a capability's feature key): what its TERMS allow. Absent row = no restriction.
-- BLOCK refuses the run before the provider is reached; WARN lets it through and logs.
CREATE TABLE IF NOT EXISTS content_provider_policy (
    provider_key                VARCHAR(255) PRIMARY KEY,
    allows_adult_content        BOOLEAN     NOT NULL DEFAULT TRUE,
    allows_graphic_violence     BOOLEAN     NOT NULL DEFAULT TRUE,
    allows_real_person_likeness BOOLEAN     NOT NULL DEFAULT TRUE,
    enforcement                 VARCHAR(5)  NOT NULL DEFAULT 'BLOCK',
    note                        TEXT,
    CONSTRAINT ck_cpp_enforcement CHECK (enforcement IN ('BLOCK','WARN'))
);
-- Extra classifier patterns the operator adds (regex over lower-cased, accent-folded text).
CREATE TABLE IF NOT EXISTS content_policy_rule (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label   VARCHAR(30) NOT NULL,
    pattern TEXT        NOT NULL,
    CONSTRAINT ck_cpr_label CHECK (label IN ('SEXUAL_EXPLICIT','SEXUAL_SUGGESTIVE','VIOLENCE_GRAPHIC','REAL_PERSON_LIKENESS'))
);
-- Append-only: the label and the rule, NEVER the prompt (ADR-065).
CREATE TABLE IF NOT EXISTS content_policy_audit (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    VARCHAR(255) NOT NULL,
    studio_key  VARCHAR(60)  NOT NULL,
    labels      VARCHAR(200) NOT NULL,
    decision    VARCHAR(10)  NOT NULL,          -- ALLOWED | WARNED | REFUSED
    rule        VARCHAR(300) NOT NULL,
    providers   TEXT         NOT NULL DEFAULT '',
    dry_run     BOOLEAN      NOT NULL DEFAULT FALSE,
    recorded_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cpa_actor ON content_policy_audit(actor_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpa_decision ON content_policy_audit(decision, recorded_at DESC);
CREATE OR REPLACE FUNCTION content_policy_audit_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'content_policy_audit is append-only — % rejected', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_content_policy_audit_immutable ON content_policy_audit;
CREATE TRIGGER trg_content_policy_audit_immutable
  BEFORE UPDATE OR DELETE ON content_policy_audit
  FOR EACH ROW EXECUTE FUNCTION content_policy_audit_immutable();


INSERT INTO content_provider_policy (provider_key, allows_adult_content, enforcement, note)
VALUES ('orazaka.core.media.video', FALSE, 'BLOCK',
        'Served by DigitalOcean serverless inference; its terms do not allow adult content.')
ON CONFLICT (provider_key) DO UPDATE
  SET allows_adult_content = EXCLUDED.allows_adult_content,
      enforcement = EXCLUDED.enforcement,
      note = EXCLUDED.note;
COMMIT;
