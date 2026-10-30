-- ADR-093 (krizaka/orazaka#450): the model turn of the code agent is metered like any chat turn, per KILOTOKEN, on the
-- AGENT capability of the pack's run. Applied once to an existing billing database, as its owner role. Idempotent (the
-- partial unique index idx_pricebook_current makes a second run a no-op).
--
-- NO PRICE IS INVENTED HERE. The pack's price is Oussama's call (ADR-093, « Price of the pack »; until then operator
-- grants). This row repeats, for the local code model, the catalogue's own placeholder: the generic CHAT/KILOTOKEN rate of
-- the v2 pricebook (10.0000 per kilotoken, floor 1, estimate 20, 2026-09-03-billing-credit-scale-10x.sql). When the pack
-- is priced, a new version replaces it.
INSERT INTO credit_pricebook (version, capability, model_name, unit, credits_per_unit, minimum_credits, estimate_credits) VALUES
(2, 'AGENT', 'qwen2.5-coder:7b', 'KILOTOKEN', 10.0000, 1, 20)
ON CONFLICT DO NOTHING;
