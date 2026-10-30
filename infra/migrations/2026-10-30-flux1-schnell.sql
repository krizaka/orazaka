-- 2026-10-30 — FLUX.1 [schnell] in the image catalogue (orazaka#508), for an existing database.
--
--   docker exec -i <postgres> psql -U <owner> -d orazaka_db < infra/migrations/2026-10-30-flux1-schnell.sql
--
-- The still for the public sites' renders on a 24 GB cloud card (worker-media profile `render`). Apache-2.0 weights: commercial
-- use allowed. FLUX.1 [dev] is NOT listed: its weights are under the FLUX.1 [dev] Non-Commercial License. Never a default.
-- Idempotent.
\c orazaka_db

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware) VALUES
('flux-1-schnell', 'FLUX.1 [schnell] (Q8_0)', 'image', NULL, 'localai-image', FALSE, 4, NULL, NULL)
ON CONFLICT (model_name) DO NOTHING;

UPDATE orazaka_models SET description = 'FLUX.1 [schnell] (Apache-2.0) — 1024 px stills in 4 steps on a 24 GB cloud card. The renders of the public sites; commercially usable.' WHERE model_name = 'flux-1-schnell';
UPDATE orazaka_models SET vendor = 'Black Forest Labs', family = 'FLUX.1 schnell', capabilities = 'image', runs_on = 'local', runtime = 'stable-diffusion.cpp · CUDA (24 GB)', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/black-forest-labs/FLUX.1-schnell', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'flux-1-schnell';
