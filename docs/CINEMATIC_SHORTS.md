# Cinematic shorts

A 30 to 60-second film, vertical (9:16: Reels, TikTok, Shorts) or wide (16:9), from a brief: **script → character
references → keyframes → shots → cut → voice-over → sound**. Every step is an ordinary Studio run — metered, checked by
the content policy, listed in your run history — and the estimate is shown before anything runs
([ADR-080](adr/ADR-080-cinematic-shorts.md)).

## Make one

```bash
orazaka login
orazaka cinema new my-film --brief "…" --format superhero-vfx --aspect 9:16 --duration 45 --shots 10
orazaka cinema estimate my-film          # credits, time and GPU cost, before anything runs
orazaka cinema run my-film --max-runs 1  # the script only: read production.json, adjust a shot if you want
orazaka cinema run my-film               # the rest; stop any time, the same command resumes
orazaka cinema fetch my-film             # keyframes, shots and the film, to look at them
orazaka cinema reshoot my-film 3,7       # a shot you do not like: a new seed, then the cut and the sound again
```

Formats: `superhero-vfx` (original action and visual effects), `social-reel`, `news-explainer` (an original, declared
AI presenter on a general topic), `trailer`, `custom`.

## The steps

| Step | Studio | Model | What it makes |
|---|---|---|---|
| Script | `cinematic-script` | the catalogue's chat model (or `--script-model`) | title, visual bible, characters, music, voice-over, titles, 8–12 shots (camera, action, VFX, keyframe and motion prompts, transition, slow motion) |
| References | `image-generation` | FLUX.2 [klein] 4B | one still per character, before any shot is paid |
| Keyframes | `image-generation` | FLUX.2 [klein] 4B | the first frame of each shot: the shot, every character in it described in full, the visual bible |
| Shots | `video-generation` | Wan 2.2 I2V A14B, 4 distilled steps | 5 s at 720p from its keyframe (or from the previous shot's last frame for a continuous shot) |
| Cut | `cinematic-cut` | SeedVR2 3B + ffmpeg (worker) | every shot upscaled to 1080p, trims, slow motion and speed ramps, 16→30 fps motion-compensated, push-ins, LUT grade, transitions, titles in the Krizaka type, synthesized foley (ambience, whooshes, impacts), the AI label |
| Voice-over | `speech-synthesis` | Kokoro-82M (Apache-2.0) on the GPU host | the narration |
| Sound | `video-sound` | ACE-Step 1.5 (MIT) | the music bed under the cut's foley, ducked under the voice, -14 LUFS |

## Directed, then gated

The script Studio carries the **Krizaka cinematic kit**: every shot names its lens, camera move, light, depth of field,
atmosphere and pace. Read the shot list before anything is rendered (`--max-runs 1`), and edit `production.json` where it
is weak — the file says what a person changed. After the shots, look at every one frame by frame (hands, faces, text,
flicker, objects that should not be there): `orazaka cinema reshoot <dir> 3` makes one again with a new seed, or shorten
the shot in the shot list to keep only its clean seconds. Nothing mediocre ships.

- Characters, costumes, names and logos are **original**: never a studio's characters or a brand's trademarks, never a
  real person's name or likeness. The script's prompt says so; the content policy checks every run.
- A news format has an original presenter who is **clearly an AI**, on a general or clearly fictional topic.
- Nothing sexually explicit.
- Every film says **AI-generated** — drawn on the picture and written in the file's metadata.
- Foley needs a commercially licensed model; none is installed (MMAudio is non-commercial, Stable Audio Open is gated
  behind a licence acceptance), so the cut synthesizes its foley with ffmpeg — no model, no licence question.

## What it costs

Every figure — time per step, GPU time and cost per film, cost per minute of finished film — is generated from the
production files of the showcase films: see [Measured runs](_generated/MEASURED_RUNS.md#cinematic-shorts). The estimate
`orazaka cinema estimate` shows is the same per-step medians times the steps still to run, beside each Studio's own
credits.

## Where it runs

The shots, keyframes, cut, music and voice run on one 80 GB GPU host with the `cinema` profile (`scripts/gpu-dev.sh
runpod start`, `GPU_RUNPOD_PROFILE=cinema GPU_RUNPOD_DISK_GB=250`): Wan 2.2 I2V A14B with its distill LoRAs, FLUX.2 klein
on sd-server, SeedVR2, ACE-Step and Kokoro side by side. The script runs on the platform's chat model.
