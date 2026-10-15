---
title: Measured runs
description: Time, cost and every parameter of the video and image runs Orazaka made, per model and provider — generated from the run records.
category: Models
order: 9
generated: true
---

# Measured runs

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.
What the video and image models Orazaka routes to really did, measured on **2026-10-15**: each figure below is read from the **run records** of the platform (start and finish of every Studio run, its size and seed, its outcome) and from the engine's own log — none is typed by hand. Every number is for **this setup** and is measured again when the setup changes (a new model, engine version, provider or machine).

## Setup

| Part | What |
| --- | --- |
| Machine | MacBook Pro, Apple M1 Max, 64 GB unified memory (Metal) |
| Local engine | stable-diffusion.cpp master-647-72e512a-1-ga397e03 (sd-server, Metal) |
| Platform | Orazaka dev (DigitalOcean App Platform, Toronto) — core, relay, broker; the Mac joins through the GPU relay (chisel over TLS) |
| Hosted provider | DigitalOcean serverless inference (https://inference.do-ai.run) |
| Orazaka commit | `dbe135b` |

Times are **command to file**: from the start of the Studio run to the finished output (queueing, transfer and storage included). The engine's own time, where it is logged, is given beside it.

## Per model

| Model | Where | Runs (ok / all) | Time, command to file (median, min–max) | Engine time | Price | Spent |
| --- | --- | --- | --- | --- | --- | --- |
| **Wan 2.2 T2V A14B** (video) | DigitalOcean serverless inference | 21 / 21 | 131 s (129–203, n=18) | — | $0.60 per video | $12.60 |
| **FLUX.2 [klein] 4B (Q8_0 GGUF)** (image) | One Mac (Metal), local | 6 / 18 | 62 s (61–66, n=6) | 72.7 s (60.8–75.0, n=20) | none (your own machine) | — |
| **Stable Diffusion 1.5** (image) | One Mac (Metal), local | 6 / 6 | 58 s (58–58, n=6) | 56.6 s (56.5–56.6, n=6) | none (your own machine) | — |
| **Stable Diffusion 3.5 Large** (image) | DigitalOcean serverless inference | 6 / 6 | 8 s (7–9, n=6) | — | $0.08 per image | $0.48 |
| **Z-Image Turbo (Q8_0 GGUF)** (image) | One Mac (Metal), local | 0 / 5 | — | 157.8 s (156.7–158.9, n=2) | none (your own machine) | — |

3 runs of Wan 2.2 T2V A14B succeeded but are left out of its time statistics (worker restart during the run).

## Parameters

### Wan 2.2 T2V A14B

DigitalOcean serverless inference · licence Apache-2.0

- **size:** 832×480 (fixed by the provider: 720×1280, 480×832 and 1280×720 were all answered at 832×480)
- **frames:** 81
- **fps:** 16
- **duration:** 5.06 s
- **seed:** honoured — four calls with the same prompt and seed gave identical frames
- **steps / guidance / scheduler:** not exposed by the provider's API

### FLUX.2 [klein] 4B (Q8_0 GGUF)

One Mac (Metal), local · licence Apache-2.0

- **size:** 1024×1024
- **steps:** 4
- **guidance (cfg scale):** 1
- **sampler:** Euler
- **scheduler:** discrete
- **flags:** --diffusion-fa
- **textEncoder:** Qwen3-4B Q8_0
- **vae:** flux2-vae
- **seed:** honoured
- **memory:** 8.3 GB (VRAM)

### Stable Diffusion 1.5

One Mac (Metal), local · licence CreativeML OpenRAIL-M

- **size:** 512×512
- **steps:** 20
- **guidance (cfg scale):** 7
- **sampler:** Euler a
- **scheduler:** discrete
- **seed:** honoured

### Stable Diffusion 3.5 Large

DigitalOcean serverless inference · licence Stability AI Community Licence

- **size:** 1024×1024
- **steps / guidance / scheduler:** not exposed by the provider's API
- **seed:** not honoured (the provider ignores it)
- **output:** uncompressed PNG, about 3.1 MB

### Z-Image Turbo (Q8_0 GGUF)

One Mac (Metal), local · licence Apache-2.0

- **size:** 1024×1024
- **steps:** 8
- **guidance (cfg scale):** 1
- **sampler:** Euler
- **scheduler:** discrete
- **memory:** 10.5 GB (VRAM)

## Failures, timeouts and limits

| Kind | What happened | Cause |
| --- | --- | --- |
| access | Wan 2.2 A14B refused the first call (403) | the model access key did not list the model; an all-models key fixed it |
| limit | Wan 2.2 A14B cannot make 9:16 | every size asked (720×1280, 480×832, 1280×720, with or without aspect_ratio/resolution) came back 832×480; the model is refused for 9:16 by name rather than cropped |
| limit | Wan 2.2 TI2V 5B on the Mac (480×832, 25 frames) | MPS out of memory while decoding (26 GiB of MPS, 62 GiB held by other allocations on a 64 GB machine) |
| infrastructure | three video runs took 264 s, 439 s and 1 063 s instead of about 130 s | the Mac worker had lost its tunnel and restarted; the jobs waited in the queue (their times are left out of the statistics) |
| access | openai-gpt-image-2 refused (403) | not available for this subscription tier (tried once) |
| configuration | Stable Diffusion 3.5 Large: first Orazaka runs returned a 1×1 transparent image | the provider's base URL lacked /v1 (the client appends /images/generations): 404, then a transparent fallback; fixed with the provider do-inference-images |
| timeout | FLUX.2 [klein] returned a 1×1 placeholder on several runs (server room and notary desk on every attempt; neon arcade twice) | the image client gives up waiting through the relay (about 2 minutes) while the engine needed 60–75 s plus the transfer of a 2.5 MB image; a web deploy also restarts the relay and drops the tunnel |
| process | two FLUX.2 images (server room, notary desk) were produced in about 62 s each, then lost | later retries wrote placeholders over the same file names before they were published (a process mistake, now guarded by checking the size of each download) |
| timeout | Z-Image Turbo at 1024×1024 was dropped | the engine needs about 157 s per image (8 steps at about 18 s each), longer than the client waits |

## What it cost

| Provider | Output | Price | Runs | Spent |
| --- | --- | --- | --- | --- |
| DigitalOcean serverless inference | Wan 2.2 T2V A14B | $0.60 per video | 21 | $12.60 |
| DigitalOcean serverless inference | Stable Diffusion 3.5 Large | $0.08 per image | 6 | $0.48 |
| **Total of the runs above** |  |  |  | **$13.08** |

The local models cost nothing per output; the energy of the Mac was **not measured**, so none is claimed. Probes and refused calls (a 403, a size test) are not runs and are not in this table.

See also: [Supported models](MODELS.md) for the registry, and the comparison images on the gallery (`/gallery?kind=compare`).
