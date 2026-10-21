---
title: "Infrastructure portability and cost — local first, cheap and fast in the cloud"
description: "How Orazaka runs today on a Mac, on RunPod and on DigitalOcean; where latency and money actually go; an options matrix (serverless GPU, model loading on the fly, serving engines, routing, portability, UX) scored on cost, latency and on-prem fit; and a recommended path in phases, with the issues that carry it."
category: Guidelines
order: 22
---

# Infrastructure portability and cost

> Study ORAZAKA-INFRA-STUDY, 2026-10-21. Documentation only: no code, no paid resource. Two watchwords from the
> founder: (1) **portability, optimised for on-premises (local)**; (2) **cost in the cloud, with minimal latency and the
> smoothest experience**. Every number marked *(est.)* is an estimate to be replaced by a measurement; the others come
> from [ADR-078](adr/ADR-078-runpod-serverless-workers-at-zero-idle.md) and `docs/measurements/`.

## 1. How Orazaka runs today (read from the code)

| Layer | Local (Mac / on-prem) | Cloud (dev) | Source |
|:---|:---|:---|:---|
| Stateful infra | `infra/docker-compose.yml`: pgvector, RabbitMQ, Redis, Jaeger, Mailpit, Lago | App Platform + managed PG + a small broker Droplet | `infra/docker-compose.yml`, `infra/deploy/*.app.yaml` |
| Chat / vision LLM | Ollama (`:11434`), native | **Provider-served, per token** (`do-inference`, Mistral 3 14B, Nemotron VL) | `infra/deploy/dev-data.sql` |
| Speech | LocalAI (`:8085`, Metal) | not deployed | `infra/localai/README.md` |
| Image | sd-server (stable-diffusion.cpp, `:8086`, Metal) | same binary built for CUDA on the pod | ADR-075, `Dockerfile.cuda` |
| Video | worker `:8188`, MLX / AnimateDiff (`mps`) | Wan 2.x, LTX on a RunPod H100 pod | `orazaka-worker-media/models.yaml` |
| Model routing | `DynamicModelRouter` over `ai_providers` + `orazaka_models` (DB), client cached per (base-url, model) | same DB | ADR-030, `DynamicModelRouter.java` |
| Worker contract | AMQP `job.video.*` / `job.compose.*` / `job.sound.*`, declared in `worker.yaml` | same, through the chisel relay (`gpu-relay`) | ADR-038, ADR-077 |
| GPU lifecycle | n/a | `scripts/gpu-dev.sh runpod`, boot `infra/gpu/runpod-bootstrap.sh`, pod watchdog, launchd spend guard (idle 20 min, max 6 h) | ADR-078 |

What is already portable, and should be protected: the **queue contract** (the worker sees routing keys, never a
product), the **catalogue as data** (`orazaka_models` names the model, `models.yaml` says how a worker runs it, and
refuses by name what it does not describe), the `hardware: [cuda | mps | remote]` tag per model, pinned revisions, and
weights kept off the image (`/models`).

## 2. Where the latency and the money go

1. **Idle GPU.** The H100 pod bills $3.99/h whether or not it renders. Measured 2026-10-16: 25 clips in 5 h, 2.8 h
   rendering, 2.2 h waiting, so $0.80 per clip against $0.19 for a busy pod (ADR-078). Idle is the largest single line.
2. **Cold start.** Pod boot builds the venv in place (about 15 min of billed GPU when the volume has none, see
   `runpod-bootstrap.sh`), then loads weights: 129 s for the 57 GB A14B from the network volume. `apt-get` and
   `pip install` run at boot.
3. **Weight I/O.** A 200 GB network volume ($14/month) holds 120 GB of weights; network-volume reads are the load time.
   Re-downloading from Hugging Face costs $1-2 of pod time each time (ADR-078).
4. **Relay hop.** Every pod job crosses chisel (core to `gpu-relay` to pod), plus a sealed hand-over of outputs. It adds
   little latency per job but one more moving part and a fixed-port limit (orazaka#205: a second pod cannot join).
5. **Generation itself** is not the lever: 175 s per 5 s clip on the 5B. It is paid once; idle and load are paid again.
6. **LLM path.** In dev, chat is per token with no GPU to hold: cheap and fast to start. Cost appears only if Orazaka
   self-serves LLMs (on-prem clients, high volume), where the Ollama default (one model, little concurrency, no shared
   prefix cache) is the ceiling.

Conclusion: the order of attack is **idle, then load, then batching, then engine**. An engine swap (vLLM) saves nothing
while the GPU waits for work.

## 3. Options matrix

Scores: cost and latency for the cloud watchword, **on-prem fit** for the first watchword (high = runs unchanged on a
client's Mac or Linux/NVIDIA box). Numbers *(est.)* unless cited.

### 3.1 Serverless GPU, scale to zero

| Option | Cost | Latency (cold / warm) | On-prem fit | Verdict |
|:---|:---|:---|:---|:---|
| RunPod Serverless, flex + FlashBoot | per second, $0 idle; H100 about $0.0016/s (ADR-078, to confirm); active workers cheaper | RunPod claims sub-200 ms container start with FlashBoot; model load is ours (60-130 s from volume) | Medium: same image, handler adapter only | **Spike first** (ADR-078 item 2): our vendor, volume and region already in place |
| Modal | per second, $0 idle | GPU memory snapshots reported 118 s to 12 s cold start for a 3B LLM (alpha, Modal's own figure) | Low: proprietary SDK | Comparator only (orazaka#324), not adopted |
| Replicate-style (per prediction) | per second plus margin | minutes on custom models *(est.)* | Low | Refused: loses control of weights and licences |
| Provider-served inference (DO) | per token / per clip ($0.60 A14B 832x480) | no cold start | None | Keep as a **route** in the DB, not as the platform |
| Spot / community pods + checkpointed jobs | 50-70 % under on-demand *(est.)* | interruptions | High | Batch only (cinema), after a checkpoint contract |

### 3.2 Loading models on the fly

| Technique | Effect | On-prem fit | Verdict |
|:---|:---|:---|:---|
| Stage weights from the network volume to local NVMe at boot, memory-map safetensors | the 129 s load may drop 2-4x *(est.)*; measure first | High | **Do now** (cheap) |
| Image holds the runtime only, weights on the volume (already true) + slim image (orazaka#316) | pull time and disk fee | High | Continue |
| Cached-model features of the platform | skips download | Low | Check at the spike; never a dependency |
| Lazy / streamed loading (safetensors streaming, Run:ai Model Streamer) | first layers before the file ends | High | Evaluate for LLMs only (Wan loads whole pipelines) |
| Warm-container snapshot (CRIU, CUDA checkpoint, GPU memory snapshot) | 5-10x on cold start for vLLM-class servers (Modal reports ~10x) | Low today (root, driver-bound, young) | Watch |
| Keep hot by traffic (LRU per VRAM budget, pre-load on queue depth) | hides load for repeat models | High | **Do** in the worker |

### 3.3 Serving engines

| Option | Gain | On-prem fit | Verdict |
|:---|:---|:---|:---|
| vLLM or SGLang (continuous batching, prefix and KV cache, multi-LoRA on one base) | several times Ollama throughput under concurrency *(est.)* | Linux/NVIDIA only | Provider row type `openai-compatible`; adopt when self-served LLM volume exists |
| Quantisation AWQ / GPTQ / FP8 | about 2x memory and speed *(est.)*; FP8 needs Ada/Hopper (sm_89+, our target) | High on NVIDIA | With vLLM, a flag per model |
| llama.cpp / MLX on Macs | already the local path (Ollama, MLX, sd.cpp) | **Highest** | Keep as the reference local engine |
| Video: distilled few-step models (LTX distilled, Wan 4-step I2V already in `cinema`) | fewer steps per clip | High | Continue, measure per clip |

### 3.4 Routing (`DynamicModelRouter`, DB)

Today the router resolves **one** endpoint per model name and caches the client. No fallback, no health, no cost or
latency awareness, no response cache. The DB already carries what is needed to go further (`supported_hardware`,
`is_default`, `category`, provider rows).

| Option | Effect | Verdict |
|:---|:---|:---|
| Ordered fallback chain + circuit breaker per provider | availability; local answers when the cloud is down and the reverse | **Do (P1)** |
| Capability-based selection (modality, hardware, context, cost, p95) | one API whatever the backend | After the chain |
| Cascade: small model first, escalate on a declared signal | 30-70 % of chat token cost *(est.)* | Opt-in per Studio step |
| Exact then semantic response cache (pgvector is there) | no cost and tens of ms on a hit | Exact match first (a seed makes a run repeatable) |
| Batching media jobs into windows | amortises one load over N clips | Use the existing queue (RabbitMQ), not Redis |

### 3.5 Portability

| Option | Verdict |
|:---|:---|
| One runtime contract: queue bindings (`worker.yaml`), model description (`models.yaml`), `/models` layout, health and registration | Exists; write it as the contract and test it per target |
| One image, three targets: Docker (Linux/NVIDIA), k3s, RunPod (pod and serverless handler) | **Do**: the pod stops rebuilding the runtime in place |
| OCI model store: weights as digest-pinned OCI artifacts, `orazaka models pull` from a registry or an offline bundle | Do; serves air-gapped clients and reproducibility |
| Same API whatever the backend | Already the rule (ADR-030); add a contract test per provider row type |

### 3.6 User experience

| Option | Verdict |
|:---|:---|
| Stage events in the run stream (`queued`, `loading_model`, `rendering`, `uploading`) with an ETA from past durations: a cold start becomes an honest progress step | **Do (P1)**: numbered run events and `Last-Event-ID` exist (ADR-083, #189) |
| First-token streaming for chat steps (SSE) | Verify end to end; no new work if so |
| Optimistic UI (a Studio run appears at submit) | Client side, already the pattern |

## 4. Recommended path, in phases

**Phase 0 - see (now).** Per-run timing fields (queue wait, cold start, model load, render, upload) in the
measurements (orazaka#315). Nothing below is sized without them.

**Phase 1 - stop paying for idle and for loading (before 2026-11-15).**
1. Serverless spike with a decision gate (RunPod flex, FlashBoot, 5B and FLUX, same image, weights on the volume).
2. Model-cache contract: one `/models` layout, stage to local NVMe, verify by digest, same on Mac, pod and k3s.
3. Stage events in the run stream: a 60-130 s cold start is a progress step, not a freeze.
4. Router fallback chain with a circuit breaker.
5. On-prem packaging: a GPU compose profile and a k3s manifest of the **same** worker image, no RunPod needed.

**Phase 2 - cost per unit (November-December).** Keep-hot LRU in the worker, cascade and exact-match cache in the
router, offline model bundle (OCI) with `orazaka models pack/import`.

**Phase 3 - volume (when measured traffic asks).** vLLM provider type with FP8/AWQ for self-served LLMs, spot pods for
checkpointed batches, multi-LoRA. **Phase 4 - watch**: GPU snapshot/restore, lazy weight streaming.

Expected effect if the spike confirms ADR-078's arithmetic *(est.)*: cost per clip from about $0.80 (guarded pod, mixed
use) to $0.28-0.49, GPU at $0 at rest without a local guard; cold start visible instead of silent; an on-prem client
runs the same image with no cloud account.

## 5. Issues

The existing GPU backlog (orazaka#157, #205, #206, #315, #316, #320-#324, worker-media#28) is not duplicated. This
study adds the router, the cache contract, the on-prem packaging, the UX events and the spike gate. The issues are
listed in the pull request and in milestone « Infra portability — 2026-11-15 ».

## 6. Refused for now

Modal or Replicate as the platform (lock-in); GPU snapshot/restore (immature on our drivers); a second queue technology
(Redis) for batching; vLLM before there is LLM volume to batch; any change of the product API for portability reasons.
