---
title: "ADR-077 — The hourly GPU: 9:16 video with Wan, images with FLUX.2 [klein], reached through a relay"
description: "Orazaka generates for real in dev on a GPU droplet that exists only while it works. The media worker gets a CUDA image (sd-server + Wan 2.x), a `big` size (L40S 48 GB, $1.57/h, Wan 2.2 TI2V 5B, 704x1280) and a `small` one (RTX 4000 Ada 20 GB, $0.76/h, Wan 2.1 1.3B, 480x832). The droplet dials out to a relay in the app; RabbitMQ is never exposed; outputs are handed to the job service; a watchdog destroys it after 30 idle minutes."
category: ADR
order: 77
---

# ADR-077 — The hourly GPU: 9:16 video with Wan, images with FLUX.2 [klein], reached through a relay

- **Status**: Accepted
- **Date**: 2026-10-14
- **Builds on**: [ADR-075](ADR-075-local-image-engine.md) (image engine), ADR-038 (worker protocol), ADR-054 (sealed assets)
- **Scope**: `orazaka-worker-media`, `orazaka-job-service`, `orazaka-packs`, this workspace (`scripts/gpu-dev.sh`, `infra/gpu`, `infra/deploy`)

## Context

Dev runs on App Platform without a GPU (decision 2026-10-14). The products must really generate — every Studio proved
by a real run, a vertical short made by Orazaka — and as cheaply as possible: a big GPU for demo batches, a small one
for development, never one left on. The media worker was Metal-first, wrote its output on its own disk (which the
platform could not serve: worker-media#3), logged into the broker as `guest`, and blocked its connection for the whole
render.

## Decision

1. **Models.** Video: **Wan 2.2 TI2V 5B** (Apache-2.0) for `big` — 704×1280 vertical natively, 5 s at 24 fps, fits one
   48 GB GPU without sharding; **Wan 2.1 T2V 1.3B** (Apache-2.0) for `small` — 480×832, ~10 GB of VRAM. Refused:
   LTX-Video (revenue-capped licence), HunyuanVideo (territorial exclusions), CogVideoX-5B (registration licence), any
   model needing more than one GPU. Images: **FLUX.2 [klein] 4B** through stable-diffusion.cpp's sd-server built for
   CUDA — the Mac's backend and recipe (ADR-075), not a second engine.
2. **Sizes.** `big` = `gpu-l40sx1-48gb` (else `gpu-6000adax1-48gb`), $1.57/h — the smallest GPU that runs the 5B with
   only the text encoder offloaded. `small` = `gpu-4000adax1-20gb`, $0.76/h. H100 ($4.41/h) would render ~2-3x faster
   for ~the same cost per clip but bills 2.8x per idle minute.
3. **Model choice stays data.** `orazaka_models` lists the two Wan rows (provider `localai-video`); a Studio offers them
   and `aspect` (`9:16` default, `16:9`, `1:1`); the worker's `models.yaml` only says how each is fetched (pinned) and
   shaped, and refuses by name a model it does not describe. The host default is the deployment's (`MEDIA_GPU_PROFILE`).
4. **Network: the GPU dials out.** A chisel server (`gpu-relay`, $5/month) behind App Platform's TLS, one 256-bit
   credential, an allow-list of five remotes: `broker-dev.orazaka.com:5671` (the TLS broker, krizaka/orazaka#70 — TLS end to end, user
   `gpu-worker`), `core:8090` forward; `:8086` (sd-server), `:8188` (video) and
   `:11434` (Ollama — the Studios' chat and vision steps while the GPU runs) reverse, so the core reaches the GPU at
   `gpu-relay:8086`. Refused: exposing the broker (it stays a VPC-only Droplet; a public AMQP port with TLS + credentials + IP
   restriction is more surface than a tunnel), a managed broker, a VPN; putting the GPU in the VPC only works in tor1
   and cannot let it reach the job service (App Platform takes no inbound from the VPC).
   An IP allow-list was dropped on purpose: the Mac worker uses the same relay.
5. **Outputs are handed over**, not kept: `PUT /internal/v1/jobs/{id}/output/{file}` (SERVICE), sealed by the job
   service with the platform's key, the job's row adopted when a Studio step left none — the fix of worker-media#3.
   The droplet never holds the master key or the identity secret (its SERVICE token is minted locally, short-lived).
6. **Never left on.** `stop` destroys; a watchdog on the droplet destroys it after 30 min without a job, after 8 h, or
   when setup hangs. Weights on a Volume (80 GB, $8/month) so a start does not re-download 49 GB.

## Consequences

- Dev costs $13/month more (relay + Volume) and the GPU by the hour; the ledger (`gpu-dev.sh cost`) is the record.
- `infra/migrations/2026-10-14-wan-9x16.sql` for existing databases.
- The design is product-agnostic: Orochia and Yasakia reach these models through Orazaka's API and Studios (dogfooding,
  2026-10-14) — the worker sees routing keys, never a product.
