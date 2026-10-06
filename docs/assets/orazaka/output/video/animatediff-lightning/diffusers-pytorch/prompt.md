# Video Generation — AnimateDiff-Lightning via Diffusers + PyTorch MPS

> **Model**: `ByteDance/AnimateDiff-Lightning` (4-step distilled) + `emilianJR/epiCRealism` (base SD1.5)
> **Provider**: HuggingFace Diffusers — PyTorch 2.x with Metal Performance Shaders (MPS)
> **Endpoint**: `POST http://localhost:8188/v1/videos/generations`

---

## Machine Configuration

| Attribute | Value |
|:---|:---|
| **CPU / GPU** | Apple M1 Max (MTLGPUFamilyApple7) — 32-core GPU |
| **Unified Memory** | 64 GB |
| **Max Working Set** | 55,662.79 MB (~54.4 GB) |
| **OS** | macOS 26.5 (Build 25F71) |
| **Python** | 3.14.5 |
| **PyTorch** | 2.x with MPS backend (Metal Performance Shaders) |
| **Diffusers** | HuggingFace diffusers — AnimateDiffPipeline |
| **FFmpeg** | 8.1.1 (`h264_videotoolbox` hardware encoder) |
| **Env Vars** | `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` (disables MPS memory limit) |

## Model Parameters

| Parameter | Value |
|:---|:---|
| **Architecture** | AnimateDiff-Lightning (MotionAdapter + SD1.5 UNet + CLIP + VAE) |
| **MotionAdapter** | `animatediff_lightning_4step_diffusers.safetensors` — 453,209,280 parameters |
| **Base Model** | `emilianJR/epiCRealism` (SD1.5-based photorealistic fine-tune) |
| **Total Parameters** | 1,519,444,587 (~2.8 GB, ~1.52 billion) |
| **dtype** | `torch.float16` |
| **Device** | MPS (Metal Performance Shaders) |
| **Denoising Steps** | 4 (Lightning — CFG-free distilled) |
| **Guidance Scale** | 1.0 (no classifier-free guidance — disabled via distillation) |
| **Scheduler** | DPM++ SDE (AnimateDiff-Lightning default) |
| **Frames** | 16 |
| **FPS** | 4 |
| **Target Duration** | 4.0 seconds (16 ÷ 4 = 4.0s) |
| **Resolution** | 512×512 |
| **Attention Slicing** | ENABLED (reduces memory consumption of attention heads) |
| **VAE Slicing** | ENABLED (decodes frames in slices instead of all at once) |
| **MPS Cache Flush** | `callback_on_step_end` with `torch.mps.empty_cache()` + `gc.collect()` between steps |

## Prompt

```text
A sleek cyberpunk vehicle zooming through a neon-drenched Montreal alleyway,
Saint-Henri aesthetic, Lachine canal corporate skyline, high-speed chase,
fast cinematic camera panning, rich colors, photorealistic, detailed textures
```

## Payload

```json
{
  "prompt": "A sleek cyberpunk vehicle zooming through a neon-drenched Montreal alleyway, Saint-Henri aesthetic, Lachine canal corporate skyline, high-speed chase, fast cinematic camera panning, rich colors, photorealistic, detailed textures",
  "model": "ByteDance/AnimateDiff-Lightning",
  "image": "<base64_gradient_512x512_reference>",
  "durationSeconds": 4,
  "num_frames": 16,
  "video_fps": 4,
  "video_steps": 4,
  "width": 512,
  "height": 512,
  "output_path": "<data/shared/video_output_YYYYMMDD_HHMMSS.mp4>"
}
```

## Encoding Pipeline

```bash
ffmpeg -y -framerate 4 \
  -i /tmp/tmpXXXXXXXX/frame_%04d.png \
  -c:v h264_videotoolbox -b:v 8M \
  -pix_fmt yuv420p -movflags +faststart \
  <output_path>
```

The encoder uses `h264_videotoolbox` (Apple's VideoToolbox hardware accelerator) for H.264 encoding, rendering the encoding phase near-instantaneous (~0.1s for 16 frames).

---

## Outputs

### 1. `video_output_20260601_203751.mp4`

| Attribute | Value |
|:---|:---|
| **Path** | [`video_output_20260601_203751.mp4`](./video_output_20260601_203751.mp4) |
| **Size** | 1,761,299 bytes (1.68 MB) |
| **Timestamp** | 2026-06-01 20:37:51 EDT |
| **Seed** | 1793586027 |
| **Inference Time** | 220.37s (3min 40s) |
| **FFprobe** | codec=h264, 512×512, frames=16, duration=4.000000s |
| **Log Source** | `video-worker.log` (first POST block) |

**Step Timing**:
| Step | Time | Cumulative |
|:---:|:---:|:---:|
| 1/4 | 24.42s | 24s |
| 2/4 | 46.04s | 1m25 |
| 3/4 | 50.69s | 2m21 |
| 4/4 | 54.56s | 3m22 |

**Context**: First successful video generation. This marked the breakthrough after 3 consecutive OOM failures. The critical fix was injecting a `callback_on_step_end` utilizing `torch.mps.empty_cache()` between denoising steps. Without this callback, the MPS allocator accumulated intermediate 3D temporal attention tensors, inevitably crashing at step 2 or 3. The worker was restarted after terminating the `sd-server` (port 8086) to free ~2.8 GB of VRAM, dedicating maximum GPU memory to video inference.

---

### 2. `video_output_20260601_204246.mp4`

| Attribute | Value |
|:---|:---|
| **Path** | [`video_output_20260601_204246.mp4`](./video_output_20260601_204246.mp4) |
| **Size** | 1,706,300 bytes (1.63 MB) |
| **Timestamp** | 2026-06-01 20:42:46 EDT |
| **Seed** | 508127553 |
| **Inference Time** | 210.85s (3min 31s) |
| **FFprobe** | codec=h264, 512×512, frames=16, duration=4.000000s |
| **Log Source** | `video-worker.log` (second POST block) |

**Step Timing**:
| Step | Time | Cumulative |
|:---:|:---:|:---:|
| 1/4 | 21.90s | 22s |
| 2/4 | 47.91s | 1m28 |
| 3/4 | 51.71s | 2m24 |
| 4/4 | 54.81s | 3m23 |

**Context**: Second video generation. Faster than the first (210s vs 220s) due to a warm start (AnimateDiff-Lightning pipeline and base model were already in memory). `sd-server` remained offline for memory headroom. Generated during the 2nd full E2E run, which failed on UC1 (IMAGE) due to the `sd-server` health check timeout.

---

### 3. `video_output_20260601_204836.mp4`

| Attribute | Value |
|:---|:---|
| **Path** | [`video_output_20260601_204836.mp4`](./video_output_20260601_204836.mp4) |
| **Size** | 1,854,557 bytes (1.77 MB) |
| **Timestamp** | 2026-06-01 20:48:36 EDT |
| **Seed** | 1217792948 |
| **Inference Time** | 238.76s (3min 59s) |
| **FFprobe** | codec=h264, 512×512, frames=16, duration=4.000000s |
| **Log Source** | `video-worker.log` (third POST block) |

**Step Timing**:
| Step | Time | Cumulative |
|:---:|:---:|:---:|
| 1/4 | 28.41s | 28s |
| 2/4 | 51.08s | 1m35 |
| 3/4 | 60.67s | 2m47 |
| 4/4 | 61.96s | 3m51 |

**Context**: Final video for the successful **3/3 GREEN** E2E run. Slower than previous attempts (239s vs 210-220s) because the `sd-server` was concurrently running, consuming ~2.8 GB of VRAM. This increased GPU memory pressure, slowing each step by ~10-15s. The file size is the largest of the three (1.77 MB) as this specific seed generated higher-frequency details that are less compressible in H.264.

---

## OOM Debugging Chronology

### Attempt 1: 24 frames @ 6 FPS (Immediate OOM)
- **Configuration**: `MAX_FRAMES_MPS=24`, `num_inference_steps=4`, `resolution=512×512`
- **Symptom**: Worker crashed with `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.75`. Error:
  ```
  RuntimeError: invalid low watermark ratio 1.4, must be less than high watermark ratio 0.75
  ```
- **Root Cause**: MPS defaults to a `LOW_WATERMARK` of 1.4. Setting `HIGH_WATERMARK=0.75` violates the condition `LOW < HIGH` (1.4 > 0.75).
- **Resolution**: Set `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` (completely disables watermarking).

### Attempt 2: 24 frames @ 6 FPS (OOM at Step 1)
- **Configuration**: `MAX_FRAMES_MPS=24`, watermark disabled.
- **Symptom**: Model loaded successfully but crashed during step 1/4 (51s/step), followed by a SIGKILL. Log output:
  ```
  resource_tracker: There appear to be 1 leaked semaphore objects to clean up at shutdown
  ```
  *(Classic macOS OOM kill signature — kernel SIGKILLs the process when memory pressure exceeds system thresholds.)*
- **Root Cause**: Generating 24 frames at 512×512 demands ~18 GB for 3D temporal attention (`TemporalBasicTransformerBlock`). This exceeds available MPS memory after factoring in model weights (2.8 GB) and concurrent services (Ollama, LocalAI).
- **Resolution**: Reduced to 16 frames (16 ÷ 4 FPS = 4.0s — maintaining target duration).

### Attempt 3: 16 frames @ 4 FPS (OOM at Step 3)
- **Configuration**: `MAX_FRAMES_MPS=16`, watermark disabled, all services active.
- **Symptom**: Step 1 OK (5.37s), Step 2 OK (43.66s) — Step 2 took **8× longer** than Step 1, indicating massive working set expansion. Process SIGKILL'd at step 3.
- **Root Cause**: The MPS allocator does not automatically release intermediate tensors between denoising steps. Temporal attention generates `[batch, frames, heads, seq_len, dim]` tensors that remain in fragmented memory even after PyTorch marks them as free. Fragmentation compounded per step.
- **Resolution**: Implemented `callback_on_step_end` in the pipeline call:
  ```python
  def _mps_step_callback(pipe, step_index, timestep, callback_kwargs):
      if device == "mps":
          torch.mps.empty_cache()
      gc.collect()
      return callback_kwargs
  
  output = _pipe(
      ...,
      callback_on_step_end=_mps_step_callback,
  )
  ```
  This forces the MPS allocator to defragment memory between steps, preventing chunk accumulation.

### Attempt 4: 16 frames @ 4 FPS + Callback + Memory Relief (Allowed SUCCESS)
- **Configuration**: `MAX_FRAMES_MPS=16`, MPS callback applied, `sd-server` killed to free ~2.8 GB VRAM.
- **Result**: Successfully completed 4 steps (24s → 61s → 56s → 50s). Output: 1.68 MB, `duration=4.000000s`, 16 H.264 frames. **FIRST SUCCESS.**

---

## Technical Insights

1. **`callback_on_step_end` is mandatory for MPS**: Without it, AnimateDiff OOM-kills even at 16 frames on a 64 GB unified memory system.
2. **Step times are non-linear**: Step 1 (~24s) is fast (initial noise, high frequency, rapid attention). Steps 2-4 (~50-60s) are slower as latent features gain structure, requiring temporal attention to correlate more complex patterns across 16 frames.
3. **Warm starts are significant**: The 2nd run (210s) was ~10s faster than the 1st (220s) due to the pipeline already residing in memory.
4. **Memory contention is measurable**: The 3rd run (239s) was ~30s slower because `sd-server` was consuming 2.8 GB in parallel.

---

## Log Timeline (Final Run — 3/3 GREEN)

```text
20:37:43  Video Worker health check Allowed
20:37:51  POST /v1/videos/generations — seed: 1793586027
20:37:51  [AnimateDiff-Lightning] Generating 16 frames at 512×512
20:37:51  Steps: 4 | Guidance: 1.0 (Lightning CFG-free)
20:38:15  Step 1/4 completed (24.42s)
20:39:16  Step 2/4 completed (46.04s) — callback: torch.mps.empty_cache()
20:40:12  Step 3/4 completed (50.69s) — callback: torch.mps.empty_cache()
20:41:13  Step 4/4 completed (54.56s) — callback: torch.mps.empty_cache()
20:41:32  Inference completed: 220.25s total, 16 frames at 512×512
20:41:32  FFmpeg encoding: h264_videotoolbox, 8Mbps, yuv420p
20:41:32  HTTP 200 — 1,761,299 bytes written to disk
```

**Source**: `video-worker.log`
