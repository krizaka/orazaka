---
title: "ADR-066 — Media becomes a pack, and starts being billed: seed files that a test loads, assets by id at the listener, four capabilities that measure what they do, a band keyed on entitlement, and a meter that stops shaping the artefact"
description: "M2. The six media capabilities become six single-step Studios in a TOOLKIT pack whose schemas carry every payload_template default. Four of them measured nothing and were served free; each now reports the quantity its act produces, with one flagged placeholder rate. infra/initdb gets the test that loads it, the job plane stops reading payload paths, the marketplace band is keyed on kind AND entitlement, the composer stops forcing 30 fps so billing can divide, and realestate-reels stops paying for a b-roll no reel contains."
category: ADR
order: 66
---

# ADR-066 — Media becomes a pack, and starts being billed

- **Status**: Accepted
- **Date**: 2026-09-16
- **Scope**: `infra/initdb/*` and `SeedBootstrapIT`; `JobListener`, `MediaAnalysisController`,
  `MediaGenerationController`, `JobSubmissionService`; `SpeechSynthesisStrategy`,
  `AudioAnalysisStrategy`, `VisionAnalysisStrategy`, `VideoAnalysisStrategy`,
  `ProcessedAudioPayload`, `ProcessedVideoPayload`, `WhisperTranscriptionClient`;
  `ConsumptionReport`, `credit_pricebook`; `PackAccess`, `PackCatalogService`, `PackCard`,
  `PackMarketplace`; `orazaka-packs/orazaka-media`; `composer.py`; `realestate-reels`;
  `BlueprintFitnessTest`
- **Implements**: M2 of [`UNIFIED_PACK_SURFACE.md`](../UNIFIED_PACK_SURFACE.md)
- **Closes**: audit #22, #31, #32, #35
- **Follows**: [ADR-065](ADR-065-retention-by-class-and-assets-by-id.md)

> **M2 is done when every media capability is runnable as a Studio *and metered once*.** Both halves
> are asserted: `MediaToolkitRunIT` runs the six against the bundle that ships and checks each
> settles exactly once.

## 1. §2 — the seed files, and the test that loads them (#31)

`30-jobs-config.sql` had not parsed since 2026-09-09: a missing comma between two constraints of
`orazaka_capabilities` and a trailing one after the second. A fresh `orazaka start` died on the file
that carries the capability registry; existing volumes never re-run initdb, so no machine showed it;
and every build was green, because the only readers of these files are **regular expressions** —
[SEAM-001]'s and [PACK-001]'s.

The comma was the finding. **The deliverable is `SeedBootstrapIT`**: it copies the whole directory
into `/docker-entrypoint-initdb.d` on `ankane/pgvector`, the image `docker-compose.yml` runs, and lets
Postgres apply every file alphabetically with `ON_ERROR_STOP`. Applying them over JDBC would prove
less — three of them use `\c` and `SET ROLE`, which are psql's and not the server's.

What it asserts after the bootstrap: every file named in the container log, no `ERROR` or `FATAL`
line, the six databases, **both** `orazaka_capabilities` constraints (the missing comma ate one), the
registry with every `routing_key` binding to a queue, and a current pricebook rate per capability.

**Plant** (the comma removed again):
`psql:/docker-entrypoint-initdb.d/30-jobs-config.sql:157: ERROR: syntax error at or near "CONSTRAINT"`.
Reverted.

This is the ninth inert control of the inventory, and the heaviest: the file is the source of truth
for capabilities, routing, pricing and fixtures, and nothing executed it.

## 2. §3 — the job plane reads no path a producer sends (#32)

M1.8 closed absolute paths at the media worker and left the other side open. `POST /api/v1/jobs`
passes its payload through verbatim; `JobListener` scoped only `assetId`; `saveInputPayload` archived
whatever `filePath` named and the executors read it. Any file the job service can read, chosen by an
authenticated caller.

**Closed where the payload is adopted.** `filePath` and `imagePath` are dropped from every incoming
payload and then filled from the ids beside them — `assetId`, `image` — resolved against
`JobCommand.userId()`, the job's own actor and never a payload value. Removing the expressiveness
rather than checking it is the same call as the worker's: an owner check keeps a way of naming files
by location that no producer needs. Not found and not yours are one answer (404, never 403).

The producers were already resolving server-side and now pass what they resolved:
`MediaAnalysisController` puts the id it 404s on, video generation hands over the image's id, and
`JobSubmissionService` stops copying the asset into the job directory — the listener archives the
asset it resolved, encrypted, as it does for every other producer.

**Two tests asserted the old contract** and are rewritten, named in their javadoc:
`onMessage_withFilePath_copiesFileToInputDirectory` and
`onMessage_withAudioAndVisionFilePaths_copiesWithCorrectNames` put a path in the payload and asserted
the listener copied what it named. **Plant** (the pass-through restored): `the payload's filePath ==>
expected: <null> but was: </…/temp/secret.png>`. Reverted.

**This does not close the `orazaka.*` key hole on the same endpoint.** That is M3, and door 1 is open
until then.

## 3. §4 — four capabilities measured nothing, so four were served free (#22)

`#22` was reported as "audio is never billed". The seed said more: **four of the six** media
capabilities carried `billable_unit NULL`, and the pattern was exact — generation billed, analysis and
synthesis did not.

| Capability | Unit | What the executor measures now |
|:---|:---|:---|
| `orazaka.core.chat.speech` | `KILOCHAR` | the characters sent to the engine — known before a sample exists, and what piper/tts-1 are priced in |
| `orazaka.core.media.audio` | `AUDIO_MINUTE` | the **source** duration the transcription provider reports |
| `orazaka.core.media.vision` | `KILOTOKEN` | tokens — already reported; only the column was NULL |
| `orazaka.core.media.video.analysis` | `AUDIO_MINUTE` | the source duration again: keyframe extraction and transcription both scale with it |

**The duration had to be carried out first.** `ProcessedAudioPayload` and `ProcessedVideoPayload` gain
`durationSeconds`; `WhisperTranscriptionClient` asks for `verbose_json`, parses `duration`, and — for a
provider that answers 4xx to that format — retries plain, after which the job settles **unmeasured**,
which releases rather than guesses.

**Why not OUTPUT_SECOND for video analysis**: an analysis produces no video, so seconds of output
would be a fabricated quantity — the `IMAGE_STEP` defect wearing a new unit. Why not `GPU_SECOND`: the
enum reserves it as the calibration basis and says it is never shown to users. Why not `CALL`: a
three-hour recording and a five-second clip are not the same work.

**The rates are not mine.** Three of the four are priced by rows that already exist (piper/tts-1 in
KILOCHAR, whisper in AUDIO_MINUTE, llava in KILOTOKEN). Video analysis needed one row, added under the
engine name the executor reports — the mechanism composition already uses, so VIDEO's diffusion
default cannot be charged for reading a file:

> ⚠ `(VIDEO, 'orazaka-video-analysis', AUDIO_MINUTE, 45.0000, 5, 90)` is a **placeholder and needs the
> owner's decision.** It sits below the whisper rows (60/min) only because this path transcribes AND
> extracts keyframes in one pass of the same hardware. Like every rate flagged in `70-billing.sql`, it
> wants a measured run. No commercial rate was invented here.

**And the column stops being decorative.** `SeedBootstrapIT` asserts that every capability declaring a
unit has a current pricebook row pricing that capability in that unit — the two sides live in two
databases and two files, and that is the only place they meet. **Plant** (the new row's unit changed to
OUTPUT_SECOND): `orazaka.core.media.video.analysis VIDEO AUDIO_MINUTE declares a unit no current
pricebook row prices`. Reverted.

**Reported, not fixed** (M4 owns the registry): `orazaka.core.chat.speech` is named `chat.*`, bills as
AUDIO and routes to `job.text.process`; `orazaka.core.media.audio` is analysis and routes to
`job.media.generate`. Both placements are deliberate — TTS on the text queue is a latency decision —
and both names lie.

## 4. §5 — the marketplace band is the server's verdict

`PackCard` read `kind === "TOOLKIT"` and printed "Included" with no button. An actor entitled to
nothing was told the pack was already theirs, and then offered no way to get it — the mirror of the
state M1 deleted, the same lie pointed the other way.

`PackAccess` holds the rule: TOOLKIT **and** entitled is `INCLUDED`; not entitled with a price is
`BUYABLE`; no price is `UNAVAILABLE`, because a card that invents an amount is one the product would be
held to. A VERTICAL is never included however entitled — buying is how it is acquired, and an owned one
still renders "Owned" from holdings. `PackCatalogService.bands()` resolves it for the whole page from
**one** entitlement snapshot, and a pack counts as entitled when every Studio it bundles is open: a
bundle half of which is locked is not something anybody has.

It travels as `access` on both pack responses; the client keys the card and the band on it. **Plant**
(the card back on `kind`): `offers the purchase for a TOOLKIT the actor is NOT entitled to — expected
document not to contain element, found … Included`. Reverted.

## 5. §6 — `orazaka-media`, and the defaults that would have gone missing

`kind: TOOLKIT`, `regulatoryClass: STANDARD`, **neither `consent` nor `safety`** — both are answered
from an installation row a TOOLKIT does not have, and the schema and the database each refuse them.
It contributes no capability and no worker: every feature key it names is already seeded and already
drained, which is what makes it a bundle of Studios rather than an extension.

Six single-step blueprints, one per capability of §3, copied from `document-validation`'s shape.

**Every `payload_template` default, and where it landed** — M4 drops that column, and a default that
only ever lived there disappears with it:

| Capability | Template default | Schema field | Blueprint |
|:---|:---|:---|:---|
| `orazaka.core.media.image` | `size` = `1024x1024` | `size.default` (with an enum of five sizes) | `image-generation` |
| `orazaka.core.media.video` | `durationSeconds` = `5` | `durationSeconds.default`, 1–20 | `video-generation` |
| `orazaka.core.chat.speech` | `voice` = `alloy` | `voice.default` | `speech-synthesis` |
| `orazaka.core.media.vision` | `prompt` = `Analyze this image` | `prompt.default` | `image-analysis` |
| all six | `model` = *(empty)* | **deliberately none** — empty meant "the catalogue chooses", a resolution and not a value | all six |
| `orazaka.core.chat.completion` | `model` = *(empty)* | same | no media Studio; packs use it as a step |
| `orazaka.studio.media.compose` | `clip`, `bRoll`, `audio` = *(empty)* | none | no Studio by design (§3.1): an assembly primitive means nothing without a brand kit and a script |

The Schema is a gain rather than a translation: `required`, `enum`, `minimum`/`maximum` and
`maxLength` are things `${size:1024x1024}` could not express, so the run form is validated
server-side where it was not.

**That table is now a rule.** `BlueprintFitnessTest` reads the `payload_template` of every capability a
bundled blueprint names and fails when a default it declares is absent from that blueprint's schema.
**Plant** (the `size` default deleted): `orazaka.core.media.image: size defaulted to '1024x1024' and
the schema carries none`. Reverted.

**Acceptance.** `MediaToolkitRunIT` runs all six against the real bundle and the real `80-studio.sql`:
each is included by entitlement alone with **zero** installation rows, dispatches **one** step, reaches
`SUCCEEDED`, and settles **exactly once** against the engine that ran. It was red on its first run for
the right reason — `image-generation settled exactly once ==> expected: <1> but was: <0>` — because an
outcome carrying no measurement is released, not billed, which is precisely what these six did through
door 1.

**The fitness table was wrong where nothing had looked.** `PUBLISHED_FIELDS` said
`orazaka.core.media.audio` publishes `url`; it is audio *analysis* and publishes `analysis`. The entry
was transcribed while that row still called itself "Audio Generation" (the mislabelling ADR-054 §8
corrected in the seed), and the table kept the old reading — so the rule would have passed a blueprint
reading a field no executor produces and failed the one reading the real one. Corrected, with the two
capabilities no blueprint had named before.

**Door 1 is untouched.** Both doors work at the end of this run; M3 reviews the deletion on its own.

## 6. §7 — the meter stops shaping the artefact, and audio gets a contract

### 6.1 The fps decision, reversed

ADR-063 made the composer pass `-r 30` to ffmpeg **so that `frames / fps` would divide into seconds**,
because that quotient was the only way billing could reach `OUTPUT_SECOND`. Changing what we produce so
the meter works is backwards even when the new artefact is better.

`ConsumptionReport` gains `durationSeconds` and `outputSeconds()` prefers it: the duration **is** the
quantity; frames over rate only ever approached it, exactly when the rate was constant and whole. The
fallback stays for an executor that reports frames and no duration. The composer reads the container's
duration from ffprobe and reports no frame count and no rate at all — 30 fps is an encoding choice
again, which is what short-form platforms want, and changing it now changes the video and not the bill.

The composition divergence contract moved with it, and **one of its tests went**:
`test_without_audio_the_billed_rate_is_the_files_rate` asserted the billed `fps` equals the file's rate,
which is no longer a billing fact. What replaces it asserts the bill carries no rate at all, and the
2 s-voiceover case still bills the file. **Plant** (the composer reporting the requested slideshow
length again): `9.0 != 2.02 within 0.1 delta (6.98 difference)` — the original defect, reproduced
through the new meter.

### 6.2 The audio and video-analysis contracts

Audio has no artefact a test can decode without a model, so the oracle is **what crossed the
boundary**: the request the engine received and the response the provider returned.

- **Synthesis** bills the text *sent* — a payload carrying a second, longer `text` field does not
  change the bill, and 4 096 bytes of mp3 have nothing to do with a KILOCHAR quantity. **Plant** (the
  meter reading the request's other field): `expected: 28L but was: 120L`.
- **Transcription** bills the provider's reported duration: a 64 KB file transcribed for 30 s bills
  30 s, because 30 s is what was done.
- **Video analysis** bills source minutes under `orazaka-video-analysis`, reports no output second,
  and does not bill keyframes — a count the platform sets for itself with a configured interval.
- Each path asserts the **unmeasured** case releases.

## 7. §8 — what a pack bills versus what it does (#35)

`realestate-reels` generated a five-second ambience clip on the accelerator, passed it to `compose` as
`bRoll`, and the media worker read `photos` and `audio` and nothing else. The clip was billed at the
diffusion rate — **3 600 credits** of the run's reserve at v2 rates — and no reel ever contained it.
The step is removed; the declared cost goes 6 400 → 2 800, the difference being exactly the pricebook's
VIDEO estimate. Restoring ambience footage is a product decision that requires the composer to assemble
it, not a remediation.

**What checks that a blueprint's declared cost corresponds to the steps it runs?** Nothing did. Half of
it is now a rule and half of it honestly is not:

- **A rule**, because it is visible in data: *no step may pass an input its executor does not read.*
  `CONSUMED_INPUTS` mirrors `PUBLISHED_FIELDS`; an ignored input is either work bought and discarded
  or a promise the author believes. **Plant** (the `bRoll` input restored):
  `realestate-reels.assemble passes 'bRoll' to orazaka.studio.media.compose, which reads [audio, photos]`.
- **Not a rule**: comparing `estimatedCredits` to the sum of its steps' pricebook estimates. A
  `forEach` step fans out over a list whose length is a run-time input, an approval gate costs
  nothing, and a step's rate depends on the model the executor resolves — the arithmetic has no single
  right answer at authoring time. That half stays a judgement per pack, and this ADR makes it once,
  out loud, above.

## 8. Last runs' controls

`[CFG-001]`, GOV-006, `[LOG-001]`, `[PACK-001]`, the Python collection guard, `ImageGeneratorClientImplTest`
and `UserPreferencesContractTest`: unchanged and green. Two contracts were **deliberately extended**, and
say so in their own text: the composition divergence contract (the fps test replaced) and
`BlueprintFitnessTest` (two new rules, one corrected table).

## 9. Found during M2 — for M2.5's report

1. 🟠 **`orazaka.studio.media.compose` implements two of its seven declared inputs.** `clip`, `bRoll`,
   `captions`, `brandKit` and `aspect` are advertised by the capability's template and its label
   ("photos + clip + voiceover + captions + brand overlay"); the worker reads `photos` and `audio`.
2. 🟡 **The bundle is written, not installed.** `orazaka packs install orazaka-packs/orazaka-media`
   is a runtime action against running services, so the six Studios exist in the repository and not
   yet in the local database.
3. 🟡 **A provider that refuses `verbose_json`** makes every transcription unbillable, silently — the
   retry is correct and says nothing about a deployment that will never measure.
4. 🟡 The two naming incoherences of §3, which M4 owns.

**And the twelve of M1.8 that this run did not touch stay open**: #33 (a protected job that never
reaches terminal is never purged), #34 (a timed-out execution is not cancelled), #36 (dead-letter
queues nothing consumes), #37 (worker-routed Studio steps have no job row), #38 (STANDARD jobs have no
window), #39 (`purgeJobsByUserId` leaves directories), #40 (`studio_outbox` never purged), #41
(`dataClassOf` defaults to STANDARD), #42 (automation jobs carry no class), plus #29 (`pypdf`
undeclared), #30 (the dedup claim never released) and #19 (the M2M JWT, a deployment blocker).

## 10. Migrations

`infra/migrations/2026-09-16-media-billable-units.sql` — the four `billable_unit` values and the
flagged video-analysis rate. Applied to the local database and re-applied without error.
