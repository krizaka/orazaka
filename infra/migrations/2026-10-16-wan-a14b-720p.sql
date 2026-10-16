-- Wan 2.2 T2V A14B at 720p, run on our own 80 GB GPU worker (orazaka-worker-media `hero` profile: RunPod H100/A100) —
-- the showcase model. Distinct from `wan2-2-t2v-a14b`, the same checkpoint served at 832x480 by DigitalOcean serverless
-- inference. Same provider as the other GPU Wan models (`localai-video`, through the relay). Idempotent.
\c orazaka_db

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware, description)
VALUES ('wan2.2-t2v-a14b', 'Wan 2.2 T2V A14B (720p, GPU)', 'video', NULL, 'localai-video', FALSE, 40, 16, NULL,
        'Wan 2.2 A14B (Apache-2.0) run on our own 80 GB GPU worker — text-to-video at 1280x720 (16:9) or 720x1280 (9:16), 5 s at 16 fps, two experts, the seed makes the same shot again. The showcase model.')
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET vendor = 'Alibaba (Wan-AI)', family = 'Wan 2.2', capabilities = 'video', runs_on = 'local', runtime = 'worker-media · CUDA (80 GB)', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B-Diffusers', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'wan2.2-t2v-a14b';
