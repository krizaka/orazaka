-- Sound for a video (krizaka/orazaka-packs#25) for an existing database — orazaka-job-service
-- infra/initdb/30-jobs-config.sql carries the same rows for a fresh one. Idempotent.
\c orazaka_db

-- Every generated clip was silent. `orazaka.studio.media.sound` gives one its sound: a music bed and/or
-- foley and/or a voice-over (the speech asset of the Piper voices), mixed with ducking, levelled to
-- -14 LUFS and muxed as AAC into the mp4; the silent original is kept (`silentUrl`). It is ffmpeg plus a
-- local model on the media worker's host, so it rides that worker's `job.compose.*` binding under its own
-- key and is priced as that worker's other ffmpeg work: OUTPUT_SECOND at the (VIDEO, 'orazaka-compose') row.
-- `video` is the URL a previous step returned or an asset id — only the actor's own files resolve.
-- `foleyModel` is explicit on purpose: the only foley weights this worker can run are non-commercial.
INSERT INTO orazaka_capabilities
    (feature_key, handler_key, routing_key,
     billable_unit, billable_capability, latency_class, input_schema, output_schema, is_enabled) VALUES
('orazaka.studio.media.sound', 'media.sound', 'job.compose.sound', 'OUTPUT_SECOND', 'VIDEO', 'BATCH',
  $${"type": "object", "properties": {"video": {"type": "string", "description": "The clip to give sound to: the url of an earlier step, or one of your files."}, "music": {"type": "string", "format": "prose", "description": "A music bed, described: genre, mood, instruments."}, "foley": {"type": "string", "format": "prose", "description": "The sounds of the picture, described (needs foleyModel: the only foley model is non-commercial)."}, "voice": {"type": "string", "description": "A voice-over: the url or id of a speech file of yours (Speech synthesis)."}, "seed": {"type": "string", "description": "Makes the same sound again with the same prompts and models."}, "musicModel": {"type": "string", "description": "Empty: the commercial default (acestep-v15-xl-turbo)."}, "foleyModel": {"type": "string", "description": "mmaudio-large-44k-v2 (CC-BY-NC: non-commercial). Empty: no foley."}}, "required": ["video"]}$$::jsonb,
  $${"type": "object", "properties": {"url": {"type": "string"}, "assetId": {"type": "string"}, "silentUrl": {"type": "string"}, "format": {"type": "string"}, "metrics": {"type": "object"}}, "required": ["url"]}$$::jsonb, true)
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, description) VALUES
('acestep-v15-xl-turbo', 'ACE-Step 1.5 XL turbo (music bed)', 'music', NULL, 'localai-video', TRUE,
 'ACE-Step 1.5 XL turbo (MIT) — a music bed from a prompt, 48 kHz stereo, 8 steps. The commercial default of the sound step; Metal and CUDA.'),
('mmaudio-large-44k-v2', 'MMAudio large 44k v2 (foley) — non-commercial', 'foley', NULL, 'localai-video', FALSE,
 'MMAudio (code MIT, weights CC-BY-NC 4.0) — video-to-audio foley synchronised to the picture. Non-commercial: for evaluation, never a default, asked for by name.')
ON CONFLICT (model_name) DO NOTHING;

UPDATE orazaka_models SET vendor = 'ACE Studio · StepFun', family = 'ACE-Step 1.5', capabilities = 'music', runs_on = 'local', runtime = 'worker-media · Metal, CUDA', open_weights = TRUE, licence = 'MIT', licence_url = 'https://huggingface.co/ACE-Step/acestep-v15-xl-turbo-diffusers', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'acestep-v15-xl-turbo';
UPDATE orazaka_models SET vendor = 'Sony · Hkchengrex (UIUC)', family = 'MMAudio', capabilities = 'video-to-audio', runs_on = 'local', runtime = 'worker-media · Metal, CUDA', open_weights = TRUE, licence = 'CC-BY-NC-4.0', licence_url = 'https://github.com/hkchengrex/MMAudio#licenses', commercial_use = 'no', context_window = NULL, status = 'available' WHERE model_name = 'mmaudio-large-44k-v2';
