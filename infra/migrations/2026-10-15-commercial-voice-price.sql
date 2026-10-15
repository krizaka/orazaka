-- 2026-10-15 — The price book prices the commercial English voice like the other Piper voices (krizaka-billing infra/initdb/70-billing.sql
-- carries the same rows for a fresh database). An unpriced model resolves to no row: refused under ENFORCING. Idempotent.
\c krizaka_billing_db

INSERT INTO credit_pricebook (version, capability, model_name, unit, credits_per_unit, minimum_credits, estimate_credits) VALUES
(1, 'AUDIO', 'piper-en-medium-ljspeech', 'KILOCHAR',  4.0000, 4,  4),
(2, 'AUDIO', 'piper-en-medium-ljspeech', 'KILOCHAR', 40.0000, 4, 40)
ON CONFLICT DO NOTHING;
