-- ADR-083 slice 2: the products' service accounts (svc_*) get a tier that fits a machine caller, so the per-key rate
-- limit can leave `observe` for `enforce` without throttling them (Orochia's seeding polled ~360 jobs a pass; `free`
-- is 60 requests a minute). Run on krizaka_users_db. Idempotent, additive.
-- `users.rate_limit_tier` points at rate_limit_tiers (the token bucket the edge applies); rate_limits holds the tier
-- selection read by identity's RateLimitProvider. A tier needs its row in both.
INSERT INTO rate_limit_tiers (id, capacity, refill_tokens, refill_seconds)
VALUES ('service', 1000, 1000, 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rate_limits (tier_key, requests_per_minute, concurrent_jobs, is_default)
VALUES ('service', 1000, 20, FALSE)
ON CONFLICT (tier_key) DO NOTHING;

UPDATE users SET rate_limit_tier = 'service'
WHERE username LIKE 'svc\_%' AND rate_limit_tier IS DISTINCT FROM 'service';
