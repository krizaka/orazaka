-- =============================================================================
-- The provider-hosted models of the dev deployment, with their registry metadata (ORA-MODELS).
-- Run after infra/deploy/dev-data.sql (which creates the provider and the first rows) and after
-- infra/migrations/2026-10-14-model-registry.sql. Idempotent; routing and defaults are never touched here.
--
-- 'planned' = the row exists but the inference key is not (yet) allowed to serve the model: flip it to
-- 'available' once an answer has been measured, with one UPDATE — the site publishes what this says.
-- Licences and context windows are those of each model's card (Hugging Face).
-- =============================================================================
BEGIN;

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default)
VALUES ('mistral-3-14B', 'Mistral 3 14B', 'chat', NULL, 'do-inference', FALSE)
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET vendor = 'Mistral AI', family = 'Mistral 3', capabilities = 'chat', runs_on = 'provider', runtime = 'DigitalOcean serverless inference', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/mistralai/Ministral-3-14B-Instruct-2512/blob/main/README.md', context_window = 262144, status = 'available' WHERE model_name = 'mistral-3-14B';

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default)
VALUES ('deepseek-v4-pro', 'DeepSeek V4 Pro', 'chat', NULL, 'do-inference', FALSE)
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET vendor = 'DeepSeek', family = 'DeepSeek V4', capabilities = 'chat,reasoning', runs_on = 'provider', runtime = 'DigitalOcean serverless inference', open_weights = TRUE, licence = 'MIT', licence_url = 'https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/blob/main/LICENSE', context_window = 1048576, status = 'planned' WHERE model_name = 'deepseek-v4-pro';

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default)
VALUES ('llama-4-maverick', 'Llama 4 Maverick', 'chat', NULL, 'do-inference', FALSE)
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET vendor = 'Meta', family = 'Llama 4', capabilities = 'chat', runs_on = 'provider', runtime = 'DigitalOcean serverless inference', open_weights = TRUE, licence = 'Llama 4 Community Licence', licence_url = 'https://github.com/meta-llama/llama-models/blob/main/models/llama4/LICENSE', context_window = 1048576, status = 'planned' WHERE model_name = 'llama-4-maverick';

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default)
VALUES ('gemma-4-31B-it', 'Gemma 4 31B', 'chat', NULL, 'do-inference', FALSE)
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET vendor = 'Google', family = 'Gemma 4', capabilities = 'chat', runs_on = 'provider', runtime = 'DigitalOcean serverless inference', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/google/gemma-4-31B-it/blob/main/README.md', context_window = 262144, status = 'planned' WHERE model_name = 'gemma-4-31B-it';

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default)
VALUES ('gte-large-en-v1.5', 'GTE Large (en) v1.5', 'embedding', NULL, 'do-inference', FALSE)
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET vendor = 'Alibaba-NLP', family = 'GTE', capabilities = 'embeddings', runs_on = 'provider', runtime = 'DigitalOcean serverless inference', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Alibaba-NLP/gte-large-en-v1.5/blob/main/README.md', context_window = 8192, status = 'planned' WHERE model_name = 'gte-large-en-v1.5';

COMMIT;
