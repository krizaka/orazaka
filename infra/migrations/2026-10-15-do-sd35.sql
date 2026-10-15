-- Stable Diffusion 3.5 Large, hosted by DigitalOcean serverless inference ($0.08 an image) and routed by Orazaka's image capability
-- (provider do-inference: its own key, the prompt without <sd_cpp_extra_args>, ImageGeneratorClientImpl). No steps declared: hosted.
-- Idempotent.
\c orazaka_db

-- The image client of Spring AI appends /images/generations to the base URL (the local sd-server's is .../v1): the same endpoint as
-- do-inference, with the /v1 an image provider needs. Its key is set by `dev-deploy data` (never written here).
INSERT INTO ai_providers (name, base_url, api_key) VALUES ('do-inference-images', 'https://inference.do-ai.run/v1', 'not-required')
ON CONFLICT (name) DO NOTHING;
INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware, description)
VALUES ('stable-diffusion-3.5-large', 'Stable Diffusion 3.5 Large (DigitalOcean)', 'image', NULL, 'do-inference-images', FALSE, NULL, NULL, NULL,
        'Stable Diffusion 3.5 Large (Stability AI Community Licence) on DigitalOcean serverless inference, routed by Orazaka — $0.08 an image, 1024x1024, the seed is not honoured by the provider.')
ON CONFLICT (model_name) DO UPDATE SET provider_name = EXCLUDED.provider_name;
UPDATE orazaka_models SET vendor = 'Stability AI', family = 'Stable Diffusion 3.5', capabilities = 'image', runs_on = 'provider', runtime = 'DigitalOcean serverless inference', open_weights = TRUE, licence = 'Stability AI Community Licence', licence_url = 'https://stability.ai/license', commercial_use = 'conditions', context_window = NULL, status = 'available' WHERE model_name = 'stable-diffusion-3.5-large';
