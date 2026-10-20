-- ADR-083 slice 2: the products' service accounts (svc_*) get a tier that fits a machine caller, so the per-key rate
-- limit can leave `observe` for `enforce` without throttling them (Orochia's seeding polled ~360 jobs a pass; `free`
-- is 60 requests a minute). Run on krizaka_users_db. Idempotent, additive.
INSERT INTO rate_limits (tier_key, requests_per_minute, concurrent_jobs, is_default)
VALUES ('service', 1000, 20, FALSE)
ON CONFLICT (tier_key) DO NOTHING;

UPDATE users SET rate_limit_tier = 'service'
WHERE username LIKE 'svc\_%' AND rate_limit_tier <> 'service';
