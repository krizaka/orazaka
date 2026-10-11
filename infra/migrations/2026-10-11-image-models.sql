-- The local image catalogue lists what sd-server can actually serve (orazaka-job-service
-- infra/initdb/30-jobs-config.sql carries the same rows for a fresh database).
--
-- FLUX.2 [klein] 4B (Apache-2.0) becomes the image default: 1024 px editorial-grade images in
-- 4 steps, ~82 s on an M1 Max, where the previous default named a model nothing installed
-- (stable-diffusion-xl) while sd-server ran SD 1.5 at 512 px. SDXL Turbo leaves the catalogue —
-- its licence is non-commercial — and so do the two rows no local backend serves.
-- Install and serve: orazaka models image pull flux-2-klein-4b && orazaka models image use flux-2-klein-4b
\c orazaka_db

DELETE FROM orazaka_models
 WHERE category = 'image'
   AND model_name IN ('sdxl-turbo-gguf', 'sd-1.5-apple-coreml', 'stable-diffusion-xl');

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware) VALUES
('flux-2-klein-4b', 'FLUX.2 [klein] 4B', 'image', NULL, 'localai-image', FALSE, 4, NULL, NULL),
('z-image-turbo', 'Z-Image Turbo', 'image', NULL, 'localai-image', FALSE, 8, NULL, NULL)
ON CONFLICT (model_name) DO NOTHING;

UPDATE orazaka_models SET model_label = 'Stable Diffusion 1.5', max_steps = 20, supported_hardware = NULL
 WHERE model_name = 'v1-5-pruned-emaonly';

UPDATE orazaka_models SET is_default = (model_name = 'flux-2-klein-4b') WHERE category = 'image';

UPDATE orazaka_models SET description = 'FLUX.2 [klein] 4B (Apache-2.0) — editorial photographs, illustrations and miniatures in 4 steps, 1024 px in about 80 s on an M1 Max. Local image default.' WHERE model_name = 'flux-2-klein-4b';
UPDATE orazaka_models SET description = 'Z-Image Turbo (Apache-2.0) — the most detailed photographs, about three times slower than FLUX.2 [klein]. Renders lettering readily: keep words out of the prompt.' WHERE model_name = 'z-image-turbo';
UPDATE orazaka_models SET description = 'Stable Diffusion 1.5 (CreativeML OpenRAIL-M) — the former default: 512 px, short prompts. For small machines.' WHERE model_name = 'v1-5-pruned-emaonly';

-- The image capability's contract: a seed, a negative prompt and a step count beside the size,
-- and the model, seed and generation time reported with the image (ADR-075).
UPDATE orazaka_capabilities SET
    input_schema  = $${"type":"object","properties":{"prompt":{"type":"string","format":"prose"},"size":{"type":"string","default":"1024x1024"},"negativePrompt":{"type":"string"},"seed":{"type":"string"},"steps":{"type":"string"},"model":{"type":"string"}},"required":["prompt"]}$$::jsonb,
    output_schema = $${"type":"object","properties":{"url":{"type":"string"},"format":{"type":"string"},"model":{"type":"string"},"seed":{"type":"string"},"generationMs":{"type":"integer"}},"required":["url"]}$$::jsonb
 WHERE feature_key = 'orazaka.core.media.image';
