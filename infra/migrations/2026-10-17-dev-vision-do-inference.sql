\c orazaka_db
BEGIN;
-- Dev vision without the Mac: the vision DEFAULT of the dev environment is a model on DigitalOcean serverless inference
-- (OpenAI-compatible, pay per token, no GPU, no tunnel) — as DATA, in the models table, like the chat default.
--
-- nemotron-nano-12b-v2-vl (NVIDIA Open Model License: commercial use allowed) reads an image and answers a question; it is
-- what the profile-photo-check Studio's per-photo question (and the image-analysis Studio) runs on while the Mac's Ollama is
-- not connected. llava on `ollama` stays in the catalogue, one switch away (UPDATE ... SET is_default).
--
-- Guardrail: dev only, and only fictional personas' photos go through it. A production deployment keeps vision on a model
-- Krizaka hosts, or on a hosted model whose contract forbids keeping or training on what it receives.
INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, description)
VALUES ('nemotron-nano-12b-v2-vl', 'Nemotron Nano 12B v2 VL', 'vision', NULL, 'do-inference', FALSE,
        'NVIDIA Nemotron Nano 12B v2 VL (NVIDIA Open Model License) on DigitalOcean serverless inference — the vision default of the dev '
        || 'environment: no GPU to run, no tunnel to a laptop, billed per token.')
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET is_default = (model_name = 'nemotron-nano-12b-v2-vl') WHERE category = 'vision';

-- Its registry metadata (ORA-MODELS): measured on the dev inference key on 2026-10-17 (a real image-analysis run answered).
UPDATE orazaka_models SET vendor = 'NVIDIA', family = 'Nemotron Nano v2 VL', capabilities = 'vision,chat', runs_on = 'provider', runtime = 'DigitalOcean serverless inference', open_weights = TRUE, licence = 'NVIDIA Open Model License', licence_url = 'https://huggingface.co/nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL-BF16', commercial_use = 'yes', status = 'available' WHERE model_name = 'nemotron-nano-12b-v2-vl';
COMMIT;
