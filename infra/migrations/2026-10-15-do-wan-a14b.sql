-- Wan 2.2 A14B on DigitalOcean serverless inference, routed by Orazaka (orazaka-worker-media, app/remote_video.py).
-- Text-to-video, 832x480 (16:9 only, measured), 5 s @ 16 fps, $0.60 per clip, the seed is honoured. The model is
-- served by the provider `do-inference` (its key is a model access key listing the model); the worker that makes the
-- Orazaka run reads it from AI_INFERENCE_KEY. Idempotent.
\c orazaka_db

INSERT INTO ai_providers (name, base_url, api_key)
VALUES ('do-inference', 'https://inference.do-ai.run', 'not-required')
ON CONFLICT (name) DO NOTHING;

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware) VALUES
('wan2-2-t2v-a14b', 'Wan 2.2 T2V A14B (serverless)', 'video', NULL, 'do-inference', FALSE, 0, 16, NULL)
ON CONFLICT (model_name) DO NOTHING;

UPDATE orazaka_models SET description = 'Wan 2.2 A14B (Apache-2.0) on DigitalOcean serverless inference, routed by Orazaka — text-to-video, 832x480 in 16:9, 5 s at 16 fps, $0.60 a clip, the seed makes the same shot again. The cinematic model of the demos.' WHERE model_name = 'wan2-2-t2v-a14b';
UPDATE orazaka_models SET vendor = 'Alibaba (Wan-AI)', family = 'Wan 2.2', capabilities = 'video', runs_on = 'provider', runtime = 'DigitalOcean serverless inference', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'wan2-2-t2v-a14b';
