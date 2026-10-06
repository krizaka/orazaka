-- ─────────────────────────────────────────────────────────────────────────────
-- Free packs are granted by every plan, because nothing else grants them.
--
-- `echo-toolkit` and `bien-etre` declare `pricing.priceCents: 0`. They shipped PUBLISHED, installed
-- into the catalogue on every fresh volume, and were reachable by NOBODY: `studio_not_entitled` for
-- every actor on every plan, `ultimate` included, because no plan granted their studio.* keys and a
-- free pack has no purchase to unlock (docs/evaluations/first-real-use.md, B2).
--
-- `document-validation` and `realestate-studio` are deliberately absent: they declare 4900 cents,
-- and a plan row would make a sold pack free. SeedBootstrapIT keys its guard on `priceCents` so the
-- distinction comes from each pack's own manifest rather than from a list someone maintains.
--
-- Granting bien-etre does not make it installable — REGULATED keeps the consent gate, the age
-- attestation and the sourced-region check in front of every installation.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value) VALUES
('free',     'studio.echo-reverse',       'boolean', 'true'),
('free',     'studio.guided-journaling',  'boolean', 'true'),
('free',     'studio.session-preparation','boolean', 'true'),
('free',     'studio.mood-tracking',      'boolean', 'true'),
('premium',  'studio.echo-reverse',       'boolean', 'true'),
('premium',  'studio.guided-journaling',  'boolean', 'true'),
('premium',  'studio.session-preparation','boolean', 'true'),
('premium',  'studio.mood-tracking',      'boolean', 'true'),
('ultimate', 'studio.echo-reverse',       'boolean', 'true'),
('ultimate', 'studio.guided-journaling',  'boolean', 'true'),
('ultimate', 'studio.session-preparation','boolean', 'true'),
('ultimate', 'studio.mood-tracking',      'boolean', 'true')
ON CONFLICT (plan_key, entitlement_key) DO NOTHING;
