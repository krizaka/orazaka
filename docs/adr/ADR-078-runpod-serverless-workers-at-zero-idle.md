---
title: "ADR-078 — RunPod serverless workers at $0 idle (proposal), and the pod spend guard"
description: "The H100 pod bills $3.99/h whether or not it renders; serverless bills seconds. Measured cost per 5 s clip against pod-hours, the break-even, what is decided now (a guard that stops idle pods) and what needs a spike (a serverless endpoint behind a runner adapter)."
category: ADR
order: 78
---

# ADR-078 — RunPod serverless workers at $0 idle (proposal), and the pod spend guard

- **Status**: Proposed (the guard is Accepted and shipped; the serverless endpoint waits for the spike below)
- **Date**: 2026-10-16
- **Builds on**: [ADR-077](ADR-077-hourly-gpu-and-9x16-video.md) (the hourly GPU), `orazaka-worker-media#28` (core vs runtime)
- **Scope**: `scripts/gpu-dev.sh runpod`, `scripts/runpod-guard.py`, `orazaka-worker-media` (runner adapter), `infra/`

## Context

Since 2026-10-15 the GPU of dev is a **RunPod pod** (H100 80 GB, $3.99/h, a 200 GB network volume `orazaka-gpu-models`,
CA-MTL-1) instead of a DigitalOcean droplet. The pod is created by hand and nothing stops it: on 2026-10-16 it ran
5 h with the GPU at 0 % and no model resident (≈ $20, stopped by hand). DigitalOcean's watchdog (ADR-077) does not
exist on RunPod. The company cap is $100/month cloud excluding GPU; GPU is paid per use and must be 0 at rest.

## Measured (docs/measurements, batch `i2v-2026-10-15`, image-to-video, seeds fixed)

| Where | Model | Frame | Median render | GPU $/h | $ per clip, render only |
|---|---|---|---|---|---|
| RunPod H100 80 GB (pod) | Wan 2.2 TI2V 5B | 704×1280, 5.04 s, 24 fps | **175 s** (19 clips, min 168 s) | 3.99 | **$0.19** |
| DigitalOcean RTX 4000 Ada 20 GB | Wan 2.2 TI2V 5B | 704×1280 | 1106 s (1 clip) | 0.76 | $0.23 |
| RunPod H100 80 GB (pod) | Wan 2.2 T2V A14B | 1280×720, 5.06 s, 16 fps | **1111 s** (6 clips) | 3.99 | **$1.23** |
| DigitalOcean (earlier) | Wan 2.2 T2V A14B | 832×480 | 131 s | — | $0.60 |

Model load from the network volume: **129 s** for A14B (57 GB); the 5B has not been timed separately.
**Pod all-in on 2026-10-16**: 25 clips in a 5 h session = 2.8 h rendering + 2.2 h waiting → ≈ $20 / 25 = **$0.80 per clip**,
of which 45 % was idle and load. Pod-hours are the wrong unit for bursty dev use; per-clip is the right one.

## Decision

1. **Now — pods are guarded.** `scripts/gpu-dev.sh runpod status|once|loop` stops (never terminates: the volume and
   the setup survive) a pod whose GPU stayed under 5 % for `GPU_IDLE_MINUTES` (20), or that lived `GPU_MAX_HOURS` (6).
   Tested on fixtures (`scripts/test/gpu-dev.test.mjs`). Run `scripts/gpu-dev.sh runpod loop` in a terminal tab (or
   launchd) during a batch. The guard is local: it does not replace the cloud-side fix below.
2. **Next — spike a serverless endpoint**, behind the runner adapter of `orazaka-worker-media#28`: `core.py` pure,
   `runner_local.py` (RabbitMQ, the Mac and the pod) and `runner_runpod.py` (the serverless handler, same image, weights
   on the same network volume). No Redis: the queue is the existing RabbitMQ; the endpoint is triggered by a small
   poller in the job service (workers min 0, max 1, idle timeout 5 s, FlashBoot on).
3. **Adopt serverless only if the spike measures it cheaper per clip than the pod at our volume.** Break-even, with
   a serverless H100 list rate of ≈ $0.0016/s (≈ $5.7/h, to be confirmed on the endpoint's price page) and a cold start
   of ~60–130 s (volume load): a 5B clip costs (175 + cold) × $0.0016 = **$0.28–0.49 cold, $0.28 warm**, against
   $0.19 on a pod that is busy and $0.80 on a pod that is not. Serverless wins whenever the pod would be busy less
   than ~60 % of the time it is up — true of every dev day measured so far. For the A14B 720p clip (1111 s) it is
   ≈ $1.8 serverless against $1.23 busy pod: keep A14B for batches on a guarded pod, serverless for the 5B.
4. **Storage.** The network volume (200 GB × $0.07 = ≈ $14/month) stays only while the weights it holds (A14B 57 GB, 5B,
   FLUX.2) are fetched more than ~twice a month: re-downloading 120 GB on a $3.99/h pod costs ≈ $1–2 each time. It is
   kept; a stopped pod's 60 GB container disk (≈ $12/month at $0.20/GB) is not worth keeping once the endpoint exists.

## Consequences

- A forgotten pod costs at most 20 idle minutes ($1.33) while the guard runs, instead of a night.
- Serverless adds no always-on cost: the 5-dollar `gpu-relay` and the chisel tunnel become removable once the worker
  reaches the broker from RunPod directly over TLS (to decide at the spike).
- Per-clip cost belongs to `krizaka-billing#25` (quota pre-flight): the margin target uses the serverless number.

## Refused

- A cloud-side watchdog on the pod now: it needs the pod's own API key inside the image; the local guard is enough
  until the endpoint replaces the pod.
- Modal or another serverless host: a second vendor for no measured gain.
