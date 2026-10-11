-- ─────────────────────────────────────────────────────────────────────────────
-- Orazaka bills in Canadian dollars (krizaka/krizaka-billing#9).
--
-- Krizaka is a Montréal company. infra/initdb/70-billing.sql (krizaka-billing) now
-- seeds `billing.currency = CAD` and the plans in CAD; this file brings an existing
-- database to the same place. Run against krizaka_billing_db:
--
--   psql -d krizaka_billing_db -f infra/migrations/2026-10-11-billing-currency-cad.sql
--
-- Prices (a decision to validate — see the PR): EUR 19 / 49 at ~1.55 CAD/EUR, rounded
-- to the x9 price points: Premium 29 $, Ultimate 79 $, paid packs 79 $ CA.
--
-- Only the rows still carrying the former EUR seed values are re-priced: a price an
-- admin changed by hand is a decision, and this file does not overwrite it. Each
-- change is snapshotted into billing_version_history first, as the console does.
-- Idempotent: a second run finds nothing to change.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

INSERT INTO billing_runtime_config (config_key, config_value, value_type, description) VALUES
('billing.currency', 'CAD', 'string',
 'ISO 4217 code of every amount stated without one (a plan saved without a currency, pack prices, the money anchor). CAD: Krizaka is a Montreal company.')
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE billing_plan ALTER COLUMN currency DROP DEFAULT;

INSERT INTO billing_version_history (entity_type, entity_key, snapshot, sha256_hash, created_by)
SELECT 'PLAN', plan_key, to_jsonb(p), encode(sha256(convert_to(to_jsonb(p)::text, 'UTF8')), 'hex'),
       'migration:2026-10-11-billing-currency-cad'
FROM billing_plan p
WHERE currency = 'EUR' AND (plan_key, price_cents) IN (('free', 0), ('premium', 1900), ('ultimate', 4900));

UPDATE billing_plan SET
    price_cents = CASE plan_key WHEN 'premium' THEN 2900 WHEN 'ultimate' THEN 7900 ELSE price_cents END,
    currency    = 'CAD',
    updated_at  = now()
WHERE currency = 'EUR' AND (plan_key, price_cents) IN (('free', 0), ('premium', 1900), ('ultimate', 4900));

INSERT INTO billing_version_history (entity_type, entity_key, snapshot, sha256_hash, created_by)
SELECT 'PACK', pack_key, to_jsonb(p), encode(sha256(convert_to(to_jsonb(p)::text, 'UTF8')), 'hex'),
       'migration:2026-10-11-billing-currency-cad'
FROM billing_pack p
WHERE pack_key IN ('document-validation', 'realestate-studio') AND price_cents = 4900;

UPDATE billing_pack SET price_cents = 7900
WHERE pack_key IN ('document-validation', 'realestate-studio') AND price_cents = 4900;

COMMIT;
