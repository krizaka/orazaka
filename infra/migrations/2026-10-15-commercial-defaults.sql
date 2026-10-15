-- 2026-10-15 — Commercially usable defaults (ORA-MODELS follow-up), for an existing database; orazaka-job-service
-- infra/initdb/30-jobs-config.sql carries the same for a fresh one.
--
--   docker exec -i <postgres> psql -U <owner> -d orazaka_db < infra/migrations/2026-10-15-commercial-defaults.sql
--
-- We sell to firms: no default model may carry a non-commercial licence. The English speech default was Ryan (the
-- RyanSpeech dataset is CC BY-NC-SA 4.0, its model card): it gives way to piper-en-medium-ljspeech (LJSpeech, public
-- domain). Ryan and Lessac stay available, never defaults. `commercial_use` says it on every model
-- (yes | conditions | no). The unfiltered/abliterated chat models are 'internal': in the catalogue and usable by an operator
-- who serves one, never published on the marketing site. Run after 2026-10-14-model-registry.sql. Idempotent.
-- Billing: the price rows of the new voice are in 2026-10-15-commercial-voice-price.sql (krizaka_billing_db).
\c orazaka_db

ALTER TABLE orazaka_models ADD COLUMN IF NOT EXISTS commercial_use VARCHAR(12);
ALTER TABLE orazaka_models DROP CONSTRAINT IF EXISTS ck_models_commercial_use;
ALTER TABLE orazaka_models ADD CONSTRAINT ck_models_commercial_use CHECK (commercial_use IS NULL OR commercial_use IN ('yes', 'conditions', 'no'));

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware) VALUES
('piper-en-medium-ljspeech', 'Piper LJSpeech (en)', 'speech', 'LJSpeech,Medium', 'localai', FALSE, NULL, NULL, NULL)
ON CONFLICT (model_name) DO NOTHING;

UPDATE orazaka_models SET description = 'Balanced English neural TTS (Piper, Ryan voice). Natural prosody at modest CPU cost. Non-commercial dataset (CC BY-NC-SA 4.0): for evaluation, not for sale.' WHERE model_name = 'piper-en-medium-ryan';
UPDATE orazaka_models SET description = 'English neural TTS (Piper, LJSpeech voice, public domain). Clear, neutral prosody at modest CPU cost — commercially usable. Local speech default.' WHERE model_name = 'piper-en-medium-ljspeech';
UPDATE orazaka_models SET locale = 'en' WHERE model_name = 'piper-en-medium-ljspeech';
-- the unique index allows one default per locale: free the slot before taking it
UPDATE orazaka_models SET locale_default = FALSE WHERE model_name = 'piper-en-medium-ryan';
UPDATE orazaka_models SET locale_default = TRUE WHERE model_name = 'piper-en-medium-ljspeech';
UPDATE orazaka_models SET is_default = FALSE WHERE model_name = 'piper-en-medium-ryan';
UPDATE orazaka_models SET is_default = TRUE WHERE model_name = 'piper-en-medium-ljspeech';

UPDATE orazaka_models SET vendor = 'Alibaba Cloud', family = 'Qwen 2.5', capabilities = 'chat', runs_on = 'local', runtime = 'Ollama', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/blob/main/LICENSE', commercial_use = 'yes', context_window = 32768, status = 'available' WHERE model_name = 'qwen2.5:7b';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'huihui_ai/qwen2.5-abliterate:7b';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'dolphin-llama3:8b';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'mdq100/Gemma3-Instruct-Abliterated:27b';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'tinyllama:latest';
UPDATE orazaka_models SET vendor = 'Alibaba Cloud', family = 'Qwen 2.5 Coder', capabilities = 'code', runs_on = 'local', runtime = 'Ollama', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/main/LICENSE', commercial_use = 'yes', context_window = 32768, status = 'available' WHERE model_name = 'qwen2.5-coder:7b';
UPDATE orazaka_models SET vendor = 'Meta', family = 'Code Llama', capabilities = 'code', runs_on = 'local', runtime = 'Ollama', open_weights = TRUE, licence = 'Llama 2 Community Licence', licence_url = 'https://ai.meta.com/llama/license/', commercial_use = 'conditions', context_window = 16384, status = 'available' WHERE model_name = 'codellama:7b';
UPDATE orazaka_models SET vendor = 'LLaVA team', family = 'LLaVA 1.6', capabilities = 'vision', runs_on = 'local', runtime = 'Ollama', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://ollama.com/library/llava', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'llava:latest';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'llava:v1.6';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'bakllava:latest';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'llama3.2-vision:latest';
UPDATE orazaka_models SET vendor = 'OpenAI', family = 'Whisper', capabilities = 'speech-to-text', runs_on = 'local', runtime = 'LocalAI · whisper.cpp', open_weights = TRUE, licence = 'MIT', licence_url = 'https://github.com/openai/whisper/blob/main/LICENSE', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'whisper-base';
UPDATE orazaka_models SET vendor = 'OpenAI', family = 'Whisper', capabilities = 'speech-to-text', runs_on = 'local', runtime = 'LocalAI · whisper.cpp', open_weights = TRUE, licence = 'MIT', licence_url = 'https://github.com/openai/whisper/blob/main/LICENSE', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'whisper-tiny-en';
UPDATE orazaka_models SET vendor = 'Rhasspy', family = 'Piper (en-US, Lessac)', capabilities = 'text-to-speech', runs_on = 'local', runtime = 'LocalAI · Piper', open_weights = TRUE, licence = 'Lessac Blizzard 2013 data licence', licence_url = 'https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html', commercial_use = 'no', context_window = NULL, status = 'available' WHERE model_name = 'piper-en-low';
UPDATE orazaka_models SET vendor = 'Rhasspy', family = 'Piper (en-US, LJSpeech)', capabilities = 'text-to-speech', runs_on = 'local', runtime = 'LocalAI · Piper', open_weights = TRUE, licence = 'Public domain', licence_url = 'https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/medium/MODEL_CARD', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'piper-en-medium-ljspeech';
UPDATE orazaka_models SET vendor = 'Rhasspy', family = 'Piper (en-US, Ryan)', capabilities = 'text-to-speech', runs_on = 'local', runtime = 'LocalAI · Piper', open_weights = TRUE, licence = 'CC BY-NC-SA 4.0', licence_url = 'https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ryan/medium/MODEL_CARD', commercial_use = 'no', context_window = NULL, status = 'available' WHERE model_name = 'piper-en-medium-ryan';
UPDATE orazaka_models SET vendor = 'Rhasspy', family = 'Piper (fr-FR, UPMC)', capabilities = 'text-to-speech', runs_on = 'local', runtime = 'LocalAI · Piper', open_weights = TRUE, licence = 'CC BY-SA 4.0', licence_url = 'https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/upmc/medium/MODEL_CARD', commercial_use = 'conditions', context_window = NULL, status = 'available' WHERE model_name = 'piper-fr-medium';
UPDATE orazaka_models SET vendor = 'Rhasspy', family = 'Piper (fr-FR, Siwis)', capabilities = 'text-to-speech', runs_on = 'local', runtime = 'LocalAI · Piper', open_weights = TRUE, licence = 'CC BY 4.0', licence_url = 'https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'piper-fr-siwis-medium';
UPDATE orazaka_models SET vendor = 'Rhasspy', family = 'Piper (fr-FR, Tom)', capabilities = 'text-to-speech', runs_on = 'local', runtime = 'LocalAI · Piper', open_weights = TRUE, licence = 'AGPL-3.0', licence_url = 'https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/tom/medium/MODEL_CARD', commercial_use = 'conditions', context_window = NULL, status = 'available' WHERE model_name = 'piper-fr-tom-medium';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'tts-1';
UPDATE orazaka_models SET vendor = 'Black Forest Labs', family = 'FLUX.2 klein', capabilities = 'image', runs_on = 'local', runtime = 'stable-diffusion.cpp · Metal, CUDA', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/blob/main/README.md', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'flux-2-klein-4b';
UPDATE orazaka_models SET vendor = 'Tongyi Lab (Alibaba)', family = 'Z-Image', capabilities = 'image', runs_on = 'local', runtime = 'stable-diffusion.cpp · Metal, CUDA', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Tongyi-MAI/Z-Image-Turbo/blob/main/README.md', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'z-image-turbo';
UPDATE orazaka_models SET vendor = 'Stability AI', family = 'Stable Diffusion 1.5', capabilities = 'image', runs_on = 'local', runtime = 'stable-diffusion.cpp · Metal, CUDA', open_weights = TRUE, licence = 'CreativeML OpenRAIL-M', licence_url = 'https://huggingface.co/spaces/CompVis/stable-diffusion-license', commercial_use = 'conditions', context_window = NULL, status = 'available' WHERE model_name = 'v1-5-pruned-emaonly';
UPDATE orazaka_models SET vendor = 'Black Forest Labs', family = 'FLUX.1 schnell', capabilities = 'image', runs_on = 'local', runtime = 'MLX · Apple Silicon', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/argmaxinc/mlx-FLUX.1-schnell-4bit-quantized/blob/main/README.md', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'argmaxinc/mlx-FLUX.1-schnell-4bit-quantized';
UPDATE orazaka_models SET vendor = 'ByteDance', family = 'AnimateDiff-Lightning', capabilities = 'video', runs_on = 'local', runtime = 'PyTorch MPS · Apple Metal', open_weights = TRUE, licence = 'CreativeML OpenRAIL-M', licence_url = 'https://huggingface.co/ByteDance/AnimateDiff-Lightning/blob/main/README.md', commercial_use = 'conditions', context_window = NULL, status = 'available' WHERE model_name = 'animatediff-lightning-mps';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'ByteDance/AnimateDiff-Lightning';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'mlx-animatediff-lightning';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'mlx-stable-diffusion-video';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'apple-coreml-video-pipeline';
UPDATE orazaka_models SET vendor = 'Stability AI', family = 'Stable Video Diffusion', capabilities = 'video', runs_on = 'local', runtime = 'CUDA, more than 64 GB of memory', open_weights = TRUE, licence = 'Stability AI Community Licence', licence_url = 'https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt/blob/main/LICENSE.md', commercial_use = 'conditions', context_window = NULL, status = 'available' WHERE model_name = 'stable-video-diffusion-img2vid-xt';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'stable-video-diffusion-img2vid-xt-mps-fp32';
UPDATE orazaka_models SET vendor = 'Alibaba (Wan-AI)', family = 'Wan 2.2', capabilities = 'video', runs_on = 'local', runtime = 'worker-media · CUDA', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers/blob/main/README.md', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'wan2.2-ti2v-5b';
UPDATE orazaka_models SET vendor = 'Alibaba (Wan-AI)', family = 'Wan 2.1', capabilities = 'video', runs_on = 'local', runtime = 'worker-media · CUDA', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/blob/main/README.md', commercial_use = 'yes', context_window = NULL, status = 'available' WHERE model_name = 'wan2.1-t2v-1.3b';
