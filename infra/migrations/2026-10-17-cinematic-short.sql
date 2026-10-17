-- A cinematic short (ADR-080): the shot model in the catalogue, and the two new Studios of the media TOOLKIT granted
-- wherever video generation is. Idempotent.
--
-- Wan 2.2 I2V A14B, run on our own 80 GB GPU worker (orazaka-worker-media profile `cinema`, RunPod H100/A100) in four
-- distilled steps (lightx2v LoRA pair, Apache-2.0): every shot starts from its keyframe. Same provider as the other GPU
-- Wan models (`localai-video`, through the relay).
\c orazaka_db
SET search_path = public;

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware, description)
VALUES ('wan2.2-i2v-a14b', 'Wan 2.2 I2V A14B (720p, 4-step distill)', 'video', NULL, 'localai-video', FALSE, 4, 16, NULL,
        'Wan 2.2 I2V A14B (Apache-2.0) with lightx2v''s 4-step distillation LoRAs (Apache-2.0), run on our own 80 GB GPU worker — image-to-video at 1280x720 (16:9) or 720x1280 (9:16), 5 s at 16 fps, from a starting image only. The shots of a cinematic short.')
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET vendor = 'Alibaba (Wan-AI)', family = 'Wan 2.2', capabilities = 'video', runs_on = 'local', runtime = 'worker-media · CUDA (80 GB)', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B-Diffusers', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'wan2.2-i2v-a14b';

-- The cut is the compose capability given `clips` + `edit` (orazaka-job-service 30-jobs-config.sql, same schema).
UPDATE orazaka_capabilities SET input_schema = $${"type": "object", "properties": {"photos": {"type": "array", "items": {"type": "string", "format": "asset-id"}, "minItems": 1}, "audio": {"type": "string", "format": "asset-id"}, "clips": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 24}, "edit": {"type": "string"}}, "anyOf": [{"required": ["photos"]}, {"required": ["clips", "edit"]}]}$$::jsonb
 WHERE feature_key = 'orazaka.studio.media.compose';

-- The script and the cut inherit capability.video, like video-generation (2026-09-22-media-toolkit-grants.sql).
\c krizaka_billing_db
INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value)
SELECT plans.plan_key, 'studio.' || studios.studio, 'boolean', plans.value
  FROM (VALUES ('free', 'false'), ('premium', 'true'), ('ultimate', 'true')) AS plans(plan_key, value)
 CROSS JOIN (VALUES ('cinematic-script'), ('cinematic-cut')) AS studios(studio)
ON CONFLICT (plan_key, entitlement_key) DO NOTHING;

-- The BATCH lane's step ceiling: a cinematic cut (ten shots upscaled by SeedVR2, interpolated to 30 fps, graded and
-- encoded at 1080p) measured ~35 min on an H100 pod on 2026-10-17; at 1800 s the run was failed while the cut was encoding.
\c orazaka_studio_db
UPDATE studio_runtime_config
   SET config_value = '3600',
       description = 'Per-step ceiling in the BATCH lane — room for a cinematic cut (ten shots upscaled by SeedVR2, then interpolated and encoded: ~35 min measured 2026-10-17, ADR-080) and for queue wait behind image generations.'
 WHERE config_key = 'run.step-timeout-seconds.batch';

-- The voice-over of a cinematic short: Kokoro-82M (Apache-2.0) on the cinema GPU host, on the image engine's relay port
-- (orazaka-worker-media app/speech_server.py answers /v1/audio/speech and passes the rest to sd-server). Dev's other
-- speech models are the Mac's Piper voices, reachable only while the Mac is connected.
\c orazaka_db
INSERT INTO ai_providers (name, base_url, api_key) VALUES ('gpu-speech', 'http://gpu-relay:8086/v1', 'not-required')
ON CONFLICT (name) DO NOTHING;
INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware, description)
VALUES ('kokoro-82m', 'Kokoro 82M (GPU host)', 'speech', 'af_heart,af_bella,af_nicole,af_sarah,am_michael,am_fenrir,bf_emma,bm_george', 'gpu-speech', FALSE, NULL, NULL, NULL,
        'Kokoro-82M (Apache-2.0), served by the cinema GPU host — natural English voices for a voice-over (af_heart by default). The voice of a cinematic short (ADR-080).')
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET vendor = 'hexgrad', family = 'Kokoro', capabilities = 'speech', runs_on = 'local', runtime = 'worker-media · CUDA', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/hexgrad/Kokoro-82M', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'kokoro-82m';
