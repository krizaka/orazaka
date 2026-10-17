-- profile-photo-check (krizaka/orazaka-packs): a lone, FREE Studio. `allows()` reads an absent key as a denial, so its
-- `studio.*` key is granted on every plan — the same as studio.trade-showcase (ADR-034 §8.2). The seed of a fresh install is
-- krizaka-billing's 70-billing.sql; this is for databases that already exist (dev).
INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value) VALUES
('free',     'studio.profile-photo-check', 'boolean', 'true'),
('premium',  'studio.profile-photo-check', 'boolean', 'true'),
('ultimate', 'studio.profile-photo-check', 'boolean', 'true')
ON CONFLICT (plan_key, entitlement_key) DO NOTHING;

-- message-authenticity (krizaka/orazaka-packs): the same, for the authenticity signal on messages.
INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value) VALUES
('free',     'studio.message-authenticity', 'boolean', 'true'),
('premium',  'studio.message-authenticity', 'boolean', 'true'),
('ultimate', 'studio.message-authenticity', 'boolean', 'true')
ON CONFLICT (plan_key, entitlement_key) DO NOTHING;

-- media-safety (krizaka/orazaka-packs): the safety check of photos, video frames and voice messages.
INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value) VALUES
('free',     'studio.media-safety', 'boolean', 'true'),
('premium',  'studio.media-safety', 'boolean', 'true'),
('ultimate', 'studio.media-safety', 'boolean', 'true')
ON CONFLICT (plan_key, entitlement_key) DO NOTHING;
