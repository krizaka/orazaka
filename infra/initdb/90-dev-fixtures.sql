-- ============================================================================
-- ORAZAKA — Local DB bootstrap · 90 — DEV FIXTURES (local phase only)
-- ----------------------------------------------------------------------------
-- Two invented accounts and everything that hangs off them: their roles, their
-- profiles, their wallets, a ledger entry and a subscription — plus three RAG
-- documents written to give `searchWeb` something to find.
--
-- These are NOT reference data. The catalogue rows in 10/30/40/60/70/80 (models,
-- providers, capabilities, plans, packs, pricebook, the three launch Studios,
-- interceptor policies, rate-limit tiers) are the product's configuration and
-- MUST exist in every environment — AGENTS.md §4 keeps them as data, not code.
-- What is below must exist in NO environment but this one.
--
-- They lived inside the context files until now, which meant a clean environment
-- was impossible: every boot came with a fake admin, a fake subscription and an
-- invented entry in the credit ledger. Splitting them costs nothing today and is
-- what lets the Flyway baseline (T2) ship the reference data alone.
--
-- Applied last (90-) so every table it writes to already exists. It is mounted
-- with the rest of infra/initdb in the local phase; a non-local profile mounts
-- the directory without this file.
-- ============================================================================

-- ── krizaka_users_db ─────────────────────────────────────────────────────────────
\c krizaka_users_db

INSERT INTO users (id, username, password_hash, email, enabled, preferences, rate_limit_tier) VALUES
-- Dev seed credentials (local phase): admin@orazaka.com / Admin123!  ·  user@orazaka.com / User1234!
-- BCrypt hashes (>= 8-char passwords, valid emails). Change for any non-local environment.
('550e8400-e29b-41d4-a716-446655440001', 'admin', '$2y$10$KlFGQfaa2F1XK23eTyfb/ehPhEIuiitO7AUCINMKax094yGWFWz1a', 'admin@orazaka.com', true, '{"language":"en", "tts-voice":"alloy", "image-aspect-ratio":"16:9", "chat-temperature":0.7}', 'admin'),
('550e8400-e29b-41d4-a716-446655440002', 'user', '$2y$10$2.2lJbS2fNNAnLhJ5oTu4u6QvdigqeNS1gphtmSURRgrq/pRH0lr2', 'user@orazaka.com', true, '{"language":"en", "tts-voice":"nova", "image-aspect-ratio":"1:1", "chat-temperature":0.7}', 'premium')
-- Idempotent-on-update: a reseed (e.g. after `orazaka stop --purge` or a corrupted volume) restores
-- the canonical dev credentials/role instead of silently keeping a drifted row. Keeps e2e login green.
ON CONFLICT (username) DO UPDATE SET
  password_hash   = EXCLUDED.password_hash,
  email           = EXCLUDED.email,
  enabled         = EXCLUDED.enabled,
  rate_limit_tier = EXCLUDED.rate_limit_tier;

INSERT INTO authorities (user_id, authority_name) VALUES
('550e8400-e29b-41d4-a716-446655440001', 'ROLE_ADMIN'),
('550e8400-e29b-41d4-a716-446655440002', 'ROLE_USER')
ON CONFLICT ON CONSTRAINT unique_user_authority DO NOTHING;

INSERT INTO user_profiles (user_id, theme, voice_model, primary_industry, ai_behavior, raw_preferences) VALUES
('550e8400-e29b-41d4-a716-446655440001', 'emerald', 'alloy', 'tech', 'professional', '{"language":"en","tts-voice":"alloy"}'),
('550e8400-e29b-41d4-a716-446655440002', 'emerald', 'nova', 'tech', 'friendly', '{"language":"en","tts-voice":"nova"}')
ON CONFLICT (user_id) DO NOTHING;

-- ── orazaka_knowledge_db ─────────────────────────────────────────────────────────────
\c orazaka_knowledge_db

INSERT INTO orazaka_tools_rag_source (tool_id, content, metadata) VALUES
('searchWeb', 'Orazaka Corporation is a powerful mega-corporation specializing in security, banking, and manufacturing.', '{"source":"corp_profile"}'),
('searchWeb', 'The Orazaka core framework runs on Java 21 with Spring AI 1.1.6.', '{"source":"tech_spec"}'),
('searchWeb', 'The BFF proxy routes incoming frontend requests from Next.js to the Orazaka Gateway at http://localhost:8080.', '{"source":"bff_proxy"}')
ON CONFLICT ON CONSTRAINT unique_tool_content DO NOTHING;

-- ── krizaka_billing_db ─────────────────────────────────────────────────────────────
\c krizaka_billing_db

-- Dev wallets + their opening GRANT. The actor ids are OPAQUE ActorIds copied by value
-- from the identity seed — no FK, no cross-context read; this seeds only this context's
-- own database.
INSERT INTO credit_wallet (actor_id, balance_granted, balance_purchased, held) VALUES
-- In v2 credits (ADR-047): the same purchasing power as the 20 000 / 5 000 seeded before the
-- rescale, restated in a unit ten times finer. Grants are quantities, so they move with the unit.
('550e8400-e29b-41d4-a716-446655440001', 200000, 0, 0),
('550e8400-e29b-41d4-a716-446655440002',  50000, 0, 0)
ON CONFLICT (actor_id) DO NOTHING;

INSERT INTO credit_ledger_entry (actor_id, entry_type, bucket, amount, balance_after, reference_type, reference_id, idempotency_key, reason, created_by) VALUES
('550e8400-e29b-41d4-a716-446655440001', 'GRANT', 'GRANTED', 200000, 200000, 'SUBSCRIPTION', 'ultimate', 'seed-grant-550e8400-e29b-41d4-a716-446655440001', 'Dev seed: opening ultimate period grant', 'system'),
('550e8400-e29b-41d4-a716-446655440002', 'GRANT', 'GRANTED',  50000,  50000, 'SUBSCRIPTION', 'premium',  'seed-grant-550e8400-e29b-41d4-a716-446655440002', 'Dev seed: opening premium period grant',  'system')
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO billing_subscription (id, actor_id, plan_key, status, period_start, period_end) VALUES
('9f1c0a10-0000-4000-8000-000000000001', '550e8400-e29b-41d4-a716-446655440001', 'ultimate', 'ACTIVE', now(), now() + INTERVAL '30 days'),
('9f1c0a10-0000-4000-8000-000000000002', '550e8400-e29b-41d4-a716-446655440002', 'premium',  'ACTIVE', now(), now() + INTERVAL '30 days')
ON CONFLICT (id) DO NOTHING;
