-- Yororis' plan (2026-10-22, yororis#99): retention.none and no audio capability. Idempotent.
-- Apply to krizaka_billing_db. The service account's subscription is moved in the environment's data:
--   UPDATE billing_subscription SET plan_key = 'yororis' WHERE actor_id = '<svc+yororis user id>';
-- ─────────────────────────────────────────────────────────────────────────────
-- The `yororis` plan (service plan of the Yororis app, a virtual neighbour).
--
-- Not public, not for sale: the plan of the Yororis service account. Three decisions are data:
--   * capability.chat only — Yororis answers by the voice turn, which is a chat turn;
--   * capability.audio FALSE for now — a typed turn on a plan without it is answered as text
--     (VoiceTurnService); a recording is refused (it would reach the model before it can be
--     screened). Turn it on, as data, the day a voice engine serves the environment;
--   * retention.none TRUE — no-storage mode (Context.retentionNone): the engine keeps counters and
--     metadata, never a prompt, a completion or a transcript, and logs no content.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO billing_plan (plan_key, label, tier_rank, monthly_credit_grant, price_cents, currency, rate_limit_tier_key, is_public, is_active) VALUES
('yororis', 'Yororis', 10, 3000, 0, 'CAD', 'premium', FALSE, TRUE)
ON CONFLICT (plan_key) DO NOTHING;

INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value) VALUES
('yororis', 'capability.chat',       'boolean', 'true'),
('yororis', 'capability.image',      'boolean', 'false'),
('yororis', 'capability.audio',      'boolean', 'false'),
('yororis', 'capability.video',      'boolean', 'false'),
('yororis', 'capability.agent',      'boolean', 'false'),
('yororis', 'capability.workflow',   'boolean', 'false'),
('yororis', 'capability.automation', 'boolean', 'false'),
('yororis', 'capability.api-keys',   'boolean', 'false'),
('yororis', 'concurrency.jobs',      'int',     '1'),
('yororis', 'model.class',           'string',  'premium'),
('yororis', 'topup.enabled',         'boolean', 'false'),
('yororis', 'retention.none',        'boolean', 'true'),
('yororis', 'studio.guided-journaling', 'boolean', 'true')
ON CONFLICT (plan_key, entitlement_key) DO UPDATE SET value_type = EXCLUDED.value_type, value = EXCLUDED.value;
