---
title: "ADR-075 — The local image engine: FLUX.2 [klein] 4B, recipes, art direction"
description: "Local image generation moves from Stable Diffusion 1.5 at 512 px to FLUX.2 [klein] 4B (Apache-2.0) at 1024 px through the same stable-diffusion.cpp server. The catalogue lists only what that server can serve; the CLI holds each model's install recipe; requests carry size, seed, negative prompt and step count; four art-direction Studios wrap the image capability."
category: ADR
order: 75
---

# ADR-075 — The local image engine: FLUX.2 [klein] 4B, recipes, art direction

- **Status**: Accepted
- **Date**: 2026-10-11
- **Builds on**: [ADR-047](ADR-047-credit-scale-and-image-metering.md) (image metering) · **Scope**: `orazaka-ai-engine`, `orazaka-job-service`, `orazaka-cli`, `orazaka-packs`, `krizaka-billing`

## Context

Images were made by `sd-server` (stable-diffusion.cpp, Metal) running SD 1.5: 512 px whatever a Studio asked
(the size never left the job service), a 77-token prompt that dropped half of any real description, no seed, and a
catalogue whose default (`stable-diffusion-xl`) named a model nothing installed. The step count billed by
`IMAGE_STEP` came from an env var the CLI also passed to `sd-server --steps` — ADR-047's weakest link.

## Decision

1. **Model.** FLUX.2 [klein] 4B, Q8 GGUF, with Qwen3-4B as text encoder and the FLUX.2 VAE — all Apache-2.0 —
   is the local default; Z-Image Turbo (Apache-2.0) is the slower, more detailed alternative; SD 1.5 stays for
   small machines. Measured on an M1 Max 64 GB: 1024×1024 in ~82 s, 1024×1280 in ~105 s, peak 10 GB, no thermal
   warning (Z-Image Turbo 233 s, SD 1.5 at 512 px 68 s). **Refused for licence**: SDXL Turbo (non-commercial),
   SD 3.5 (revenue-capped community licence), FLUX.1 [dev] and FLUX.2 [klein] 9B (non-commercial).
2. **Same backend.** stable-diffusion.cpp already serves FLUX.2, Z-Image and SD; no diffusers pipeline in the
   media worker, no second accelerator.
3. **Catalogue vs recipe.** `orazaka_models` (data, in the DB) says which image model is the default; the CLI's
   `image-model-recipes.json` says how to download (pinned size + sha256), and launch it (files, steps, guidance,
   flags). A recipe's id is the row's `model_name`. `sd-server` serves one model at a time: `orazaka start` serves
   the catalogue's default and nothing else, so no image ever carries another model's name. `orazaka models image
   list|pull|use` installs and chooses.
4. **Requests carry the direction.** `ImageRequest` holds an `ImageDirection` (negative prompt, seed, steps); the
   adapter sends the size in `size` and the rest in stable-diffusion.cpp's `<sd_cpp_extra_args>`. It **always sends
   the step count** (caller → catalogue `max_steps` → deployment), so `IMAGE_STEP` bills what the server was told to
   run. The job always runs with a seed and reports `seed`, `model`, `generationMs` with the image.
5. **Art direction is a blueprint, not an engine.** Four TOOLKIT Studios of `orazaka-media` (golden-hour editorial,
   tilt-shift miniature, artisanal still life, Montreal neon night) wrap the actor's subject in a structured prompt
   (light, optics, materials, palette), offer 4:5 / 16:9 / 1:1 / 9:16, and are granted wherever image generation is.

## Consequences

- Existing databases: `infra/migrations/2026-10-11-image-models.sql` and `2026-10-11-art-direction-grants.sql`.
- One model in memory at a time; switching is `orazaka models image use <id>` and a restart.
- FLUX.2 [klein] runs at guidance 1 and ignores a negative prompt: Studios say so, and keep "no text, no logos" in
  the prompt itself.
