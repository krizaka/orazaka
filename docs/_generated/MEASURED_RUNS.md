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
| **Wan 2.2 TI2V 5B (image to video, H100 80 GB)** (video) | A DigitalOcean GPU droplet, by the hour (through the relay) | 19 / 19 | 175 s (168–279, n=19) | — | $3.99 per GPU hour | $3.95 |
| **Wan 2.2 TI2V 5B (image to video, RTX 4000 Ada 20 GB)** (video) | A DigitalOcean GPU droplet, by the hour (through the relay) | 1 / 1 | 1106 s (1106–1106, n=1) | — | $0.76 per GPU hour | $0.23 |
| **Wan 2.2 T2V A14B (720p, H100 80 GB)** (video) | A DigitalOcean GPU droplet, by the hour (through the relay) | 6 / 6 | 1111 s (1104–1249, n=6) | — | $3.99 per GPU hour | $7.54 |

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

### Wan 2.2 TI2V 5B (image to video, H100 80 GB)

A DigitalOcean GPU droplet, by the hour (through the relay) · licence Apache-2.0

- **size:** 1280×704 (16:9) and 704×1280 (9:16), the model's native sizes — the photo is cut to the frame around its subject, never letterboxed
- **frames:** 121
- **fps:** 24
- **duration:** 5.04 s (10 s = two linked runs, 238 frames)
- **steps / guidance:** 40 / 5.0
- **seed:** honoured
- **GPU:** NVIDIA H100 80 GB (RunPod), model resident, CPU offload off the 80 GB card
- **pipeline:** diffusers WanImageToVideoPipeline (the checkpoint's expand_timesteps)

### Wan 2.2 TI2V 5B (image to video, RTX 4000 Ada 20 GB)

A DigitalOcean GPU droplet, by the hour (through the relay) · licence Apache-2.0

- **size:** 1280×704 — native, it fits (19.7 GB of VRAM at the peak) with model CPU offload and VAE tiling; no size ladder step was needed
- **frames:** 121
- **fps:** 24
- **duration:** 5.04 s
- **steps / guidance:** 40 / 5.0
- **seed:** honoured
- **host RAM:** 25.5 GB resident at the peak on a 31 GB host (the image engine and Ollama were stopped)
- **GPU:** NVIDIA RTX 4000 Ada 20 GB (DigitalOcean droplet)

### Wan 2.2 T2V A14B (720p, H100 80 GB)

A DigitalOcean GPU droplet, by the hour (through the relay) · licence Apache-2.0

- **size:** 1280×720 (16:9) and 720×1280 (9:16)
- **frames:** 81
- **fps:** 16
- **duration:** 5.06 s
- **steps / guidance:** 40 / 4.0 (high-noise expert) and 3.0 (low-noise expert), boundary 0.875
- **seed:** honoured
- **GPU:** NVIDIA H100 80 GB (RunPod), two bf16 experts (57 GB) swapped by CPU offload — about 26 s per step
- **load:** 129 s from the network volume

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
| limit | DigitalOcean GPUs: the 48 GB sizes (L40S, RTX 6000 Ada) were never in stock; the 20 GB RTX 4000 Ada appeared and disappeared (3 starts, 2 refused for stock) | sold out in tor1, the only region the private broker's VPC reaches |
| infrastructure | ten clips in a row failed in 17 s (HTTP 500) after the first one succeeded | the worker's free-RAM pre-flight counted the first clip's resident pipeline (~22 GB) against the next job (fixed: no pre-flight for a resident pipeline, orazaka-worker-media#22) |
| infrastructure | three clips (up to 9 minutes of GPU each) were lost mid-render | every deploy of dev.orazaka.com restarts the relay: the worker's AMQP stream dropped and the process exited (fixed: the consumer reconnects and skips a redelivered job, orazaka-worker-media#24) |
| infrastructure | several runs failed with 404 on their starting photo | the platform keeps uploads on the core's disk, which a redeploy wipes; the batch runner uploads the photo again (media durable on Bunny is krizaka/orazaka#144) |
| infrastructure | the droplet's watchdog destroyed an idle droplet (1.2 h) while the laptop that drove the batch was asleep | 30 min without a job; the batch runner now resumes a run in flight from its ticket |
| limit | Wan 2.2 A14B at 720p cannot be resident on one 80 GB card | two bf16 experts are 57 GB; with the activations of 1280×720 the card is full, so the experts are offloaded to the host and swapped (~26 s a step, ~18 min a clip) |
| infrastructure | the RunPod pod kept billing about two hours after its last job | its in-pod watchdog destroys the pod through the RunPod API and the pod has no API key of its own; a guard loop on the maintainer's machine ended it (to fix: a restricted key for the pod, or stop from the driver as soon as the queue is empty) |
| configuration | the first 720p run failed: cached snapshot incomplete | the fetch pattern list had transformer/* but not the second expert transformer_2/* (fixed, orazaka-worker-media#27) |

## What it cost

| Provider | Output | Price | Runs | Spent |
| --- | --- | --- | --- | --- |
| DigitalOcean serverless inference | Wan 2.2 T2V A14B | $0.60 per video | 21 | $12.60 |
| DigitalOcean serverless inference | Stable Diffusion 3.5 Large | $0.08 per image | 6 | $0.48 |
| A DigitalOcean GPU droplet, by the hour (through the relay) | Wan 2.2 TI2V 5B (image to video, H100 80 GB) | $3.99 per GPU hour | 19 | $3.95 |
| A DigitalOcean GPU droplet, by the hour (through the relay) | Wan 2.2 TI2V 5B (image to video, RTX 4000 Ada 20 GB) | $0.76 per GPU hour | 1 | $0.23 |
| A DigitalOcean GPU droplet, by the hour (through the relay) | Wan 2.2 T2V A14B (720p, H100 80 GB) | $3.99 per GPU hour | 6 | $7.54 |
| **Total of the runs above** |  |  |  | **$24.80** |

### GPU droplet sessions (what was billed)

| Session | GPU | Hours | Rate | Billed |
| --- | --- | --- | --- | --- |
| DigitalOcean droplet 1 (first start: image build, aborted) | RTX 4000 Ada 20 GB | 0.10 | $0.76/h | $0.08 |
| DigitalOcean droplet 2 (first clip, 18 min; failures) | RTX 4000 Ada 20 GB | 1.91 | $0.76/h | $1.45 |
| DigitalOcean droplet 3 (dropped tunnels, watchdog) | RTX 4000 Ada 20 GB | 1.05 | $0.76/h | $0.80 |
| DigitalOcean droplet 4 (idle while the driver slept) | RTX 4000 Ada 20 GB | 1.20 | $0.76/h | $0.91 |
| RunPod pod (image-to-video pairs, 10 s chains, 720p A14B heroes; it ran ~2 h past its last job because the in-pod watchdog had no key to destroy itself — the local guard loop ended it) | H100 80 GB (CA-MTL-1) | 5.01 | $3.99/h | $19.99 |
| **Total billed** |  |  |  | **$23.23** |

A droplet is billed from its creation to its destruction: the sessions include the setup (image build, weights), the load of the model and the attempts that failed, which the runs above do not. The cost of a run is its own start-to-finish time at the hourly rate.

The local models cost nothing per output; the energy of the Mac was **not measured**, so none is claimed. Probes and refused calls (a 403, a size test) are not runs and are not in this table.

See also: [Supported models](MODELS.md) for the registry, and the comparison images on the gallery (`/gallery?kind=compare`).
