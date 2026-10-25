---
title: "#63 — Cold start and diffusion speed, measured on one H100"
description: "Wan 2.2 TI2V 5B on a RunPod H100 80GB: load from the network volume, from NVMe, prefetched; render with FP8 layerwise casting and FirstBlockCache. What was measured, what was not, and the decision for worker-media#63."
category: Measurement
order: 2
---

# #63 — Cold start and diffusion speed

> **DECISION.** Wan stays on **diffusers**, with **FP8 storage on Hopper/Ada only** (BF16 elsewhere);
> the step cache is diffusers' in-tree **FirstBlockCache first** (MagCache only if it fails the quality gate, TeaCache is not
> ported); **FLUX.2 stays on GGUF / sd-server**. The cold-start target (**under 12 s**) and the 2 to 2.5x target are **missed**
> by what exists today: measured **32 s** staged and **1.5x** with the cache. The cause and the way to the targets are below.

One pod, one measurement session, 2026-10-22, **USD 2.10** of the USD 15 cap (pod about 45 min at USD 3.99/h plus a
100 GB network volume that was deleted afterwards). Hardware: NVIDIA H100 80GB HBM3 (driver 595.91), Intel Xeon Platinum 8570,
torch 2.11.0+cu128, diffusers 0.41.0, transformers 5.19.0, the worker at `orazaka-worker-media` main plus `app.measure`.
Model: `wan2.2-ti2v-5b` (34.2 GB BF16 on disk), 9:16, 121 frames, 20 steps, seed 7, the fixed prompt of `app.measure`.
**One run per cell** (no repeat): differences under about 10 % are within the noise seen between two runs of the same cell.

## 1. Load (34.2 GB)

Each load drops the model's files from the page cache first (`posix_fadvise DONTNEED`), then times
`wan_generator._load` with the heavy imports already done.

| Mode | What it is | Seconds | GB/s |
|:---|:---|---:|---:|
| `volume` | `from_pretrained` straight from the RunPod network volume | **87.8** (154.4 on the first run, which also paid ~30 s of cold imports) | 0.39 (0.22) |
| `stage` | parallel copy volume to the pod's disk, then load (a fresh pod) | **32.1** (62.8 on the first run) | 1.06 (0.54) |
| `warm-stage` | the copy is already on the pod's disk, page cache dropped | **36.1** | 0.95 |
| `prefetch` | parallel readers warm the page cache, then load | **32.8** (57.5 on the first run) | 1.04 (0.59) |

Reading it:

- Staging or prefetching is **about 2.7x faster than the plain volume load** (88 s to 32 s). That is the lever that exists and works.
- **Under 12 s is not reached.** The pod's own disk reads at about **1 GB/s** with a cold page cache, so 34 GB costs ~35 s even
  when the copy is local. 12 s needs ~3 GB/s, or half the bytes (FP8 on disk, 17 GB, ~17 s at 1 GB/s) **and** a faster disk or
  a hot page cache. That is the next measurement, once an FP8 checkpoint exists (§3).
- The network volume reads at 0.2 to 0.4 GB/s with one stream and about 0.6 to 1 GB/s with parallel readers: parallelism
  is the whole win, not the NVMe.
- The first run of each mode was slower than the second (the volume's own server-side cache is not evictable from the pod):
  the second column is the comparable one, the first is what a truly cold pod pays.

## 2. Render (20 steps, 121 frames, 704x1280)

| Variant | Seconds | vs BF16 | Peak VRAM | PSNR | SSIM |
|:---|---:|---:|---:|---:|---:|
| BF16 (baseline) | **77.7** | 1.00x | 30.5 GB | reference | reference |
| FP8 layerwise casting | **72.1** | 1.08x | 25.6 GB | 28.6 dB | 0.946 |
| FirstBlockCache (threshold 0.2) | **51.9** | **1.50x** | 31.5 GB | 26.7 dB | 0.924 |
| FP8 + FirstBlockCache | **50.2** | **1.55x** | 26.6 GB | 25.3 dB | 0.918 |

PSNR and SSIM are the mean of frames 0, 60 and 120 against the BF16 render of the same seed. The twelve frames are on Bunny:
`https://krizaka-assets.b-cdn.net/pr-assets/orazaka/worker-media-63/` (`wan2.2-ti2v-5b-s7-<variant>-f<frame>.png`).

Reading it:

- **FP8 layerwise casting** saves **16 % of VRAM** and a little time (8 %); it does not speed diffusion and **does not shorten the
  load**, because the checkpoint on disk is still BF16 (it is cast after loading). The load win needs a pre-quantised FP8
  `safetensors`, which the Wan-AI repositories do not publish and which we must produce.
- **FirstBlockCache** is the speed lever: **1.5x** at threshold 0.2, no calibration, in diffusers 0.41. The 2 to 2.5x target is
  **not reached** with it alone.
- The quality cost is visible in the numbers (SSIM 0.92 to 0.95). **The gate of #63 (LPIPS <= 0.10 / 0.15, the cinema vision-gate
  pass rate, CLIP, calibrated on the BF16 re-seed noise floor) was not run**: only PSNR and SSIM were computed, so no variant is
  declared to pass or fail it. It must run before a variant is enabled in production.

## 3. What was found on the way (fixed)

- `snapshot_download(local_files_only=True)` calls a model's fetched files **incomplete** (the worker fetches only what the
  model needs), so **NVMe staging was silently off** in the worker (`[wan] staging unavailable …`), `fetch_models --verify` and
  `app.measure` raised. The snapshot is now found by its layout (`model_cache.local_snapshot`, worker-media#72).
- A first-run import of torch, diffusers and transformers from the network-volume venv cost ~30 s inside the timed load
  (worker-media#73 imports first).
- `gpu-dev.sh runpod measure` was refused by a stopped (`EXITED`) pod, and `runpod stop` destroys **every** `orazaka-gpu-*`
  pod, stopped ones included (orazaka#361). The stopped cinema pod `pgy18c7ufqpi04` was destroyed by that `stop` on 2026-10-22:
  its `/workspace` disk (the cinema weights, re-downloadable from the Hub) is gone.

## 4. Decision for worker-media#63

| Question | Decision | Why |
|:---|:---|:---|
| Wan runtime | **diffusers**, FP8 storage on sm89/sm90 only, BF16 on Ampere and the Mac | the worker already runs Wan in diffusers; FP8 gives 16 % VRAM now and halves the read once an FP8 checkpoint is produced |
| FP8 checkpoint | **produce and digest-pin our own** (`transformer` in E4M3, per-tensor scales), publish in the model store; a model with no FP8 file runs BF16 as `models.yaml` declares | the Hub has none; without it FP8 gives no load gain |
| Step cache | **FirstBlockCache first** (in-tree, no calibration, 1.5x measured); **MagCache second**, only if FirstBlockCache loses the quality gate or a calibrated MagCache beats 1.5x; **TeaCache is not ported** | diffusers 0.41 has no TeaCache; its Wan 2.2 proof would be new work for a result FirstBlockCache already gives |
| Attention | SageAttention through diffusers' attention backend: **not measured here**, next | out of the cap's reach in one session |
| FLUX.2 [klein] | **stays GGUF Q8_0 through sd-server** | nothing measured argues for a change; its FP8/streaming path is checked, not assumed |
| Load | **stage or prefetch always** (2.7x), parallel readers; the network volume stays the source of truth | measured |
| Targets | cold start under 12 s and 2 to 2.5x: **not met** (32 s, 1.5x). Next: FP8 `safetensors` on disk (17 GB), a hot page cache or a faster disk, the quality gate, then SageAttention | the numbers above are what exists |

## 5. Reproduce

```bash
export GPU_WORKER_REF=<worker commit> GPU_RUNPOD_VOLUME_GB=100 GPU_RUNPOD_PROFILE=big GPU_MAX_HOURS=2
MEASURE_ARGS="load wan2.2-ti2v-5b --mode volume;load wan2.2-ti2v-5b --mode stage;load wan2.2-ti2v-5b --mode warm-stage;load wan2.2-ti2v-5b --mode prefetch;render wan2.2-ti2v-5b --steps 20 --accel none --out /models/measure/frames;render wan2.2-ti2v-5b --steps 20 --accel fp8 --out /models/measure/frames;render wan2.2-ti2v-5b --steps 20 --accel firstblock --threshold 0.2 --out /models/measure/frames;render wan2.2-ti2v-5b --steps 20 --accel fp8+firstblock --out /models/measure/frames" \
  scripts/gpu-dev.sh runpod measure
```
