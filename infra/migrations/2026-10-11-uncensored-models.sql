-- 2026-10-11 — Unfiltered models, your rules: three open-weight chat models without a vendor's
-- refusal layer join the catalogue (orazaka-job-service infra/initdb/30-jobs-config.sql carries the
-- same rows for a fresh database).
--
--   docker exec -i <postgres> psql -U <owner> -d orazaka_db < infra/migrations/2026-10-11-uncensored-models.sql
--
-- What "uncensored" means here, and what it does not. A hosted assistant ships with its vendor's
-- refusal policy baked into the weights and a filter in front of them: a security team asking how a
-- phishing lure is built, a nurse asking for a frank maximum dose, a novelist writing a dark scene
-- get a refusal or a page of hedging. These models were fine-tuned (Dolphin) or abliterated
-- (the refusal direction removed from the weights) so they answer legitimate professional work
-- plainly. None of them is a default: an operator chooses to serve one.
--
-- They are not the policy. The policy belongs to the operator who runs Orazaka: a pack
-- declares the domain it refuses (scopeGuard, ADR-051) and the crisis text it answers (safety,
-- ADR-055), the engine enforces both before any model runs, and every turn is accounted in the
-- audit trail.
--
-- Unfiltered is not infallible: the 7–8B models answer readily and get facts wrong more often than
-- the 27B one (measured on the demo questions published on krizaka.com: dosages and STI lists from
-- the small models were not publishable; the 27B answers were). For medical, legal or security
-- work, serve the largest model the machine holds and keep a professional in the loop.
--
-- Licences — all three permit commercial use on the operator's own infrastructure:
--   huihui_ai/qwen2.5-abliterate:7b  Qwen2.5-7B-Instruct, abliterated — Apache-2.0. ~4.7 GB (q4_K_M).
--   dolphin-llama3:8b                Dolphin 2.9 on Llama 3 8B — Meta Llama 3 Community Licence
--                                    ("Built with Meta Llama 3", Meta's acceptable use policy). ~4.7 GB.
--   mdq100/Gemma3-Instruct-Abliterated:27b
--                                    Gemma 3 27B Instruct, abliterated — Gemma Terms of Use (commercial use
--                                    allowed, Gemma prohibited-use policy applies). ~17 GB: a 32 GB+ machine.
-- The two small ones fit beside the rest of the local stack on a 16 GB machine. Ollama loads one model
-- at a time; never run the 27B beside an image generation on a 32 GB machine.
-- Install: ollama pull <model_name>
\c orazaka_db

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default) VALUES
('huihui_ai/qwen2.5-abliterate:7b', 'Qwen 2.5 7B — unfiltered', 'chat', 'q4_K_M', 'ollama', FALSE),
('dolphin-llama3:8b', 'Dolphin Llama 3 8B — unfiltered', 'chat', 'q4_K_M', 'ollama', FALSE),
('mdq100/Gemma3-Instruct-Abliterated:27b', 'Gemma 3 27B — unfiltered', 'chat', 'q4_K_M', 'ollama', FALSE)
ON CONFLICT (model_name) DO NOTHING;

UPDATE orazaka_models SET model_label = 'Gemma 3 27B — unfiltered', options = 'q4_K_M' WHERE model_name = 'mdq100/Gemma3-Instruct-Abliterated:27b';
UPDATE orazaka_models SET description = 'Qwen 2.5 7B Instruct with the refusal direction removed (abliterated), Apache-2.0. Answers legitimate professional questions — security, medicine, law, fiction — without a vendor''s refusals; your packs set the rules. French and English.' WHERE model_name = 'huihui_ai/qwen2.5-abliterate:7b';
UPDATE orazaka_models SET description = 'Dolphin 2.9 on Llama 3 8B (Meta Llama 3 Community Licence) — fine-tuned without a refusal layer. Frank, compliant answers; the operator''s packs set the rules.' WHERE model_name = 'dolphin-llama3:8b';
UPDATE orazaka_models SET description = 'Gemma 3 27B Instruct with the refusal direction removed (abliterated), Gemma Terms of Use. The most accurate unfiltered model of the catalogue — the one behind the krizaka.com demos. ~17 GB: a 32 GB+ machine.' WHERE model_name = 'mdq100/Gemma3-Instruct-Abliterated:27b';
