# ADR-080 — Cinematic shorts: a production is a plan of Studio runs

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** the Orazaka maintainers
- **Related:** ADR-034 (Studios), ADR-066 (media becomes a pack), ADR-077 (hourly GPU, 9:16 video), ADR-078 (RunPod at $0 idle)

## Context

The market's short videos (Reels, TikTok, Shorts, YouTube) are **30 s to 1 min**, edited from many shots, with effects,
music and often a voice. Orazaka made one **5-second clip per run** (`video-generation`). A 45-second film is about ten
shots that must look like **one film**: the same characters, the same light, cuts that follow each other, a grade,
titles, a soundtrack. Every step must stay what every Orazaka step is: a **job** that is metered, policy-checked,
estimated before it runs, and resumable when it fails — never a side channel.

What the platform already has: Studios as data (blueprints), the `forEach` fan-out of a step, the chat capability, the
image capability (FLUX.2 klein on sd-server), video on the GPU worker (Wan 2.2), the sound step (ACE-Step music, voice
ducking, -14 LUFS), speech, and ffmpeg composition on the worker (`orazaka.studio.media.compose`).

What it does not have: a step whose **list of items comes out of an LLM's text** (`forEach` expands a list the scope
already holds; a chat step returns `content`, a string), and a way to **redo one item** of a fan-out without redoing the
run.

## Decision

### 1. A production is a plan of ordinary Studio runs, driven by a director

A cinematic short is **six kinds of Studio run**, in order, recorded in one production file:

| Step | Studio (pack `orazaka-media`) | Capability | Per film |
|---|---|---|---|
| Script | `cinematic-script` (new) | `orazaka.core.chat.completion` | 1 |
| Keyframes | `image-generation` | `orazaka.core.media.image` (FLUX.2 klein) | one per shot (+ character sheets) |
| Shots | `video-generation`, model `wan2.2-i2v-a14b` | `orazaka.core.media.video` | one per shot |
| Cut | `cinematic-cut` (new) | `orazaka.studio.media.compose` (`clips` + `edit`) | 1 |
| Voice-over | `speech-synthesis` | `orazaka.core.media.speech` | 0 or 1 |
| Sound | `video-sound` | `orazaka.studio.media.sound` (music + voice, ducked) | 1 |

The **director** is `orazaka cinema` (orazaka-cli): it turns a brief into the production file, shows the **estimate**
before anything runs, starts each run through the public Studio API, follows it, and records its run id, status and
output. Because each step is a normal run, each is metered once, passes the content policy, and is visible in the run
history like any other. **Resuming** is reading the production file: a shot whose run SUCCEEDED is never paid twice; a
shot that failed or that a person rejected is **reshot** alone (`orazaka cinema reshoot 3,7`, a new seed).

### 2. Consistency comes from keyframes first, then image-to-video

The script writes a **visual bible** (palette, light, lens) and **character descriptions** precise enough to draw the
same person twice. Every keyframe prompt repeats them; every shot then starts from its keyframe with **Wan 2.2 I2V
A14B**. Continuity across a cut can also come from **last-frame chaining** (a shot starts from the previous shot's last
frame), which the director does for shots the script marks as continuous. A reference model (VACE, Animate) is not used:
none is licensed and served here yet.

### 3. The shot model: Wan 2.2 I2V A14B in four distilled steps, on one 80 GB card

At 40 steps the A14B costs ~18 min of an H100 per 5-second clip (measured, docs/_generated/MEASURED_RUNS.md): ten shots
are three GPU hours. lightx2v's **4-step distillation LoRAs** (Apache-2.0, `lightx2v/Wan2.2-Distill-Loras`) make it one
pass per step without guidance — the measured time is in Measured runs. The worker loads the pair on the two experts
(`lora` in `models.yaml`). The checkpoint's 115 GB of fp32 shards live on the **pod's container disk** (`cache:
scratch`), fetched at its start, not on the shared models volume: the volume is full with the T2V experts and a bigger
one is a monthly cost; the download is paid only while a production runs.

The GPU profile `cinema` serves, on one card: the I2V A14B (offloaded expert by expert), **FLUX.2 klein on sd-server**
for the keyframes (reached by the platform's image provider at `gpu-relay:8086`, as on the droplets) and **ACE-Step** for
the music. One pod at a time, the spend guard running (ADR-078), the pod stopped when the queue is empty.

### 4. The cut is a capability with an edit decision list

`orazaka.studio.media.compose` gains a second form: given `clips` (the actor's own shot outputs, resolved by the same
ownership rule as a sound's video) and an `edit`, the worker (`app/cut.py`) trims, slows or **ramps** each shot,
interpolates 16 fps to 30 with motion compensation, pushes in, scales to **1080p**, grades through a **3D LUT** generated
from a named look, joins with **xfade** transitions (cut, dissolve, flash, whip, black, slide…), draws titles and
captions, and labels the film. The edit is checked once at the edge; one it cannot make is refused by name.

### 5. Content rules are in the data, and every film is labelled

- The script's prompt (blueprint data) requires **original** characters, costumes, logos and names — never a studio's
  characters or trademarks — and **no real person's name or likeness**. A news format uses an **original anchor persona
  who is clearly an AI presenter**, on a general or clearly fictional topic, never facts about real people or events.
  Nothing sexual. Every run still passes the operator's content policy (`real_person_likeness`, `minors_risk`).
- Every film carries **"AI-generated"** drawn on the picture and in the file's metadata (`comment`, `description`
  with `aiGenerated: true`), which the sound mux carries over. C2PA signing is not done: no C2PA work exists in the
  platform yet; when it does, the cut is where it signs.
- Foley is only made by a **commercially licensed** model; the only one installed (MMAudio) is non-commercial, so the
  showcase films have music and voice only.

## Options refused

- **One Studio with a `forEach` over the shot list.** The list is the LLM's text: expanding it needs either parsing in
  the interpreter (an expression form, refused by ADR-034 §6.2) or a structured-output step kind. And a fan-out cannot
  redo one shot without redoing the run. *Revisit* when a step kind returns typed JSON (a `STRUCTURED` kind validated by
  the run's output contract): then the production can become one server-side run, and the director a client of it.
- **One long job that renders every shot.** A dropped tunnel or a bad shot would cost the whole film; nothing would be
  metered per shot; review in between is impossible.
- **The A14B at 40 steps.** ~$1.25 a shot on an H100; the 4-step distillation is the market's practice and is measured.
- **A second, larger network volume.** A recurring cost for weights used a few hours a month.
- **Foley with MMAudio.** CC-BY-NC weights: not for a film a customer publishes.

## Consequences

- A user gets a 30–60 s film from a brief with an estimate first, can stop, resume and reshoot, and sees every step in
  the run history. The cost is the sum of ordinary runs: nothing new to bill.
- The worker serves a heavier profile; the RunPod pod needs a 200 GB container disk for that profile
  (`GPU_RUNPOD_DISK_GB`).
- The director lives in the CLI first; the web and mobile clients show the same production later (the file is the
  contract). Parity is tracked as a known gap, not hidden.
- Measured time and cost per minute of finished film are published in Measured runs, generated from the run records.

## What would say we are wrong

Characters that drift from shot to shot despite the keyframes (then: a reference model, or keyframes conditioned on a
character sheet), distilled shots whose motion is too stiff for action (then: 6–8 steps), or a production whose
re-shoots cost more than one long job would have.
