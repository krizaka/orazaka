-- ─────────────────────────────────────────────────────────────────────────────
-- M4 / ADR-069 §0.4 — the media TOOLKIT's six Studios, granted in the plan matrix.
--
-- ADR-066 turned media into a pack; ADR-061 made a TOOLKIT's installation DERIVED from its
-- entitlement. Nothing ever granted its `studio.*` keys, and `allows()` reads an absent key as a
-- denial — so on a fresh install EVERY media button was locked on EVERY plan, including `ultimate`,
-- whose own matrix says `capability.image = true`. The e2e gate is what said so: `POST
-- /api/v1/studios/image-generation/runs` answered **409** through the real edge.
--
-- These rows are a TRANSCRIPTION of the capability matrix already in 70-billing.sql, not a pricing
-- decision. Each Studio inherits the value of its own capability:
--
--   image  → free ✓  premium ✓  ultimate ✓      (capability.image)
--   audio  → free ✗  premium ✓  ultimate ✓      (capability.audio)
--   video  → free ✗  premium ✓  ultimate ✓      (capability.video)
--
-- `capability.image|audio|video` are NOT removed and are NOT dead: they stay the plan-level
-- statement, of the same family as `concurrency.jobs` and `model.class`. They are superseded for
-- STUDIO ACCESS only, which `StudioAccessService` answers from `studio.<key>`.
--
-- Precedent, three rows away: `studio.trade-showcase` is granted in all three plans for exactly
-- this reason (ADR-034 §8.2). Routing a TOOLKIT around entitlement instead would remove one of the
-- four controls M3 put in front of every run — which is what door 1 did.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value) VALUES
('free',     'studio.image-generation', 'boolean', 'true'),
('free',     'studio.image-analysis',   'boolean', 'true'),
('free',     'studio.speech-synthesis', 'boolean', 'false'),
('free',     'studio.audio-analysis',   'boolean', 'false'),
('free',     'studio.video-generation', 'boolean', 'false'),
('free',     'studio.video-analysis',   'boolean', 'false'),
('premium',  'studio.image-generation', 'boolean', 'true'),
('premium',  'studio.image-analysis',   'boolean', 'true'),
('premium',  'studio.speech-synthesis', 'boolean', 'true'),
('premium',  'studio.audio-analysis',   'boolean', 'true'),
('premium',  'studio.video-generation', 'boolean', 'true'),
('premium',  'studio.video-analysis',   'boolean', 'true'),
('ultimate', 'studio.image-generation', 'boolean', 'true'),
('ultimate', 'studio.image-analysis',   'boolean', 'true'),
('ultimate', 'studio.speech-synthesis', 'boolean', 'true'),
('ultimate', 'studio.audio-analysis',   'boolean', 'true'),
('ultimate', 'studio.video-generation', 'boolean', 'true'),
('ultimate', 'studio.video-analysis',   'boolean', 'true')
ON CONFLICT (plan_key, entitlement_key) DO NOTHING;
