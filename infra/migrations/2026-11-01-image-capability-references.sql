-- 2026-11-01 — the image capability declares `references` and `referenceWeight` (krizaka/krizaka-internal#158), for an
-- existing database. orazaka-job-service#104 added them to infra/initdb/30-jobs-config.sql, which only a fresh database
-- runs: on dev the capability's input schema still lacked them while the engine (ai-engine#206) and the Studio
-- (orazaka-packs#193) already pass them. The two must stay in step.
--
--   docker exec -i <postgres> psql -U <owner> -d orazaka_db < infra/migrations/2026-11-01-image-capability-references.sql
--
-- Additive and idempotent: the two properties are merged into the existing `properties` object (the other inputs are
-- kept as they are); a row that already has both is not touched.
\c orazaka_db

UPDATE orazaka_capabilities
SET input_schema = jsonb_set(
    input_schema,
    '{properties}',
    COALESCE(input_schema -> 'properties', '{}'::jsonb)
        || '{"references": {"type": "array", "items": {"type": "string", "format": "asset-id"}, "maxItems": 4}, "referenceWeight": {"type": "number", "minimum": 0, "maximum": 1}}'::jsonb)
WHERE feature_key = 'orazaka.core.media.image'
  AND NOT (COALESCE(input_schema -> 'properties', '{}'::jsonb) ?& ARRAY['references', 'referenceWeight']);
