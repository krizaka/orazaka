---
title: AI Model Catalog
description: Models seeded in infra/initdb.
category: Models
order: 8
generated: true
---

# AI Model Catalog

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.

## Unfiltered models, your rules

The catalogue carries open-weight chat models without a vendor's refusal layer — fine-tuned without refusals or
abliterated (the refusal direction removed from the weights). They answer legitimate professional work plainly: a
security team reading a malicious command, a nurse asking for a dose limit, a reporter on a fraud scheme, a novelist
writing a dark scene. None of them is a default; the operator chooses to serve one.

They are not the policy. The policy is the operator's: a pack declares the domain it refuses (`scopeGuard`) and the
crisis text it answers (`safety`); the engine enforces both first in the pipeline, before any model runs and even when
the AI kill-switch is pulled, and every turn is accounted for. "Uncensored" means not over-refusing legitimate work —
it never covers content sexualising minors, explicit sexual content, real persons, weapons or bio-chemical procedures,
working malware, or anything that enables serious harm. Unfiltered is not infallible either: serve the largest model
the machine holds for clinical, legal or security work, and keep a professional in the loop.

## Catalogue

| Model | Label | Category | Description |
|:---|:---|:---|:---|
| `whisper-base` | Whisper Base | audio | Whisper Base speech-to-text. Balanced accuracy and speed for transcription. Local audio default. |
| `whisper-tiny-en` | Whisper Tiny (en) | audio | Whisper Tiny (English) STT. Fastest, smallest footprint — quick English transcriptions. |
| `dolphin-llama3:8b` | Dolphin Llama 3 8B — unfiltered | chat | Dolphin 2.9 on Llama 3 8B (Meta Llama 3 Community Licence) — fine-tuned without a refusal layer. Frank, compliant answers; the operator's packs set the rules. |
| `huihui_ai/qwen2.5-abliterate:7b` | Qwen 2.5 7B — unfiltered | chat | Qwen 2.5 7B Instruct with the refusal direction removed (abliterated), Apache-2.0. Answers legitimate professional questions — security, medicine, law, fiction — without a vendor's refusals; your packs set the rules. French and English. |
| `mdq100/Gemma3-Instruct-Abliterated:27b` | Gemma 3 27B — unfiltered | chat | Gemma 3 27B Instruct with the refusal direction removed (abliterated), Gemma Terms of Use. The most accurate unfiltered model of the catalogue — the one behind the krizaka.com demos. ~17 GB: a 32 GB+ machine. |
| `tinyllama:latest` | TinyLlama (latest) | chat | TinyLlama — tiny, fast chat model for local testing. Limited reasoning. |
| `codellama:7b` | CodeLlama 7B | code | Code Llama 7B — code generation and explanation (q4_K_M). |
| `qwen2.5-coder:7b` | Qwen 2.5 Coder 7B | code | Qwen 2.5 Coder 7B — code generation and completion (q4_K_M). Local code default. |
| `argmaxinc/mlx-FLUX.1-schnell-4bit-quantized` | FLUX.1 Schnell 4-bit (MLX) | image | FLUX.1 Schnell, 4-bit quantized for Apple MLX. Fast, high-quality images natively on Apple Silicon. |
| `flux-2-klein-4b` | FLUX.2 [klein] 4B | image | FLUX.2 [klein] 4B (Apache-2.0) — editorial photographs, illustrations and miniatures in 4 steps, 1024 px in about 80 s on an M1 Max. Local image default. |
| `v1-5-pruned-emaonly` | Stable Diffusion 1.5 | image | Stable Diffusion 1.5 (CreativeML OpenRAIL-M) — the former default: 512 px, short prompts. For small machines. |
| `z-image-turbo` | Z-Image Turbo | image | Z-Image Turbo (Apache-2.0) — the most detailed photographs, about three times slower than FLUX.2 [klein]. Renders lettering readily: keep words out of the prompt. |
| `piper-en-low` | Piper Low (en) | speech | Fast, lightweight English neural TTS (Piper). Low fidelity, minimal memory — quick local voice checks. |
| `piper-en-medium-ryan` | Piper Ryan (en) | speech | Balanced English neural TTS (Piper, Ryan voice). Natural prosody at modest CPU cost. Local speech default. |
| `piper-fr-medium` | Piper Medium (fr) | speech | French neural TTS (Piper). Natural French speech, medium quality, CPU-friendly. |
| `tts-1` | OpenAI TTS-1 | speech | OpenAI-compatible TTS with six selectable voices (Alloy, Echo, Fable, Onyx, Nova, Shimmer), served locally via LocalAI. |
| `amber` | Amber Accent | theme |  |
| `emerald` | Emerald Accent | theme |  |
| `rose` | Rose Accent | theme |  |
| `zinc` | Zinc Accent | theme |  |
| `animatediff-lightning-mps` | AnimateDiff Lightning (MPS) | video | AnimateDiff Lightning on Apple Metal (MPS). Fast 8-step text-to-video that fits a 64GB Mac. Local video default. |
| `apple-coreml-video-pipeline` | Apple CoreML Video Pipeline | video | Apple CoreML video pipeline. Native Apple Silicon acceleration for short clips. |
| `ByteDance/AnimateDiff-Lightning` | AnimateDiff Lightning | video | ByteDance AnimateDiff Lightning weights (MLX). Fast 8-step text-to-video at ~12fps. |
| `mlx-animatediff-lightning` | MLX Native AnimateDiff | video | AnimateDiff Lightning on Apple MLX. Native Apple-Silicon 8-step video at ~12fps. |
| `mlx-stable-diffusion-video` | MLX Native Video | video | Stable Diffusion video on Apple MLX. Higher quality (25 steps, ~14fps); heavier than AnimateDiff. |
| `stable-video-diffusion-img2vid-xt` | Stable Video Diffusion XT (heavy, >64GB) | video | Stable Video Diffusion XT — highest-quality image-to-video. Heavy: needs >64GB unified memory or CUDA. Not recommended on a 64GB Mac. |
| `stable-video-diffusion-img2vid-xt-mps-fp32` | SVD XT (PyTorch MPS Float32) | video | SVD XT in PyTorch MPS float32. Highest fidelity but ~96GB memory — will fail on a 64GB Mac. |
| `bakllava:latest` | BakLLaVA (latest) | vision | BakLLaVA (Mistral-based) vision model. Compact image understanding. |
| `llama3.2-vision:latest` | Llama 3.2 Vision (latest) | vision | Llama 3.2 Vision — strong general image understanding. Local vision default. |
| `llava:latest` | LLaVA (latest) | vision | LLaVA multimodal model — describe and answer questions about images. |
| `llava:v1.6` | LLaVA (v1.6) | vision | LLaVA v1.6 — improved image understanding and OCR over base LLaVA. |
