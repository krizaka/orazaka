-- The four art-direction Studios of the media TOOLKIT (orazaka-packs, orazaka-media 1.1.0) run the
-- image capability: they inherit capability.image and are granted wherever image generation is.
-- krizaka-billing infra/initdb/70-billing.sql carries the same rows for a fresh database.
\c krizaka_billing_db

INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value)
SELECT plan_key, 'studio.' || studio, 'boolean', 'true'
  FROM (VALUES ('free'), ('premium'), ('ultimate')) AS plans(plan_key)
 CROSS JOIN (VALUES ('art-golden-hour'), ('art-miniature'), ('art-still-life'), ('art-montreal-night')) AS studios(studio)
ON CONFLICT (plan_key, entitlement_key) DO NOTHING;
