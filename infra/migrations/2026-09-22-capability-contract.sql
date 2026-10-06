-- ─────────────────────────────────────────────────────────────────────────────
-- M4 / ADR-069 — the capability registry gets the other half of its contract.
--
-- A blueprint chains its steps with {{steps.<out>.<field>}}, and until now NOTHING declared what a
-- capability produces: every link in every DAG referenced a field no contract mentioned and no rule
-- could check. The one attempt to check it was a table transcribed by hand into
-- BlueprintFitnessTest, and it was wrong — it said audio analysis publishes `url` when the executor
-- publishes `analysis`, so a blueprint reading the real field would have failed the rule and one
-- reading a field nothing produces passed.
--
-- The contract is now two columns, declared where everything else about a capability is declared
-- (the seed for the platform's own, the pack manifest for a pack's) and written by the installer:
--   input_schema  — what a caller MAY PASS: a real JSON Schema, replacing payload_template's
--                   untyped ${placeholders}, and carrying the format: prose | asset-id that M3
--                   introduced so a composer knows which of its two holdings fills an input.
--   output_schema — what a SUCCESSFUL execution publishes, with types.
--
-- Both default to '{}' — an undeclared contract matches nothing, so a step over it fails the
-- fitness function instead of passing silently.
--
-- Also here, and for the same reading: the two capability keys that lied (#44).
--   orazaka.core.chat.speech       → orazaka.core.media.speech
--   orazaka.core.media.audio       → orazaka.core.media.audio.analysis
-- Nothing is deployed, so this is not a data migration anybody has to sequence: it is the local
-- database catching up with a set of files that must agree.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orazaka_capabilities
    ADD COLUMN IF NOT EXISTS input_schema  JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS output_schema JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The renames, before the contracts are written against the new keys.
UPDATE orazaka_capabilities SET feature_key = 'orazaka.core.media.speech'
 WHERE feature_key = 'orazaka.core.chat.speech';
UPDATE orazaka_capabilities SET feature_key = 'orazaka.core.media.audio.analysis'
 WHERE feature_key = 'orazaka.core.media.audio';
-- credit_pricebook is keyed by BillableCapability ('AUDIO', 'IMAGE'…), never by feature key,
-- so the renames move nothing there. Checked rather than assumed.

-- The contracts of the platform's own capabilities, identical to 30-jobs-config.sql.
UPDATE orazaka_capabilities SET
    input_schema  = $${"type":"object","properties":{"prompt":{"type":"string","format":"prose"},"size":{"type":"string","default":"1024x1024"},"model":{"type":"string"}},"required":["prompt"]}$$::jsonb,
    output_schema = $${"type":"object","properties":{"url":{"type":"string"},"format":{"type":"string"}},"required":["url"]}$$::jsonb
 WHERE feature_key = 'orazaka.core.media.image';

UPDATE orazaka_capabilities SET
    input_schema  = $${"type":"object","properties":{"prompt":{"type":"string","format":"prose"},"durationSeconds":{"type":"integer","minimum":1,"maximum":20,"default":5},"image":{"type":"string","format":"asset-id"},"model":{"type":"string"}},"required":["prompt"]}$$::jsonb,
    output_schema = $${"type":"object","properties":{"url":{"type":"string"},"format":{"type":"string"},"metrics":{"type":"object"}},"required":["url"]}$$::jsonb
 WHERE feature_key = 'orazaka.core.media.video';

UPDATE orazaka_capabilities SET
    input_schema  = $${"type":"object","properties":{"prompt":{"type":"string","format":"prose"},"text":{"type":"string","format":"prose"},"voice":{"type":"string","default":"alloy"},"model":{"type":"string"}},"anyOf":[{"required":["prompt"]},{"required":["text"]}]}$$::jsonb,
    output_schema = $${"type":"object","properties":{"url":{"type":"string"},"format":{"type":"string"},"durationMs":{"type":"integer"}},"required":["url"]}$$::jsonb
 WHERE feature_key = 'orazaka.core.media.speech';

UPDATE orazaka_capabilities SET
    input_schema  = $${"type":"object","properties":{"assetId":{"type":"string","format":"asset-id"},"prompt":{"type":"string","format":"prose","default":"Analyze this image"},"model":{"type":"string"}},"required":["assetId"]}$$::jsonb,
    output_schema = $${"type":"object","properties":{"analysis":{"type":"string"}},"required":["analysis"]}$$::jsonb
 WHERE feature_key = 'orazaka.core.media.vision';

UPDATE orazaka_capabilities SET
    input_schema  = $${"type":"object","properties":{"assetId":{"type":"string","format":"asset-id"},"model":{"type":"string"}},"required":["assetId"]}$$::jsonb,
    output_schema = $${"type":"object","properties":{"analysis":{"type":"string"}},"required":["analysis"]}$$::jsonb
 WHERE feature_key = 'orazaka.core.media.audio.analysis';

UPDATE orazaka_capabilities SET
    input_schema  = $${"type":"object","properties":{"assetId":{"type":"string","format":"asset-id"},"model":{"type":"string"}},"required":["assetId"]}$$::jsonb,
    output_schema = $${"type":"object","properties":{"transcript":{"type":"string"},"keyframeCount":{"type":"integer"}},"required":["transcript"]}$$::jsonb
 WHERE feature_key = 'orazaka.core.media.video.analysis';

UPDATE orazaka_capabilities SET
    input_schema  = $${"type":"object","properties":{"prompt":{"type":"string","format":"prose"},"text":{"type":"string","format":"prose"},"model":{"type":"string"}},"anyOf":[{"required":["prompt"]},{"required":["text"]}]}$$::jsonb,
    output_schema = $${"type":"object","properties":{"content":{"type":"string"},"metadata":{"type":"object"}},"required":["content"]}$$::jsonb
 WHERE feature_key = 'orazaka.core.chat.completion';

UPDATE orazaka_capabilities SET
    input_schema  = $${"type":"object","properties":{"photos":{"type":"array","items":{"type":"string","format":"asset-id"},"minItems":1},"audio":{"type":"string","format":"asset-id"}},"required":["photos"]}$$::jsonb,
    output_schema = $${"type":"object","properties":{"url":{"type":"string"},"assetId":{"type":"string"},"format":{"type":"string"},"metrics":{"type":"object"}},"required":["url"]}$$::jsonb
 WHERE feature_key = 'orazaka.studio.media.compose';

-- A pack's capabilities are NOT updated here: the installer writes them from the manifest at the
-- next bootstrap, which is the only place that declaration lives (ADR-068 §2, ADR-069 §4).

-- ─────────────────────────────────────────────────────────────────────────────
-- The five UI-manifest columns, dropped here and not only in the seed.
--
-- This section was missing, and the e2e gate is what said so. The first version of this file
-- reasoned that a database predating the run would "keep five columns nothing reads, which is
-- inert rather than wrong". It is wrong: `label` and `icon` are NOT NULL with no default, and the
-- entity stopped mapping them — so on any existing database the very next capability INSERT the
-- pack installer attempts fails with
--
--   ERROR: null value in column "label" of relation "orazaka_capabilities"
--          violates not-null constraint
--
-- A column the code no longer writes and the schema still requires is not inert; it is a bootstrap
-- that cannot run. "The seed is authoritative for a fresh database" was true and irrelevant: the
-- machine this project runs on does not have a fresh database, and neither does the e2e harness,
-- which raises the stack with `docker compose up` over a volume that survives.
--
-- ck_orazaka_capabilities_endpoint goes with them — it constrained uri_path against http_method,
-- and an invariant with no field to guard is not kept in case (ADR-069 §5).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orazaka_capabilities
    DROP CONSTRAINT IF EXISTS ck_orazaka_capabilities_endpoint;

ALTER TABLE orazaka_capabilities
    DROP COLUMN IF EXISTS uri_path,
    DROP COLUMN IF EXISTS http_method,
    DROP COLUMN IF EXISTS payload_template,
    DROP COLUMN IF EXISTS icon,
    DROP COLUMN IF EXISTS label;
