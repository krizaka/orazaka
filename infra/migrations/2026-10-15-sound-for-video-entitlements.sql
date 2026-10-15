-- Sound for a video (krizaka/orazaka-packs#25): the two new media Studios are granted like video generation
-- (free ✗, premium ✓, ultimate ✓ — the matrix of `capability.video`). A TOOLKIT Studio's entitlement key is
-- always `studio.<key>`; an absent key is a denial. krizaka-billing's infra/initdb/70-billing.sql carries the
-- same rows for a fresh database. Idempotent.
\c krizaka_billing_db

INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value) VALUES
('free',     'studio.video-with-sound', 'boolean', 'false'),
('free',     'studio.video-sound',      'boolean', 'false'),
('premium',  'studio.video-with-sound', 'boolean', 'true'),
('premium',  'studio.video-sound',      'boolean', 'true'),
('ultimate', 'studio.video-with-sound', 'boolean', 'true'),
('ultimate', 'studio.video-sound',      'boolean', 'true')
ON CONFLICT DO NOTHING;
