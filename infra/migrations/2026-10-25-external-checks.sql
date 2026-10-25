-- orazaka-packs#138 (orazaka-job-service#74): the engine's external checks — the capability rows
-- orazaka.core.checks.{courtrecords,credit,identity} (handler check.external, per CALL, billable capability EXTERNAL_CHECK),
-- the named check ck_orazaka_capabilities_billable_capability that accepts EXTERNAL_CHECK, and the append-only
-- external_check_audit table with its trigger. orazaka-job-service infra/initdb/30-jobs-config.sql carries the same block
-- for a fresh database; the two must stay in step. Additive and idempotent (constraint replaced by name, IF NOT EXISTS,
-- ON CONFLICT DO NOTHING). Fails closed on dev: no checks.subject-pepper row is seeded, so every check job is refused
-- until an operator seals one. Prices: the (EXTERNAL_CHECK, mock, CALL) row of krizaka_billing_db
-- (2026-10-25-pricebook-external-check-research.sql). Runs in orazaka_db.
-- ============================================================================
-- EXTERNAL CHECKS (orazaka-packs#138, orazaka-ai-engine#90) — court records, credit and identity as engine
-- capabilities a blueprint step names by feature key. The engine's ExternalCheckService is the one door (consent,
-- key, hold, provider, audit, in that order); this service runs it in-process through the executor whose
-- handlerKey() is 'check.external' (ExternalCheckStrategy). Still on the mock connector until the pilot's go.
-- The same block is the dev-deploy migration `external-checks` (krizaka/orazaka): additive and idempotent
-- (constraint replaced by name, IF NOT EXISTS, ON CONFLICT DO NOTHING), the two must stay in step;
-- ExternalCheckSchemaIT applies it twice on a database that predates it. Runs in orazaka_db.
--
-- The subject pepper (setting checks.subject-pepper, sealed) is deliberately NOT seeded: no row, no check. An
-- operator seals one (orazaka-ai-engine, CheckSubjectPepperTool); until then every check job fails closed.
-- ============================================================================

-- billable_capability EXTERNAL_CHECK, priced by the (EXTERNAL_CHECK, <provider>, CALL) rows of credit_pricebook
-- (krizaka-billing#57). A database created before this block has the column's unnamed CHECK without it.
ALTER TABLE orazaka_capabilities DROP CONSTRAINT IF EXISTS orazaka_capabilities_billable_capability_check;
ALTER TABLE orazaka_capabilities DROP CONSTRAINT IF EXISTS ck_orazaka_capabilities_billable_capability;
ALTER TABLE orazaka_capabilities ADD CONSTRAINT ck_orazaka_capabilities_billable_capability
    CHECK (billable_capability IN ('CHAT','IMAGE','AUDIO','VIDEO','AGENT','EXTERNAL_CHECK'));

-- The audit of the checks (the engine's CheckAudit): one line per call, refused or not. No name, no birth date,
-- no address, no record content: the subject is a keyed HMAC-SHA-256 of its opaque id (subject_ref), the provider
-- reference is the provider's opaque case id. Append-only: a line is never rewritten (the trigger refuses an
-- UPDATE); deleting old lines stays possible for a retention sweep.
CREATE TABLE IF NOT EXISTS external_check_audit (
    id            BIGSERIAL    PRIMARY KEY,
    at            TIMESTAMPTZ  NOT NULL,
    actor_id      VARCHAR(255),
    run_id        UUID,
    provider      VARCHAR(60)  NOT NULL,
    purpose       VARCHAR(20)  NOT NULL CHECK (purpose IN ('COURT_RECORDS','CREDIT','IDENTITY')),
    key_source    VARCHAR(10)  CHECK (key_source IN ('USER','PLATFORM')),
    outcome       VARCHAR(20)  NOT NULL CHECK (outcome IN ('MATCH','NO_MATCH','PROVIDER_ERROR','TIMEOUT','REFUSED')),
    refusal       VARCHAR(20)  CHECK (refusal IN ('NO_CONSENT','NO_KEY','BUDGET_EXHAUSTED')),
    subject_ref   CHAR(64)     NOT NULL,
    duration_ms   BIGINT,
    provider_ref  VARCHAR(120),
    CONSTRAINT ck_external_check_audit_refusal CHECK ((outcome = 'REFUSED') = (refusal IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_external_check_audit_run ON external_check_audit (run_id);
CREATE INDEX IF NOT EXISTS idx_external_check_audit_actor_at ON external_check_audit (actor_id, at DESC);

CREATE OR REPLACE FUNCTION external_check_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION 'external_check_audit is append-only: a line is never rewritten';
END
$fn$;
DROP TRIGGER IF EXISTS trg_external_check_audit_append_only ON external_check_audit;
CREATE TRIGGER trg_external_check_audit_append_only BEFORE UPDATE ON external_check_audit
    FOR EACH ROW EXECUTE FUNCTION external_check_audit_append_only();

-- The three checks. One handler for the three: the purpose is the feature key (CheckPurpose.ofFeatureKey), so the
-- executor never branches on a key of its own. routing_key job.text.process, INTERACTIVE: the check runs in this
-- process (job.text.* is drained here) and its duration is the provider's answer time, not something the user
-- supplied. billable_unit CALL: one call when the provider answered (MATCH, NO_MATCH), none otherwise
-- (consumption {calls: 0|1}; CallConsumption releases the hold on 0). The contract is orazaka-packs'
-- tests/contracts/orazaka-core-checks.json: inputs subject + consentedPurposes (a purpose is granted only when
-- listed), outputs outcome, refusal, category, providerRef, calls and resultJson (the same object as a JSON string).
INSERT INTO orazaka_capabilities
    (feature_key, handler_key, routing_key,
     billable_unit, billable_capability, latency_class, input_schema, output_schema, is_enabled) VALUES
('orazaka.core.checks.courtrecords', 'check.external', 'job.text.process', 'CALL', 'EXTERNAL_CHECK', 'INTERACTIVE',
  $${"type": "object", "properties": {"subject": {"type": "object", "properties": {"subjectId": {"type": "string", "minLength": 1}, "lastName": {"type": "string", "minLength": 1}, "firstName": {"type": "string", "minLength": 1}, "birthDate": {"type": "string", "format": "date"}, "address": {"type": "string"}}, "required": ["subjectId", "lastName", "firstName"], "description": "The person checked: an opaque id, the names searched, optionally a birth date and an address."}, "consentedPurposes": {"type": "array", "items": {"type": "string"}, "description": "The purposes the subject consented to: COURT_RECORDS grants this check, nothing else does."}}, "required": ["subject", "consentedPurposes"]}$$::jsonb,
  $${"type": "object", "properties": {"outcome": {"type": "string", "enum": ["MATCH", "NO_MATCH", "PROVIDER_ERROR", "TIMEOUT", "REFUSED"]}, "refusal": {"type": ["string", "null"], "enum": ["NO_CONSENT", "NO_KEY", "BUDGET_EXHAUSTED", null]}, "category": {"type": "string", "enum": ["TAL_NON_PAYMENT", "TAL_OTHER", "CRIMINAL", "CIVIL", "NONE"]}, "providerRef": {"type": ["string", "null"]}, "calls": {"type": "integer", "minimum": 0, "maximum": 1}, "resultJson": {"type": "string"}}, "required": ["outcome", "category", "calls", "resultJson"]}$$::jsonb, true),
('orazaka.core.checks.credit', 'check.external', 'job.text.process', 'CALL', 'EXTERNAL_CHECK', 'INTERACTIVE',
  $${"type": "object", "properties": {"subject": {"type": "object", "properties": {"subjectId": {"type": "string", "minLength": 1}, "lastName": {"type": "string", "minLength": 1}, "firstName": {"type": "string", "minLength": 1}, "birthDate": {"type": "string", "format": "date"}, "address": {"type": "string"}}, "required": ["subjectId", "lastName", "firstName"], "description": "The person checked: an opaque id, the names searched, optionally a birth date and an address."}, "consentedPurposes": {"type": "array", "items": {"type": "string"}, "description": "The purposes the subject consented to: CREDIT grants this check, nothing else does."}}, "required": ["subject", "consentedPurposes"]}$$::jsonb,
  $${"type": "object", "properties": {"outcome": {"type": "string", "enum": ["MATCH", "NO_MATCH", "PROVIDER_ERROR", "TIMEOUT", "REFUSED"]}, "refusal": {"type": ["string", "null"], "enum": ["NO_CONSENT", "NO_KEY", "BUDGET_EXHAUSTED", null]}, "category": {"type": "string", "enum": ["TAL_NON_PAYMENT", "TAL_OTHER", "CRIMINAL", "CIVIL", "NONE"]}, "providerRef": {"type": ["string", "null"]}, "calls": {"type": "integer", "minimum": 0, "maximum": 1}, "resultJson": {"type": "string"}}, "required": ["outcome", "category", "calls", "resultJson"]}$$::jsonb, true),
('orazaka.core.checks.identity', 'check.external', 'job.text.process', 'CALL', 'EXTERNAL_CHECK', 'INTERACTIVE',
  $${"type": "object", "properties": {"subject": {"type": "object", "properties": {"subjectId": {"type": "string", "minLength": 1}, "lastName": {"type": "string", "minLength": 1}, "firstName": {"type": "string", "minLength": 1}, "birthDate": {"type": "string", "format": "date"}, "address": {"type": "string"}}, "required": ["subjectId", "lastName", "firstName"], "description": "The person checked: an opaque id, the names searched, optionally a birth date and an address."}, "consentedPurposes": {"type": "array", "items": {"type": "string"}, "description": "The purposes the subject consented to: IDENTITY grants this check, nothing else does."}}, "required": ["subject", "consentedPurposes"]}$$::jsonb,
  $${"type": "object", "properties": {"outcome": {"type": "string", "enum": ["MATCH", "NO_MATCH", "PROVIDER_ERROR", "TIMEOUT", "REFUSED"]}, "refusal": {"type": ["string", "null"], "enum": ["NO_CONSENT", "NO_KEY", "BUDGET_EXHAUSTED", null]}, "category": {"type": "string", "enum": ["TAL_NON_PAYMENT", "TAL_OTHER", "CRIMINAL", "CIVIL", "NONE"]}, "providerRef": {"type": ["string", "null"]}, "calls": {"type": "integer", "minimum": 0, "maximum": 1}, "resultJson": {"type": "string"}}, "required": ["outcome", "category", "calls", "resultJson"]}$$::jsonb, true)
ON CONFLICT (feature_key) DO NOTHING;
