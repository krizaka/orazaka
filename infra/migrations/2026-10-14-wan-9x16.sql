-- 9:16 video on the GPU host (ADR-077) for an existing database — orazaka-job-service
-- infra/initdb/30-jobs-config.sql carries the same rows for a fresh one.
--
-- Two Wan models (Apache-2.0) join the video catalogue, served by the CUDA image of
-- orazaka-worker-media on the hourly GPU droplet (scripts/gpu-dev.sh). The video capability gains
-- `aspect` (9:16 by default: the vertical short) and `seed` (make the same clip again). Idempotent.
\c orazaka_db

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware) VALUES
('wan2.2-ti2v-5b', 'Wan 2.2 TI2V 5B (9:16, GPU)', 'video', NULL, 'localai-video', FALSE, 40, 24, NULL),
('wan2.1-t2v-1.3b', 'Wan 2.1 T2V 1.3B (9:16, GPU)', 'video', NULL, 'localai-video', FALSE, 30, 16, NULL)
ON CONFLICT (model_name) DO NOTHING;

UPDATE orazaka_models SET description = 'Wan 2.2 TI2V 5B (Apache-2.0) — vertical shorts at 704x1280, 5 s at 24 fps, on the GPU host (48 GB). The 9:16 model of the demos.' WHERE model_name = 'wan2.2-ti2v-5b';
UPDATE orazaka_models SET description = 'Wan 2.1 T2V 1.3B (Apache-2.0) — vertical clips at 480x832, 5 s at 16 fps, on the small GPU host (20 GB). Fast drafts.' WHERE model_name = 'wan2.1-t2v-1.3b';

UPDATE orazaka_capabilities
   SET input_schema = jsonb_set(
         jsonb_set(input_schema, '{properties,aspect}',
           $${"type": "string", "enum": ["9:16", "16:9", "1:1"], "default": "9:16", "description": "The frame: 9:16 is the vertical short (TikTok, Reels, Shorts)."}$$::jsonb),
         '{properties,seed}',
         $${"type": "string", "description": "Makes the same clip again with the same prompt and model."}$$::jsonb)
 WHERE feature_key = 'orazaka.core.media.video';
