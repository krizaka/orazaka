-- =============================================================================
-- Orazaka dev (App Platform) — the data that routes the dev environment (docs/DEPLOY_DEV.md)
-- -----------------------------------------------------------------------------
-- Routing is data (AGENTS.md §4): the provider a chat reaches and the model it asks for live in
-- orazaka_db, never in a file the services read. Run once against orazaka_db after the initdb files;
-- idempotent. Dev has no GPU: chat runs on serverless inference, images on the hourly GPU droplet.
-- =============================================================================
BEGIN;

-- Chat runs on DigitalOcean serverless inference (OpenAI-compatible, pay per token, no GPU, no
-- worker). The key is a model access key created in the control panel; it is set by
-- `node scripts/dev-deploy.mjs data` from the local secrets file, never written here.
INSERT INTO ai_providers (name, base_url, api_key)
VALUES ('do-inference', 'https://inference.do-ai.run', :'ai_inference_key')
ON CONFLICT (name) DO UPDATE SET base_url = EXCLUDED.base_url, api_key = EXCLUDED.api_key;

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, description)
VALUES ('mistral-3-14B', 'Mistral 3 14B', 'chat', NULL, 'do-inference', FALSE,
        'Mistral 3 14B (Apache-2.0) on DigitalOcean serverless inference — the chat default of the dev '
        || 'environment: fluent English and French, billed per token, no GPU to run.')
ON CONFLICT (model_name) DO NOTHING;
-- The other provider-hosted models (DeepSeek V4 Pro, Llama 4 Maverick, Gemma 4) and their registry metadata:
-- infra/deploy/dev-model-registry.sql, run after this file.
UPDATE orazaka_models SET is_default = (model_name = 'mistral-3-14B') WHERE category = 'chat';


-- The image and video engines are the hourly GPU droplet (scripts/gpu-dev.sh), reached inside the app
-- through the GPU relay: gpu-relay:8086 is its sd-server, gpu-relay:8188 its video pipeline. While it is
-- off nothing listens there and the capabilities are greyed out (degraded mode); nothing else changes.
UPDATE ai_providers SET base_url = 'http://gpu-relay:8086/v1', api_key = 'not-required' WHERE name = 'localai-image';
UPDATE ai_providers SET base_url = 'http://gpu-relay:8188' WHERE name = 'localai-video';
-- Speech (Piper, through LocalAI on the Mac) shares the image engine's relay port: scripts/mac-engines-router.mjs
-- answers /v1/audio/* from LocalAI and the rest from sd-server. Off while the Mac is not connected.
UPDATE ai_providers SET base_url = 'http://gpu-relay:8086/v1', api_key = 'not-required' WHERE name = 'localai';
-- Ollama, for the Studios' chat and vision steps while the GPU runs (qwen2.5:7b, llava) — the same relay.
UPDATE ai_providers SET base_url = 'http://gpu-relay:11434' WHERE name = 'ollama';

-- Wan 2.2 A14B, text-to-video: made by the provider, run by Orazaka (the media worker routes it; its key is its
-- AI_INFERENCE_KEY). Same rows as infra/migrations/2026-10-15-do-wan-a14b.sql.
INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware, description)
VALUES ('wan2-2-t2v-a14b', 'Wan 2.2 T2V A14B (serverless)', 'video', NULL, 'do-inference', FALSE, 0, 16, NULL,
        'Wan 2.2 A14B (Apache-2.0) on DigitalOcean serverless inference, routed by Orazaka — text-to-video, 832x480 in 16:9, 5 s at 16 fps, $0.60 a clip, the seed makes the same shot again. The cinematic model of the demos.')
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET vendor = 'Alibaba (Wan-AI)', family = 'Wan 2.2', capabilities = 'video', runs_on = 'provider', runtime = 'DigitalOcean serverless inference', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'wan2-2-t2v-a14b';

-- Stable Diffusion 3.5 Large, hosted by DigitalOcean serverless inference ($0.08 an image) and routed by Orazaka's image capability
-- (provider do-inference: its own key, the prompt without <sd_cpp_extra_args>, ImageGeneratorClientImpl). No steps declared: hosted.
-- The image client of Spring AI appends /images/generations to the base URL (the local sd-server's is .../v1): the same endpoint and key
-- as do-inference, with the /v1 an image provider needs.
INSERT INTO ai_providers (name, base_url, api_key)
VALUES ('do-inference-images', 'https://inference.do-ai.run/v1', :'ai_inference_key')
ON CONFLICT (name) DO UPDATE SET base_url = EXCLUDED.base_url, api_key = EXCLUDED.api_key;
INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware, description)
VALUES ('stable-diffusion-3.5-large', 'Stable Diffusion 3.5 Large (DigitalOcean)', 'image', NULL, 'do-inference-images', FALSE, NULL, NULL, NULL,
        'Stable Diffusion 3.5 Large (Stability AI Community Licence) on DigitalOcean serverless inference, routed by Orazaka — $0.08 an image, 1024x1024, the seed is not honoured by the provider.')
ON CONFLICT (model_name) DO UPDATE SET provider_name = EXCLUDED.provider_name;
UPDATE orazaka_models SET vendor = 'Stability AI', family = 'Stable Diffusion 3.5', capabilities = 'image', runs_on = 'provider', runtime = 'DigitalOcean serverless inference', open_weights = TRUE, licence = 'Stability AI Community Licence', licence_url = 'https://stability.ai/license', commercial_use = 'conditions', context_window = NULL, status = 'available' WHERE model_name = 'stable-diffusion-3.5-large';

COMMIT;
