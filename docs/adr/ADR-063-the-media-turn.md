---
title: "ADR-063 — The media turn: a bypass nobody needed, two interceptors that did need it, and a bill measured on the file"
description: "M1.6. The branch that skipped the pipeline for a prompt carrying an image was vestigial; removing it made the refiner and the router run on images for the first time, and they were the defect. Guards now see that an image is in the turn and refuse what they cannot read. Media chat turns had never been billed. Video composition is metered on the file it wrote, and the divergence contract now says so for video."
category: ADR
order: 63
---

# ADR-063 — The media turn

- **Status**: Accepted
- **Date**: 2026-09-15
- **Scope**: `EnginePipelineBridge`, `DynamicPipelineExecutor`, `MessageCompiler`, `PromptContext`;
  `SafetyInterceptor`, `ScopeGuardInterceptor`, `RefinerInterceptor`, `RouterInterceptor`; the media
  worker's `composer.py`; `AGENTS.md` §12; `BILLING_ARCHITECTURE.md` §7
- **Implements**: M1.6 of [`UNIFIED_PACK_SURFACE.md`](../UNIFIED_PACK_SURFACE.md)
- **Closes**: audit #21 (the media-turn bypass) and #20 (composition bills intended duration)
- **Follows**: [ADR-062](ADR-062-inert-controls-closed.md), whose §2.3 this corrects

## 1. The exposure is the chat API

ADR-062 §2.3 recorded the bypass and said its exposure was "not established". That was wrong, and
the reason is in the first line of the branch: `Base64MediaExtractor.extract` reads **the prompt
string**. Any caller that puts `[posterBase64: <base64>]` in the text it sends — the synchronous
chat endpoint, the streaming one, any `AiClient.chat` producer — set `hasMedia` and skipped the
pipeline. No endpoint, no upload, no client capability. The one in-tree producer of the marker is
`VisionAnalysisStrategy`; the exposure is everyone else.

One precision: the trigger is that marker, not a `data:` URL. A `data:image/png;base64,…` URL in a
prompt is not extracted — it travels as text and always went through the pipeline.

## 2. Why the branch existed

### 2.1 The evidence

| Question | Answer | Where |
|:---|:---|:---|
| When did `if (!hasMedia)` arrive? | In `fc939a6d init project`, a 1,283-file import. No message, no ADR, no test asserting the skip. Untouched since except by moves and ADR-062's switch read | `git log -S'skip for media prompts'` |
| Did the pipeline ever receive base64? | **No, in no version in this repository.** `queryForPipeline = mediaResult.cleanedQuery()` is in the imported file, two lines above the branch | `EnginePipelineBridge` @ `fc939a6d` |
| What else did the import carry? | A `MediaInterceptor` row seeded **enabled** in `pipeline_interceptor_config` — *"Base64 media extraction and multimodal assembly"* — and named in `PipelineRegistry.DEFAULT_ROUTES`. **No such class exists in any commit.** Every turn logs *"has no registered bean — skipping"* | `30-jobs-config.sql:387`, `git log -S'class MediaInterceptor'` (empty) |
| And? | `MessageCompiler` lifted a marker out of the pipeline's **output** — a path that only means something if the pipeline once carried one | `appendTextOrRefinedMediaMessage` |

### 2.2 The answer

**Vestigial.** The skip belongs to a design in which media extraction was a pipeline stage
(`MediaInterceptor`) and the pipeline received the raw prompt, base64 included. Extraction moved
ahead of the pipeline, into the engine, before this repository began; the skip stayed. No
interceptor throws on a media turn, and none could have choked on a megabyte of base64 it never saw.

### 2.3 But two interceptors were the defect

Removing a bypass makes reachable whatever sat behind it, so the chain was traced before the branch
was removed — the principle now written into AGENTS.md §12. The seeded chain, on a turn whose text
is *"t'en penses quoi ?"* and whose subject is a photographed lease:

| Interceptor (seed order) | On a media turn | Verdict |
|:---|:---|:---|
| `SafetyInterceptor`, `ScopeGuardInterceptor` (Phase 1) | match terms on the text; pass | **defect** — §4 |
| `UserContextResolver`, `SystemContextInjector`, `RagInterceptor` | enrich metadata from the actor and the text | correct: nothing claims to have read the image |
| `EntitlementInterceptor` (4) | entitlement check and hold | correct — and never ran before, §5 |
| `McpInterceptor`, `BrandContextInterceptor`, `MemoryInterceptor`, `ToolInterceptor`, `UserContextInterceptor` | enrich from the text, the actor, the conversation | correct |
| **`RefinerInterceptor` (8)** | asks `llama3.2:3b` to rewrite the text — **without the image** — and the rewrite replaces the user's words beside the image sent to the vision model | **defect**: declines on a media turn |
| **`RouterInterceptor` (9)** | picks a provider from the text alone; a routed provider **outranks the caller's** in `resolveProvider`, so a vision job naming its vision model is sent wherever *"Analyze this image"* reads best | **defect**: declines on a media turn |
| `MediaInterceptor` (10) | no bean | the ghost of §2.1 — recorded, not removed |

Both reformulation stages are seeded enabled and wired to a default model by `CoreConfiguration`.
Declining is the interceptor's decision, made where the knowledge is, and is not a bypass: they are
enrichments, not controls, and `disable-ai` still refuses them before they are asked (§6, test 2).
With both declining, a vision turn sends the model the same text and the same provider it did while
the pipeline was skipped — the working feature keeps working, and the controls run.

## 3. Option (a): every turn through the pipeline, media declared

- **The branch is gone.** `compileContext` calls `process` for every turn.
- **ADR-062's switch read in the engine is gone with it.** It existed only because the branch
  skipped `process`; `requireEnabled` is private again, and the switch has one read site.
- **Media presence is a typed component, `PromptContext.mediaParts`**, with `carriesMedia()` — not a
  metadata key. `withSystemMetadata` accepts any map, so a key there survives only while every stage
  copies the map it was handed; the six that rewrite it do today, and nothing obliges the seventh. A
  component cannot be dropped by an enrichment. The engine declares the count, which it knows
  because it lifted the image; it says nothing about what an image means. That stays with the
  interceptors (AGENTS.md §12).
- **Media reaches the model only from the user's own prompt.** The re-extraction from the refined
  prompt is removed: an image lifted out of the pipeline's output would be one no guard was told
  about — a refiner that "repaired" a malformed marker would have put media in front of the model
  after every control had passed the turn as text.

Option (b), refusing media on the chat endpoint, was not taken: it removes a working feature, and
that is the media pack's decision (M2), not a remediation run's.

## 4. A guard that cannot see is told there is something to see

Running the pipeline on the cleaned text alone would have closed the audit row and left the hole:
the scope guard would run, match *"t'en penses quoi ?"* against *"conseil juridique, bail"*, report
clean, and have examined none of what the pack drew its boundary around — `[PACK-001]`'s shape, a
control invoked over the wrong set. §6's R2 is that fix, measured: it turns two tests red.

Both guards are word matchers. With a declaration **and** an image in the turn:

| Guard | Does | Why |
|:---|:---|:---|
| `ScopeGuardInterceptor` | refuses, with the pack's own refusal text | fails closed against the party not in the room (AGENTS.md §12). A refused photo is recoverable; an answer inside the refused domain is not |
| `SafetyInterceptor` | answers the pack's reviewed crisis text | its own documented asymmetry: a false positive shows a crisis line someone did not need; a false negative sends someone in crisis to a language model. A photographed note sent with *"regarde"* is exactly that false negative |

Both short-circuit with reason **`subject_not_examinable`**, distinct from `out_of_declared_scope`
and `crisis_content`: nothing was found — the guard could not look, and the trail should say which.
A matched term keeps its own reason, image or not. **No declaration, no guard**: an image on a
STANDARD turn passes, as it must.

What M2 inherits: a pack that wants images examined needs a guard that can read them — a reviewed
model with a budget, which ADR-051 already defers to REGULATED work — or a declared image policy.
Until then, a pack that declares a scope or crisis guard refuses images it cannot read.

## 5. D6 — media chat turns were never billed

The bypassed entitlement check means **no media chat turn has ever taken a credit hold, and so none
was ever settled**. `resolveHoldId(null)` was `null`; `ChatSettlementListener` had nothing to close.
Vision inference is not free, and it was served free to any caller who put the image in the text.

The sixth billing defect. By mechanism it is a **path**, not a quantity: no report was wrong, there
was no report. Neither [BILL-001] (producers of the deferred marker) nor [BILL-002] (quantities
follow the work) could have found it. What finds it now is §6's test 4.

Unaffected: `image.analyze` jobs through door 1 hold before they are queued and carry the deferred
marker, so the pipeline now runs their entitlement check and takes no second hold. Media chat turns
now settle as `CHAT` on the tokens the provider reports; whether vision tokens want their own price
row is M2's question.

## 6. Proof — four controls, five tests, each seen failing

`MediaTurnControlsTest` sends a chat turn carrying an inline image through the **production**
`Engine`, `EnginePipelineBridge`, `DynamicPipelineExecutor`, `SafetyInterceptor`,
`ScopeGuardInterceptor`, `EntitlementInterceptor` and `RefinerInterceptor`. Only the edges are
doubles: the model, the billing ports, the pipeline-order rows. One test per control — the guards
control has two, one per guard — because a single assertion can pass for the wrong reason.

| # | Test | Asserts |
|:---|:---|:---|
| 1 | `theOrchestrationSwitchIsHonoured` | `PipelineDisabledException`; the model is never called |
| 2 | `disableAiIsHonoured` | `SecurityException` naming `RefinerInterceptor`; the model is never called |
| 3a | `theScopeGuardSeesTheMedia` | refused by `ScopeGuardInterceptor`, reason `subject_not_examinable` |
| 3b | `theCrisisGuardSeesTheMedia` | answered by `SafetyInterceptor`, reason `subject_not_examinable` |
| 4 | `aCreditHoldIsTaken` | the completed-turn event carries the hold |

**R1 — the bypass restored exactly as it stood before ADR-062** (branch, no switch read): all red.

```
[ERROR] Tests run: 5, Failures: 5, Errors: 0, Skipped: 0
[ERROR]   MediaTurnControlsTest.aCreditHoldIsTaken:169
[ERROR]   MediaTurnControlsTest.disableAiIsHonoured:107
[ERROR]   MediaTurnControlsTest.theCrisisGuardSeesTheMedia:143
[ERROR]   MediaTurnControlsTest.theOrchestrationSwitchIsHonoured:97
[ERROR]   MediaTurnControlsTest.theScopeGuardSeesTheMedia:123
```

Test 4's message is the defect of §5: `Expecting actual: [null] to contain exactly: ["hold-media-1"]`
— the turn completed and published an event with no hold.

**R1′ — the bypass as ADR-062 left it** (branch, switch read ahead of it): the switch holds, the
other four do not. The read ADR-062 added honoured one control of the four.

```
[ERROR] Tests run: 5, Failures: 4, Errors: 0, Skipped: 0
[ERROR]   MediaTurnControlsTest.aCreditHoldIsTaken:169
[ERROR]   MediaTurnControlsTest.disableAiIsHonoured:107
[ERROR]   MediaTurnControlsTest.theCrisisGuardSeesTheMedia:143
[ERROR]   MediaTurnControlsTest.theScopeGuardSeesTheMedia:123
```

**R2 — the fix that is not one**: the pipeline runs on the cleaned text, media undeclared. Switch,
`disable-ai` and hold pass; the guards pass the photographed lease.

```
[ERROR] Tests run: 5, Failures: 2, Errors: 0, Skipped: 0
[ERROR]   MediaTurnControlsTest.theCrisisGuardSeesTheMedia:143
[ERROR]   MediaTurnControlsTest.theScopeGuardSeesTheMedia:123
```

**R3 — media declared, each guard's media branch removed in turn**: one red each
(`theScopeGuardSeesTheMedia:123`, then `theCrisisGuardSeesTheMedia:143`). Every removal restored;
5/5 green.

## 7. #20 — the divergence contract, extended to video

### 7.1 The contract

`TestCompositionDivergenceContract` (media worker) runs the **real composer and real ffmpeg** on
three stills held 3 s each over a **deliberately short 2 s voiceover**. `-shortest` ends the file at
the audio: the request says 9 s, the file says 2. The oracle is **ffprobe on the written file**, read
by the test and not through the composer — a contract that asked the composer what it made would
check it against itself — and billed seconds are computed as billing computes them, `frames / fps`.
No ffmpeg fails the class; it does not skip it.

On the composer as it was:

```
FAIL: test_a_short_voiceover_bills_the_file_not_the_slideshow
AssertionError: 9.0 != 2.02 within 0.1 delta (6.98 difference) : billed {'frames': 270, 'fps': 30, 'images': 3, 'width': 180, 'height': 320} for a file of 2.02 s
FAIL: test_without_audio_the_billed_rate_is_the_files_rate
AssertionError: '30/1' != '1/3'
```

### 7.2 What the file actually was

Probing the output showed why "measure the file" needed one more decision. Without `-r`, the concat
demuxer writes **one frame per still at a variable rate**: 4 frames over 9.04 s (`r_frame_rate
1/3`), and with the short voiceover **a single video frame of 0.04 s** inside a 2.02 s container.
`ConsumptionReport.fps` is an `Integer`, and `OUTPUT_SECOND` is `frames / fps`: a file whose frames
arrive every three seconds has no rate that turns its frame count into seconds.

Three ways out:

| | Change | Cost |
|:---|:---|:---|
| **taken** | `-r 30` — the rate the composer always *reported* — and `-t` the slideshow length as a ceiling; frames counted and rate read by ffprobe | the file becomes constant-rate. Same timeline (8.97 s vs 9.04 s); the short-voiceover file now holds the first still for the voiceover rather than carrying a one-frame track |
| not taken | add a measured duration to `ConsumptionReport` (Tier-1) | the cleaner contract, across three contexts and a wire format — M2's to decide |
| not taken | report nothing for a variable-rate file | honest, and composition unbilled |

`-t` bounds the work; it is not the bill. `_measure` reports `frames`/`fps` only for a whole-number
rate, and **unmeasured otherwise** — the hold is released rather than billed at a figure the file
does not support, as an undecodable image already is (ADR-062 §5.4). After the change:

```
audio {'frames': 60, 'fps': 30, 'width': 180, 'height': 320, 'images': 3}  billed s = 2.0
none  {'frames': 269, 'fps': 30, 'width': 180, 'height': 320, 'images': 3} billed s = 8.97
```

### 7.3 What the contract still does not cover

Two media types were checked by hand in ADR-062 and one was wrong. The contract now covers images
(Java) and composition (Python). Enumerating the rest found the third — **by reading, not by the
contract**, which is the gap this section exists to name:

| Producer | Unit | Covered | State |
|:---|:---|:---|:---|
| `ImageGeneratorClientImpl` | `IMAGE_STEP` | ✓ dimensions (ADR-062) | `steps` is an assumption, not a measurement — `BILLING_ARCHITECTURE.md` §7 |
| `composer.py` | `OUTPUT_SECOND` | ✓ this ADR | `images` is an input count, unbilled under `OUTPUT_SECOND` |
| `main.py` video generation | `OUTPUT_SECOND` | ✗ | frames counted from the rendered list; `fps` is the value passed to the exporter, never read back from the file |
| **`SpeechSynthesisStrategy`** (TTS) | `KILOCHAR` | ✗ | **reports no measurement at all** — every TTS job settles to nothing and is released (audit #22) |
| **`AudioAnalysisStrategy`** (STT) | `AUDIO_MINUTE` | ✗ | **reports none either** — released (audit #22). `audioSeconds` is also absent from both metrics whitelists (`JobListener`, `telemetry.py`), so only the typed channel could carry it |
| `VisionAnalysisStrategy`, chat | `KILOTOKEN` | ✗ | provider-reported tokens; no fixture where the provider's count and the work disagree |

`BILLING_ARCHITECTURE.md` §7 marks both audio rows ✅. Audio is the next contract case; its fixture is
a synthesized clip whose character count and duration the test reads back.

## 8. Found, not fixed

- **A user's own preferences reach the pipeline as declarations** (audit #23, 🔴). `PUT
  /api/v1/profile/preferences` merges any map; `ContextService` copies it into `Context.preferences`;
  `DynamicPipelineExecutor` puts `userId` and **then** `putAll(preferences)`. A preference named
  `userId` replaces the actor the credit hold is taken on; one named `orazaka.metering.deferred`
  makes `EntitlementInterceptor` take no hold at all. Read end to end in code; not exercised.
- **The credit gate fails open on any billing error** (audit #25). `HttpCreditAuthorizationClient`
  throws `RestClientException` on a non-402 failure; the interceptor catches only the refusal; the
  executor's catch-all logs it and continues — no hold, turn served. Whether that is the intended
  degradation is written nowhere near the gate.
- **Five worker tests never run in the build** (audit #24). `AssetIdResolutionTest` — including the
  owner-containment checks — sits after `if __name__ == "__main__": unittest.main()`. The Maven
  runner executes 58 tests (61 with this ADR's contract, placed before the guard); `python -m
  unittest` discovers five more.
- **The engine logs every prompt and every response at `INFO`** (audit #26):
  `AbstractEngine.chat`. `SafetyInterceptor` logs the matched term *"never the turn"* because a log is
  the least protected place a crisis message can go; the engine logs the whole turn two lines later.
- **The `MediaInterceptor` ghost** (§2.1): an enabled seed row and a default route for a class that
  has never existed; `docs/CORE.md` lists it.
- **An image-only prompt loses its image**: with no words, `MessageCompiler` returns the history and
  attaches nothing. A second marker in one prompt stays in the text as base64.
- **Composition with a short voiceover shows only the stills that fit in it** — a composition
  decision (stretch, loop, refuse), M2's.
- **A guard's refusal on the chat endpoint offers `upgrade_plan`.** `RestErrorResolver` maps every
  non-credit refusal to `403` with that remedy — a scope refusal included, and now
  `subject_not_examinable`. No plan unlocks a pack's declared boundary.

## 9. Last run's controls, still active

| Control | Evidence it still runs and passes |
|:---|:---|
| [CFG-001] | `ConfigBindingRules` in core `GovernanceTest`, the seven service suites and `IdentityServiceGovernanceTest` — full build green |
| [GOV-006] meta-rule | `GovernanceSubjectsTest` in `orazaka-persistence/app` — full build green |
| image divergence contract | `ImageGeneratorClientImplTest` — unchanged, green |
| `spotless:check` on `validate` | unchanged in the root `pom.xml` |

## 10. The pending migration

`infra/migrations/2026-09-14-pack-kind.sql` (ADR-061), reported unapplied by ADR-062 because the
local containers were gone, is **applied**: `orazaka start --only postgres` recreated the database on
the surviving `orazaka_pgvector_data` volume, the column was absent and `studio_run.installation_id`
still `NOT NULL`, and the migration ran clean — 8 packs read `VERTICAL`, `installation_id` is
nullable, and all four constraints (`ck_pack_kind`, `ck_pack_toolkit_not_regulated`,
`ck_pack_toolkit_no_installation_controls`, `ck_run_uninstalled_not_regulated`) exist.
