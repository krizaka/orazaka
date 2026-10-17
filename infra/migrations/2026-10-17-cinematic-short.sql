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

-- The script and the cut inherit capability.video, like video-generation (2026-09-22-media-toolkit-grants.sql).
\c krizaka_billing_db
INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value)
SELECT plans.plan_key, 'studio.' || studios.studio, 'boolean', plans.value
  FROM (VALUES ('free', 'false'), ('premium', 'true'), ('ultimate', 'true')) AS plans(plan_key, value)
 CROSS JOIN (VALUES ('cinematic-script'), ('cinematic-cut')) AS studios(studio)
ON CONFLICT (plan_key, entitlement_key) DO NOTHING;
