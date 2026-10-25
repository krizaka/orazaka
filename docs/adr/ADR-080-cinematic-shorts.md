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

### 3b. Directed, not described: the Krizaka cinematic kit

Brand films are Hollywood-grade (rule of 2026-10-17). The script Studio carries the **Krizaka cinematic kit** in its
prompt (data): every shot names its lens in mm, its camera move and speed, its light (key, rim, practicals), depth of
field, atmosphere and pace; shot sizes vary, the 180° rule holds, slow motion and a speed ramp land the hero moment.
The director adds the kit's filmic finish to every keyframe and a negative against fused fingers, distorted faces and a
CGI look. A person reviews the script before any GPU second (the production file is edited, and says so), and every
shot is gated frame by frame after it is made: a shot that fails is reshot alone.

### 4. The cut is a capability with an edit decision list

`orazaka.studio.media.compose` gains a second form: given `clips` (the actor's own shot outputs, resolved by the same
ownership rule as a sound's video) and an `edit`, the worker (`app/cut.py`) trims, slows or **ramps** each shot,
upscales every shot to **1080p with SeedVR2 3B** (Apache-2.0, the upscaler the showcase comparison measured best; the
short side to 1080, so 9:16 and 16:9 both keep their frame), interpolates 16 fps to 30 with motion compensation, pushes in, grades through a **3D LUT** generated
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
- Foley is only made by a **commercially licensed** model. MMAudio's weights are non-commercial and Stable Audio Open
  is gated behind a licence acceptance that is an account decision, so the cut **synthesizes** its foley with ffmpeg
  (no model, no licence): an ambience bed (rain, storm, wind, city, room, nature) and whooshes and impacts placed on the
  transitions and ramps of the edit. The sound step keeps that track as the foley of the mix, under the music and the
  voice.

## Options refused

- **One Studio with a `forEach` over the shot list.** The list is the LLM's text: expanding it needs either parsing in
  the interpreter (an expression form, refused by ADR-034 §6.2) or a structured-output step kind. And a fan-out cannot
  redo one shot without redoing the run. *Revisit* when a step kind returns typed JSON (a `STRUCTURED` kind validated by
  the run's output contract): then the production can become one server-side run, and the director a client of it.
- **One long job that renders every shot.** A dropped tunnel or a bad shot would cost the whole film; nothing would be
  metered per shot; review in between is impossible.
- **The A14B at 40 steps.** ~$1.25 a shot on an H100; the 4-step distillation is the market's practice and is measured.
- **A second, larger network volume.** A recurring cost for weights used a few hours a month.
- **Foley with MMAudio.** CC-BY-NC weights: not for a film a customer publishes. **Stable Audio Open**: commercial use
  under its community licence, but gated — accepting that licence is a decision for the account owner; revisit then.

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

## Addendum 2026-10-20 — the cinema pack completed (orazaka#259), proven by « l'aube »

The four gaps #259 named are closed in the director (orazaka-cli) and the worker (orazaka-worker-media), and a 4K brand
film was made with them (krizaka-ui `tools/brand-films/dawn/`, measured in [Measured runs](../_generated/MEASURED_RUNS.md)):

1. **Shot-list planner** — `orazaka cinema plan --treatment`: a directed treatment (shots with duration, lens, camera, light,
   air, action, cast and **the video model of each shot**) becomes the script without a language model, checked once and
   refused by name. `plan --update` applies a changed treatment and keeps every shot already made.
2. **Tail-frame chaining** — a reshoot now reshoots the shots chained to it (they started from a frame that no longer
   exists: the old behaviour was a bug). `chainAt` starts a chained shot from a chosen second of the previous take: the
   film showed why — a bird that flies out of frame leaves an empty last frame, and the next shot would have to invent it.
3. **Redo one shot** — `reshoot`, `take` (a take made on a GPU host) and `jobs` (the pending shots for a host that runs the
   worker's own `generate_wan_frames`): the same production file whether the shots run as Studio runs or on a pod.
   A shot is made only as long as it is used (frames per shot, plus a 0.4 s handle).
4. **The edit and the deliverables** — the cut can make a **4K master** (`master: "2160p"`, SeedVR2 with a tiled VAE) and a
   clean one (`text: false`); `app/deliver.py` cuts **2160p, 1080p and 9:16** from it, the 9:16 window following each
   shot's subject, the captions and the « AI-generated » label drawn per language after the reframe.

**Characters stay on-model by construction** (§2 revisited): a free image edit redrew a brand's bird (the falcon lost its
visor). The keyframe is made from the character's own render instead: an empty plate, the render composited and lit like
the plate, then FLUX.2 [klein] image-to-image at a high image strength (0.60 for one character, 0.80 for a group: a group of
five drifted at 0.60). Each character has a reference sheet from its render, and every take gets a review sheet (a frame
every 8 under the cast's sheet): 4 of 19 takes were cut to their good part or reshot.

**Measured on an H200 141 GB** (RunPod secure, $5.29/h): Wan 2.2 I2V A14B **at 40 steps**, 1280×720, 81 frames: 1567 s
alone (36 s a step, no offload); SageAttention (BSD-3) 31 s a step (−13 %: kept, not decisive). LTX-Video 0.9.8: 11–20 s
a clip. SeedVR2 3B to 2160p beside a resident Wan: ~17 min a clip at batch 5, **290 s at batch 21** (`SEEDVR2_BATCH_SIZE`),
so the 4K upscale runs behind the generation instead of after it.

**What this changes**: the Studio's video model stays the catalogue's (the 4-step distill for dev runs); a brand film names
`wan2.2-i2v-a14b-hq` per shot. The image Studio still has no reference-image input, so on-model keyframes run outside
it (on a Mac, $0) — a gap to close in `orazaka.core.media.image` (an `images` input to FLUX.2 [klein]'s edit).

**« l'aube » cost** (docs/measurements/cinema.json): 62.5 s of 4K film, 19 planned shots (18 in the cut), 23 takes of
which 4 were rejected or cut down; $34.42 billed on RunPod (6.5 h of one H200, setup and a guard stop at 6 h included)
= **$33.09 per finished minute**; the runs' own GPU time was 5.5 h ($29.00). Keyframes, score and narrator: $0 (a Mac).

## Addendum v2, 2026-10-20 — from a shot list to a story (orazaka#289)

Oussama watched « l'aube » v1: the picture, the light and the textures are very good; everything else failed. The titles
were not cinematic, the narrator was a flat « GPS » voice not aligned with the picture over a score far too aggressive,
there was no foley, the story did not transport anyone, and the birds moved without being alive, doing things off
their topic. The cause was the pack, not the film: a brief went straight to a shot list, nothing judged the story, every
character shot was « the bird moves », the voice had no direction, the score one level, the sound one wind bed. The pack
must now **guide and enrich a short prompt into a directed film**. Decisions:

### v2.1 A treatment stage before the shot list, judged twice

- **`cinematic-treatment`** (orazaka-packs, a chat Studio): a short brief becomes a **story** — a theme, an arc of four
  beats in order (hook → journey → turn → payoff), each character's **intention** from its promise, and shots that each
  carry a **purpose**, a **beat**, an **action** that serves both, a **gaze**, the **physics** of the body and the
  **interaction** between characters; the narrator's **lines** with their direction (emotion, pace, emphasis, pause) and
  the shots they land on; **music cues** per beat with an intensity; a **sound list** per shot.
- **The critique**, twice: a **rubric without a model** (orazaka-cli `cinema.story.ts`: `critiqueStory` — the arc in
  order with the turn after the first third, a purpose per shot, living and on-topic character shots, chained shots that
  share a character, lines that fit their shots at ≤ 2.6 words/s, a score that starts low, peaks on the turn, never
  passes 0.85 and resolves, a heard action in every character shot) and an **LLM judge** (`cinematic-critique`, six
  axes scored 1–5: transport, arc, characters, alive, on-topic, continuity, plus the shots it rejects). A story is filmed
  only when both accept it; otherwise the reasons go back to the writer (`notes`), at most twice (`orazaka cinema treat`).
- The planner reads the new fields: a shot may start from a frame of **any earlier take** (`chainFrom`, and a reshoot
  redoes the whole chain), and a take from an earlier production can be **kept** (`reuse`: nothing made, nothing paid).
  `orazaka cinema timeline` places every line, cue and sound on the cut and says which line does not fit its shots.

### v2.2 Living birds

Every character shot's motion prompt is a **performance**: a sequence with a change (first…, then…, finally…), where the
character looks and why, the body's physics (breath, weight, wing beats with effort, landing and folding, gripping and
carrying) and the interaction — never « stands », « looks around », « turns its head left then right », which the rubric
now rejects by name (`flat`). Shots are shorter and purposeful (2.7–4 s), with more coverage; continuity across cuts
through `chainFrom` (the pigeon's fall and climb continue its launch). Each take is gated **on-model** (the review sheet
against the Mascot render, as in v1) and **alive and on-topic** (its motion energy measured over the frames, and the
review sheet read against the shot's purpose and action).

### v2.3 The narrator: an expressive voice, directed, compared blind

Candidates, licence first (only what a customer may publish):

| Model | Licence of the weights | Verdict |
| --- | --- | --- |
| Kokoro-82M (hexgrad) | Apache-2.0 | v1's voice; one speed, no emotion: F0 range 8.6–11 semitones. Kept only as the **synthetic reference voice** the others clone (no real person's voice). |
| Kokoro + phrasing (pauses, pace per phrase) | Apache-2.0 | More air, the same flat contour (8.8–11.3 st). |
| Chatterbox / Chatterbox Multilingual (Resemble AI) | MIT (with Perth watermark) | Very expressive in English (17–19 st) but ignores a slow pace (3.3 words/s) and its French missed words (WER 0.67 on one line). |
| **Zonos v0.1 transformer (Zyphra)** | **Apache-2.0** | **Chosen**: emotion vector, speaking rate and pitch variation per utterance, English and French; 11.8–19.4 st, every word understood (Whisper large-v3-turbo WER 0 on the six takes), the asked pace held (2.1–2.3 words/s on slow lines). |
| F5-TTS | code MIT, weights CC-BY-NC 4.0 | Refused (non-commercial). |
| XTTS-v2 (Coqui) | CPML (non-commercial) | Refused. |
| StyleTTS 2 | code MIT, LibriTTS weights (disclosure required) | Not tested: English only, the film is EN and FR. |
| OpenVoice V2 + MeloTTS | MIT | Not tested: tone transfer without emotion control. |

The blind A/B: three lines of the new story (the hook, the turn, the delivery) × two languages × four candidates, each
said from the same synthetic reference. An **audio language model as judge** (Qwen2-Audio-7B-Instruct, Apache-2.0) was
calibrated first and **refused as a gate**: its 1–5 ratings were ≈ 4.0 for every candidate, v1's flat voice included,
and asked to choose between two takes it answered « A » 36 times out of 36 in both orders (position bias). The gate's
« MOS-like » voice score is therefore **measured**: intelligibility (Whisper WER), pitch movement (F0 range and motion in
semitones), pauses and speaking rate against the direction — and a person's listen of the blind A/B page decides.

Each line is said in phrases (`app/voice_direction.py`): the line's emotion becomes Zonos's emotion axes, its pace a
speaking rate, an emphasised phrase is slower and more melodic, each break breathes as its punctuation asks; the voice
gets **room tone** in the mix (early reflections and a low room bed). Lines are placed by the timeline on the shots that
show them, a beat after the cut.

### v2.4 The score follows the arc; the mix has a contract

ACE-Step 1.5 XL turbo (MIT) stays: MusicGen's weights are CC-BY-NC and Stable Audio Open's licence is still an account
decision. It now makes **one cue per beat** from the treatment (a dark intro, a warm underscore, a build, a resolve), and
`app/mixer.py` lays them at the level their intensity asks (−24 dB at 0 to −9 dB at 1, never full scale), crossfaded at
the beat changes, faded in and resolved over 3 s; the score is **ducked** under the voice by a sidechain (4:1, 60 ms
attack, 900 ms release), the foley a little too; the master is gained to **−14 LUFS integrated ± 0.5 LU** and limited
(4× oversampled) to a **true peak ≤ −1 dBTP**, measured again, and refused outside that contract.

### v2.5 Foley by synthesis, per shot

Every model that makes foley from a prompt or a picture is refused for a published film: MMAudio (CC-BY-NC), AudioLDM 2
(CC-BY-NC-SA), Tango / TangoFlux (non-commercial, Stable Audio Open's VAE), HunyuanVideo-Foley (Tencent's community
licence excludes the EU, the UK and South Korea), Stable Audio Open (gated, as above). A CC0 library (freesound, CC0
only) needs an API account and a per-file licence check: not available to the pack. So `app/foley.py` **synthesizes**
the sound list — 12 beds (rain, storm, wind, lake, waves, a room, dawn birds, a far city…) and 20 events (wing beats,
steps, rustle, paper, a block set down, a glow igniting, chimes, bird calls, splashes, a coin, a parcel, thunder…) from
noise, resonators and envelopes shaped in the frequency domain (numpy only), deterministic for a seed. The gate checks
**foley coverage**: no silent shot, every character shot with an event.

### v2.6 Titles set like a film

`app/titles.py` writes an **ASS** script burnt in by libass (ffmpeg `ass`): the main title is a pairing — the name in
Plus Jakarta Sans SemiBold (`@krizaka/fonts`, OFL), uppercase, its tracking opening slowly while it holds; the subtitle
in Cormorant Garamond Light Italic (OFL) arriving 0.45 s later; 1.1 s fade in, 0.8 s out. Subtitles: Inter Medium,
sentence case, two balanced lines of ≤ 42 characters breaking after punctuation, a soft blurred halo instead of a box,
160 ms fades, ≥ 1 s on screen, a start or end within 0.25 s of a cut moved onto the cut. Everything inside the title-safe
area (10 % each side); a 9:16 frame also keeps the platforms' bottom quarter and top tenth clear. The « AI-generated »
label stays on the picture, small, top right. Rendered and checked at 16:9 and 9:16.

### v2.7 The gate

`gate.json` of a film now holds one check per step: the story (rubric scores and the judge's), each take on-model and
alive/on-topic, the voice (WER, pitch movement, pace, and the person's listen), the loudness (measured LUFS, true peak),
the foley coverage, the titles (rendered at both aspects).

### v2.8 No children, no child-like figures, no dolls or toys (2026-10-21)

A hard rule for every Orochia or brand film, after a FLUX plate put a child-like doll in the flamingo's bed
(« Orochia : la première livraison », keyframe 03; its Wan take was rejected and reshot from a clean plate).
- **Prompts:** every plate, keyframe, character and shot prompt carries « No children, no child-like figures, no dolls or toys »,
  with or without a treatment's keep lines (`NO_CHILDREN`, orazaka-cli `cinema.production.ts`; krizaka-ui
  `tools/brand-films/dawn/keyframes.py`). The keyframe and Wan negatives name child, children, child-like figure, doll and toy.
- **Frame check:** each keyframe is checked before any GPU, then six frames sampled across each take
  (`cinema.childsafe.ts`: `sampleTimes`, `CHILD_CHECK_PROMPT`, `parseChildCheck`, `childGate`; run by `childsafe.py`).
  - The model is Qwen2.5-VL 7B (Apache-2.0), local on MLX.
  - It answers one yes/no question, read strictly: only a clear NO clears a frame.
  - One flagged frame rejects the take, and a film passes only after a person's review (`gate.json childSafe.reviewedBy`).
- **Measured:** the check flags the doll keyframe and the doll take, and clears the 18 clean keyframes and the clean takes.
  LLaVA 1.6 and BakLLaVA missed the doll, so they are refused for this check.

**« le relais » cost** (v2, 2026-10-21): 68 s of 4K film, 25 shots, 4 reshot (two bird takes off-model, one LTX landscape
that invented birds, one phoenix that stayed still); $35.27 billed on RunPod within a $40 cap (one H200 at $5.29/h:
the takes, two reshoots and the 25 SeedVR2 4K upscales) = **$31.12 per finished minute**. Of that, ~$4.1 went to two
fresh pods the idle guard stopped during their first setup (pip, then a weights download longer than 20 minutes at 0 %
GPU), and some minutes to a pod left idle after its last upscale. Treatment, keyframes, voice, score, foley, titles and
the finish: $0 (a Mac). Two lessons became code: one batch per take for SeedVR2 (3.1 min per 4K take instead of 7–11)
and a pod queue that stops its own pod when it empties or fails (krizaka-ui `tools/brand-films/dawn/pod/queue.sh`).
