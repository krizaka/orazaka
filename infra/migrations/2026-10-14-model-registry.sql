-- 2026-10-14 — The model registry (ORA-MODELS): what the site and the docs publish about every model, in the table
-- Orazaka's routing already reads. For an existing database; orazaka-job-service infra/initdb/30-jobs-config.sql
-- carries the same columns and rows for a fresh one.
--
--   docker exec -i <postgres> psql -U <owner> -d orazaka_db < infra/migrations/2026-10-14-model-registry.sql
--
-- vendor / family / capabilities / runs_on / runtime / open_weights / licence / licence_url / context_window / status.
-- Routing never reads them. Licences are those of each model's own card (Hugging Face, Ollama's licence layer);
-- 'internal' rows (aliases, runtime variants, test fixtures) stay in the catalogue and are never published.
-- The provider-hosted rows of a deployment: infra/deploy/dev-model-registry.sql. Idempotent.
\c orazaka_db

ALTER TABLE orazaka_models
  ADD COLUMN IF NOT EXISTS vendor VARCHAR(120),
  ADD COLUMN IF NOT EXISTS family VARCHAR(120),
  ADD COLUMN IF NOT EXISTS capabilities VARCHAR(200),
  ADD COLUMN IF NOT EXISTS runs_on VARCHAR(16),
  ADD COLUMN IF NOT EXISTS runtime VARCHAR(160),
  ADD COLUMN IF NOT EXISTS open_weights BOOLEAN,
  ADD COLUMN IF NOT EXISTS licence VARCHAR(160),
  ADD COLUMN IF NOT EXISTS licence_url VARCHAR(400),
  ADD COLUMN IF NOT EXISTS context_window INT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'internal';

ALTER TABLE orazaka_models DROP CONSTRAINT IF EXISTS ck_models_runs_on;
ALTER TABLE orazaka_models ADD CONSTRAINT ck_models_runs_on CHECK (runs_on IS NULL OR runs_on IN ('local', 'provider'));
ALTER TABLE orazaka_models DROP CONSTRAINT IF EXISTS ck_models_status;
ALTER TABLE orazaka_models ADD CONSTRAINT ck_models_status CHECK (status IN ('available', 'planned', 'internal'));

UPDATE orazaka_models SET vendor = 'Alibaba Cloud', family = 'Qwen 2.5', capabilities = 'chat', runs_on = 'local', runtime = 'Ollama', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/blob/main/LICENSE', context_window = 32768, status = 'available' WHERE model_name = 'qwen2.5:7b';
UPDATE orazaka_models SET vendor = 'Alibaba Cloud', family = 'Qwen 2.5 (unfiltered)', capabilities = 'chat', runs_on = 'local', runtime = 'Ollama', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/blob/main/LICENSE', context_window = 32768, status = 'available' WHERE model_name = 'huihui_ai/qwen2.5-abliterate:7b';
UPDATE orazaka_models SET vendor = 'Cognitive Computations', family = 'Dolphin 2.9 (Llama 3, unfiltered)', capabilities = 'chat', runs_on = 'local', runtime = 'Ollama', open_weights = TRUE, licence = 'Meta Llama 3 Community Licence', licence_url = 'https://www.llama.com/llama3/license/', context_window = 8192, status = 'available' WHERE model_name = 'dolphin-llama3:8b';
UPDATE orazaka_models SET vendor = 'Google', family = 'Gemma 3 (unfiltered)', capabilities = 'chat', runs_on = 'local', runtime = 'Ollama', open_weights = TRUE, licence = 'Gemma Terms of Use', licence_url = 'https://ai.google.dev/gemma/terms', context_window = 131072, status = 'available' WHERE model_name = 'mdq100/Gemma3-Instruct-Abliterated:27b';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'tinyllama:latest';
UPDATE orazaka_models SET vendor = 'Alibaba Cloud', family = 'Qwen 2.5 Coder', capabilities = 'code', runs_on = 'local', runtime = 'Ollama', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/main/LICENSE', context_window = 32768, status = 'available' WHERE model_name = 'qwen2.5-coder:7b';
UPDATE orazaka_models SET vendor = 'Meta', family = 'Code Llama', capabilities = 'code', runs_on = 'local', runtime = 'Ollama', open_weights = TRUE, licence = 'Llama 2 Community Licence', licence_url = 'https://ai.meta.com/llama/license/', context_window = 16384, status = 'available' WHERE model_name = 'codellama:7b';
UPDATE orazaka_models SET vendor = 'LLaVA team', family = 'LLaVA 1.6', capabilities = 'vision', runs_on = 'local', runtime = 'Ollama', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://ollama.com/library/llava', context_window = NULL, status = 'available' WHERE model_name = 'llava:latest';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'llava:v1.6';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'bakllava:latest';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'llama3.2-vision:latest';
UPDATE orazaka_models SET vendor = 'OpenAI', family = 'Whisper', capabilities = 'speech-to-text', runs_on = 'local', runtime = 'LocalAI · whisper.cpp', open_weights = TRUE, licence = 'MIT', licence_url = 'https://github.com/openai/whisper/blob/main/LICENSE', context_window = NULL, status = 'available' WHERE model_name = 'whisper-base';
UPDATE orazaka_models SET vendor = 'OpenAI', family = 'Whisper', capabilities = 'speech-to-text', runs_on = 'local', runtime = 'LocalAI · whisper.cpp', open_weights = TRUE, licence = 'MIT', licence_url = 'https://github.com/openai/whisper/blob/main/LICENSE', context_window = NULL, status = 'available' WHERE model_name = 'whisper-tiny-en';
UPDATE orazaka_models SET vendor = 'Rhasspy', family = 'Piper (en-US, Lessac)', capabilities = 'text-to-speech', runs_on = 'local', runtime = 'LocalAI · Piper', open_weights = TRUE, licence = 'Lessac Blizzard 2013 data licence', licence_url = 'https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html', context_window = NULL, status = 'available' WHERE model_name = 'piper-en-low';
UPDATE orazaka_models SET vendor = 'Rhasspy', family = 'Piper (en-US, Ryan)', capabilities = 'text-to-speech', runs_on = 'local', runtime = 'LocalAI · Piper', open_weights = TRUE, licence = 'CC BY-NC-SA 4.0', licence_url = 'https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ryan/medium/MODEL_CARD', context_window = NULL, status = 'available' WHERE model_name = 'piper-en-medium-ryan';
UPDATE orazaka_models SET vendor = 'Rhasspy', family = 'Piper (fr-FR, UPMC)', capabilities = 'text-to-speech', runs_on = 'local', runtime = 'LocalAI · Piper', open_weights = TRUE, licence = 'CC BY-SA 4.0', licence_url = 'https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/upmc/medium/MODEL_CARD', context_window = NULL, status = 'available' WHERE model_name = 'piper-fr-medium';
UPDATE orazaka_models SET vendor = 'Rhasspy', family = 'Piper (fr-FR, Siwis)', capabilities = 'text-to-speech', runs_on = 'local', runtime = 'LocalAI · Piper', open_weights = TRUE, licence = 'CC BY 4.0', licence_url = 'https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD', context_window = NULL, status = 'available' WHERE model_name = 'piper-fr-siwis-medium';
UPDATE orazaka_models SET vendor = 'Rhasspy', family = 'Piper (fr-FR, Tom)', capabilities = 'text-to-speech', runs_on = 'local', runtime = 'LocalAI · Piper', open_weights = TRUE, licence = 'AGPL-3.0', licence_url = 'https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/tom/medium/MODEL_CARD', context_window = NULL, status = 'available' WHERE model_name = 'piper-fr-tom-medium';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'tts-1';
UPDATE orazaka_models SET vendor = 'Black Forest Labs', family = 'FLUX.2 klein', capabilities = 'image', runs_on = 'local', runtime = 'stable-diffusion.cpp · Metal, CUDA', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/blob/main/README.md', context_window = NULL, status = 'available' WHERE model_name = 'flux-2-klein-4b';
UPDATE orazaka_models SET vendor = 'Tongyi Lab (Alibaba)', family = 'Z-Image', capabilities = 'image', runs_on = 'local', runtime = 'stable-diffusion.cpp · Metal, CUDA', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Tongyi-MAI/Z-Image-Turbo/blob/main/README.md', context_window = NULL, status = 'available' WHERE model_name = 'z-image-turbo';
UPDATE orazaka_models SET vendor = 'Stability AI', family = 'Stable Diffusion 1.5', capabilities = 'image', runs_on = 'local', runtime = 'stable-diffusion.cpp · Metal, CUDA', open_weights = TRUE, licence = 'CreativeML OpenRAIL-M', licence_url = 'https://huggingface.co/spaces/CompVis/stable-diffusion-license', context_window = NULL, status = 'available' WHERE model_name = 'v1-5-pruned-emaonly';
UPDATE orazaka_models SET vendor = 'Black Forest Labs', family = 'FLUX.1 schnell', capabilities = 'image', runs_on = 'local', runtime = 'MLX · Apple Silicon', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/argmaxinc/mlx-FLUX.1-schnell-4bit-quantized/blob/main/README.md', context_window = NULL, status = 'available' WHERE model_name = 'argmaxinc/mlx-FLUX.1-schnell-4bit-quantized';
UPDATE orazaka_models SET vendor = 'ByteDance', family = 'AnimateDiff-Lightning', capabilities = 'video', runs_on = 'local', runtime = 'PyTorch MPS · Apple Metal', open_weights = TRUE, licence = 'CreativeML OpenRAIL-M', licence_url = 'https://huggingface.co/ByteDance/AnimateDiff-Lightning/blob/main/README.md', context_window = NULL, status = 'available' WHERE model_name = 'animatediff-lightning-mps';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'ByteDance/AnimateDiff-Lightning';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'mlx-animatediff-lightning';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'mlx-stable-diffusion-video';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'apple-coreml-video-pipeline';
UPDATE orazaka_models SET vendor = 'Stability AI', family = 'Stable Video Diffusion', capabilities = 'video', runs_on = 'local', runtime = 'CUDA, more than 64 GB of memory', open_weights = TRUE, licence = 'Stability AI Community Licence', licence_url = 'https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt/blob/main/LICENSE.md', context_window = NULL, status = 'available' WHERE model_name = 'stable-video-diffusion-img2vid-xt';
UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'stable-video-diffusion-img2vid-xt-mps-fp32';
UPDATE orazaka_models SET vendor = 'Alibaba (Wan-AI)', family = 'Wan 2.2', capabilities = 'video', runs_on = 'local', runtime = 'worker-media · CUDA', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers/blob/main/README.md', context_window = NULL, status = 'available' WHERE model_name = 'wan2.2-ti2v-5b';
UPDATE orazaka_models SET vendor = 'Alibaba (Wan-AI)', family = 'Wan 2.1', capabilities = 'video', runs_on = 'local', runtime = 'worker-media · CUDA', open_weights = TRUE, licence = 'Apache-2.0', licence_url = 'https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/blob/main/README.md', context_window = NULL, status = 'available' WHERE model_name = 'wan2.1-t2v-1.3b';
