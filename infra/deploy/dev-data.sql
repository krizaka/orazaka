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
-- Ollama, for the Studios' chat and vision steps while the GPU runs (qwen2.5:7b, llava) — the same relay.
UPDATE ai_providers SET base_url = 'http://gpu-relay:11434' WHERE name = 'ollama';

COMMIT;
