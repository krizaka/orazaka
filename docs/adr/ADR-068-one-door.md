---
title: "ADR-068 — One door: the shipped packs install themselves, the composer's buttons launch runs, and direct capability invocation is deleted"
description: "M3, the irreversible phase. A shipped pack gains a bootstrap path, so a fresh environment ends up with the Studios it ships instead of the files alone. The chat composer keeps its button row and each button becomes a single-step run. MediaGenerationController, MediaAnalysisController's generation paths, POST /api/v1/jobs, useBootstrapFeatures and executeFeature are deleted: from here there is one way to invoke a capability, and it carries the controls."
category: ADR
order: 68
---

# ADR-068 — One door

- **Status**: Accepted
- **Date**: 2026-09-17
- **Scope**: `PackBootstrap`, `PackBundleResolver`, `PackSourceProperties`, `PackInstallRepository`;
  `orazaka-packs/*/pack.yaml`; [PACK-001] `PackCoherenceRules`; `ComposerStudioService`,
  `ComposerStudio`, `StudioController`; the three media analysis blueprints; `startComposerRun`,
  `useComposerStudios`, `useComposerRunReconciler`, `ContextPlusMenu`, `CapabilityOptions`,
  `ChatInputBar`, `useChatActions`; `composer.run.ts`, `chat.handlers.ts`, `video.command.ts`;
  `MediaGenerationController`, `MediaAnalysisController`, `JobController`, `MediaJobService`,
  `JobSubmissionService`; `DoorOneClosedTest`, `DoorOneControlsIT`
- **Implements**: M3 of [`UNIFIED_PACK_SURFACE.md`](../UNIFIED_PACK_SURFACE.md) §2, §3, §5
- **Closes**: audit #45
- **Follows**: [ADR-067](ADR-067-the-run-path-becomes-load-bearing.md)

## 1. §2 — a pack that only exists in the repository is not installed

`orazaka-media` was written in M2 (ADR-066) and present in no database. Closing door 1 over that
state would not have moved media generation onto the run path; it would have **deleted it**. So this
is step zero — and the fix is not "run the install command".

**The finding behind `#45` is that a shipped pack has no bootstrap path at all.** A fresh clone
receives the bundle files and an empty catalogue, and the only path between the two was an operator
remembering to type `orazaka pack install orazaka-packs --all`. That is the shape `infra/initdb` had
before M2 gave it a test: content the platform ships, applied by nobody.

### 1.1 The bootstrap runs in the service, not in the CLI

`PackBootstrap` installs, at start-up, every bundle the deployment's sources offer that the
catalogue does not already carry. In process rather than over this service's own HTTP surface, for
the reason `WorkerSelfRegistration` gives on the job service: calling itself through the loopback to
write its own table would be ceremony, and it would make start-up depend on the web layer and on a
token the service would have to mint for itself. `POST /studios/packs/bundles` is unchanged — it is
how an operator installs a bundle that is **not** shipped here.

Where packs come from is the declaration that already existed: `ORAZAKA_PACKS_SOURCES` (ADR-049),
which the CLI reads for `orazaka pack list`. `PackSourceProperties` binds the same key, so an
operator who adds a source sees it in both places. **An empty list is the off switch** — a
deployment that lists no source bootstraps nothing, and no second key was added to say "but do not
actually look there", because two declarations that can disagree eventually do.

`PackBundleResolver` reads a bundle directory into the value the installer applies. It is not a
second manifest parser: it resolves the two kinds of reference a manifest holds — a blueprint file
per Studio, a directory of locale files — and hands the result to the same Jackson binding
`PackBundleController` already uses for the same record, so every invariant stays in `PackBundle`'s
compact constructor. The YAML loader is SnakeYAML's `SafeConstructor`, because a pack is third-party
content and a manifest must never name a Java type for the platform to instantiate.

### 1.2 What it does not do, and why

**It does not re-apply.** `PackInstallRepository.apply` is an upsert, so a bootstrap that simply
applied everything at every start would work — and would silently undo an admin's catalogue edit at
the next restart. The catalogue is data an admin may change without a deploy (ADR-034); a bootstrap
exists to make a **fresh** environment whole. `isApplied(bundle)` asks the question that decides it,
judged on the Studios rather than on the pack row — two shipped bundles are catalogued under no pack
at all, so a `pack` lookup would report them missing forever. A bundle counts as carried when every
Studio it ships exists at the blueprint version it ships, which also means a version bump in a
shipped manifest installs itself.

**It does not retry a manifest fault.** An install that fails because the job service or billing is
still starting is transient and the next tick retries it; a manifest that cannot be read is not, so
it is reported once and skipped. Neither stops the service: a studio service that refused to start
because one pack directory was malformed would take the whole catalogue down for it.

**It stops.** Once a pass finds nothing missing, the schedule is done. This is a bootstrap, not a
file watcher — a bundle added to a running platform is an operator's install, and re-reading every
source forever to notice one would be a poll dressed as a guarantee.

### 1.3 The defect the first run from empty found

Writing the test from an empty database is what exposed the second half of `#45`: **three of the
five catalogued bundles could not be installed into an empty catalogue at all.**
`document-validation`, `echo-toolkit` and `orazaka-media` each declare `categoryKey: business` and
no `catalog.category`. Nothing seeds `pack_category`; the shelf is opened by whichever bundle
declares it. `realestate-studio` and `outbound-prospection` do, and they sort **after** the three
that do not — so on a fresh database the `pack` insert hit a foreign key that pointed at nothing,
the install compensated, and the pack that closing door 1 depends on was the first to fail.

This was invisible for as long as nobody installed into an empty database, which is precisely what
`#45` says. The fix is data, in the direction AGENTS.md §12 requires: **a bundle that stands on a
shelf declares the shelf**, and the upsert is `DO NOTHING`, so the first pack on a shelf names it
and the fourth does not rename it. [PACK-001] now fails the build for a catalogued manifest that
does not, which is the rule that keeps a fresh install working when nobody is looking:

```
[PACK-001] Pack catalogue incoherent:
  document-validation/pack.yaml is catalogued and does not declare the shelf it stands on: …
  echo-toolkit/pack.yaml is catalogued and does not declare the shelf it stands on: …
  orazaka-media/pack.yaml is catalogued and does not declare the shelf it stands on: …
```

### 1.4 The proof

`PackBootstrapIT` runs `80-studio.sql` and nothing else — schema and runtime config, no pack and no
Studio — asserts that emptiness, runs the bootstrap once, and then asserts that every bundle the
sources offer is applied, that the studio count equals the number of Studios the bundles ship, and
that the media toolkit's six Studios are PUBLISHED with the blueprint each one runs. A second
bootstrap over an admin's edited row leaves it alone and provisions nothing again.

The emptiness is measured once, before the first start, rather than restored between tests: a
PUBLISHED blueprint is append-only (`trg_studio_blueprint_immutable`), so there is no way back to an
empty catalogue and no test here pretends there is.

Seen failing: with `PackBootstrap.install()` neutered, all three redden —
`[document-validation is shipped here and must be installed] Expecting value to be true but was
false`, and the six media Studios come back as `[]`.

## 2. §3 — the button row, served from Studios

`/api/v1/features` returned `orazaka_capabilities` rows carrying a label, an icon, a `uri_path`, an
`http_method` and a `payload_template`: a second catalogue, with a second notion of what the
platform can do, reachable without a run and therefore without a single one of the controls a run
carries. `GET /api/v1/studios/composer` replaces it, and returns Studios.

### 2.1 Which Studios belong in a chat composer

Not all of them: a six-step prospection Studio has a form, an estimate and a review step, and
belongs on its page. The question is answered by a predicate over **structure**, never over
spelling — `key.contains("image")` is the defect phase A removed:

> a Studio the actor can run **in one step**, whose input schema asks for **exactly one thing**, and
> that thing is a string the composer is holding.

Everything else the schema declares is optional, which is the same sentence from the other side: the
run is complete without it. That distinction matters and the shipped blueprints prove it — `size` is
defaulted, `model` is not, and `model` is resolved by the capability's own catalogue when absent. A
predicate that demanded a default on every property would have removed the image button; one that
asked only "is it required" keeps it.

**Why a predicate and not a declared flag.** A flag drifts in both directions: a pack author who
forgets it loses a button silently, and one who sets it on a four-step Studio gets a button that
opens a form. The structure cannot drift, because it *is* the thing being asked about — a Studio
that grows a second step or a second required input stops being launchable from a chat bar at the
moment it grows it, and the row recomputes. *Declared, not inferred* exists for facts that cannot be
derived correctly; this one can.

### 2.2 The one fact that is declared, and why it has to be

The predicate decides **membership**. It cannot decide **what the composer puts in the input**,
because the composer holds two things — what the user typed and what they attached — and the six
shipped Studios split evenly between them: three take a prompt, three take an `assetId`. An opaque
asset id and a sentence are both `"type": "string"` and no amount of shape separates them; deriving
it from the key's name would be `contains("asset")`, which is the heuristic this run exists to
delete.

So the pack declares it, in the schema it already writes, with JSON Schema's own keyword:
`"format": "asset-id"`. A schema that declares nothing reads as text, which is what a composer holds
by default. The three analysis blueprints ship at **1.1.0** with that line — a changed published
blueprint is a new version (ADR-034 §5), not an edit.

### 2.3 What this removes

The label and the icon now come from `studio` and `studio_i18n` — the pack's own translations,
which is where a pack author already writes them. **That was the last consumer of the UI-manifest
columns on `orazaka_capabilities`**: with `uri_path`, `http_method` and `payload_template` leaving
with door 1 in §5, `icon` and `label` leave with this. It is what makes M4 a **deletion** of those
five columns rather than a migration of them.

A locked Studio is returned locked rather than dropped, exactly as the capability row's
`available` / `lockedReason` pair was: hiding a capability somebody has not bought turns a purchase
decision into a mystery.

### 2.4 The proof

`ComposerStudioServiceTest` states every case as a **shape** — one step and one required string
belongs; a second required input does not; a second step does not; a non-string input does not; a
locked Studio is present and greyed; a declared `asset-id` format is an attachment. Seen failing:
with the step count dropped from the predicate and the format replaced by
`studioKey().contains("image")`, the multi-step case returns a button and the analysis input comes
back `TEXT`.

`MediaToolkitRunIT` asserts the same thing against the blueprints that ship: the six media Studios
are **exactly** the composer row, each named from the pack's i18n, the three generation ones filling
a `TEXT` input (`prompt`, `prompt`, `text` — the schema's key, not a convention) and the three
analysis ones an `ASSET`.

## 3. §4 — the composer launches a run

`executeFeatureWithPrompt` compiled the `payloadTemplate` the server had handed it and POSTed to
the `uriPath` the server had handed it. The browser decided what to call and with what body, which
is what made door 1 a governance bypass rather than merely a second endpoint. It is replaced by
`startComposerRun`, which names a Studio and hands over inputs: `POST /api/v1/studios/{studioKey}/runs`.

The inputs are assembled from what the composer holds and what the Studio **declared** it wants —
the required input takes the attachment or the prose per `inputKind`, `promptKey` says where prose
goes when the required input is an attachment (so "what's in this image?" survives), and an optional
value is sent only when the user set one, because an empty string is a value to a JSON Schema and
not a request for a default.

### 3.1 Run states, and what the composer renders

A job had two outcomes. A run has `PENDING_APPROVAL`, `RUNNING`, `AWAITING_INPUT`, `SUCCEEDED`,
`FAILED`, `CANCELLED` and `COMPENSATING`. The placeholder bubble follows the run rather than a job —
`kind: "run-pending"` carrying a `runId` — and resolves as follows: `SUCCEEDED` becomes the first
artefact, rendered by the **type the blueprint declared** (no more sniffing `.mp4` off a URL);
`FAILED` and `CANCELLED` become the run's own error; anything else keeps the generating indicator.

**`AWAITING_INPUT` is answered rather than left unhandled.** A single-step media Studio has no
`APPROVAL` step and cannot reach it. If a Studio in this row ever does, the bubble says *"this run is
waiting for you"* and keeps its link to `/studios/runs/{runId}`, where the approval affordance
already exists — the composer has one input and no way to ask a second question, so it hands the run
to the screen that can. The CLI does the same thing in one line: it stops polling and prints the run
to open. An unhandled state that silently spins is the failure this decision exists to prevent.

### 3.2 Latency, stated so it is not re-opened

The saga costs **p95 19.2 ms** (M2.5 re-measurement) and the outbox relay adds **up to 500 ms** of
poll before the step's message is published. Against an image at **p50 67 s** that is under 1% — the
question is closed.

**The relay wait is per dispatch, not per run.** One step pays it once; a ten-step blueprint pays it
ten times, up to 2.5 s spread across a run that is minutes long. If it ever becomes a subject, the
remedy is **notify-on-append** — the relay woken by the insert rather than by the clock — and never
a shorter poll: halving the interval doubles the empty queries and leaves the worst case exactly
where it was.

### 3.3 The callers, enumerated rather than assumed

`grep` for `/api/v1/media/**`, `/api/v1/features` and `POST /api/v1/jobs` across source, tests, docs,
CLI, e2e and the mobile client. What each became:

| Caller | Was | Is |
|:---|:---|:---|
| `useBootstrapFeatures` (web) | polled `/api/v1/features` | **deleted** → `useComposerStudios` reads `/api/v1/studios/composer` |
| `executeFeature.ts` (web) | POST to the row's `uriPath` | **deleted** → `startComposerRun` posts a run |
| `useMediaJobReconciler` (web) | followed a jobId on the job stream | **deleted** → `useComposerRunReconciler` follows the run |
| `ContextPlusMenu` (web) | grouped on `uriPath.includes("/media/analyze")` | groups on the declared `inputKind` |
| `CapabilityOptions` (web) | `uriPath.includes(...)` for the attach affordance | the declared `inputKind` |
| `ChatInputBar` / `ChatWindow` (web) | `BootstrapFeature` props | `ComposerStudio` props |
| `MediaApi` (CLI) | five POSTs to `/api/v1/media/**` | **deleted** → `composer.run.ts` starts runs |
| `chat.handlers.ts` (CLI) | `--image`, `--speech`, `--vision`, `--audio` | the same flags, each a run |
| `video.command.ts` (CLI) | `POST /api/v1/media/generation/video` + job poll | a run of the video Studio |
| `MediaApi.uploadMedia` (web) / `ApiClient.uploadFile` (CLI) | `/api/v1/media/upload` | **unchanged** — uploading an asset is not a capability invocation |
| `MediaApi.searchRag` (web) | `GET /api/v1/media/search` | **unchanged** (a read, not an invocation) — and it has no caller, recorded as a finding |
| `MediaApi.analyzeVideo` (web) | `POST /api/v1/media/analyze/video` | **had no caller at all**; deleted with door 1 |
| `orazaka-mobile-client` | `JobsScreen` **reads** `/api/v1/jobs` | unchanged: it lists jobs, it never submitted one |
| e2e `media-generation.http` / `media-analysis.http` | contracts for the deleted endpoints | rewritten against the run API (§5) |
| `orazaka_capabilities` seeds, `CapabilityEntityTest`, `CapabilityDescriptorTest`, docs | carry `uri_path` values | **left alone** — those columns are M4's deletion |

The mobile client is the caller that would have been assumed: it appears in a `grep` for
`/api/v1/jobs` and turns out to only read the job list, which is not door 1 and is not touched.

## 4. §5 — door 1 is deleted

Seven endpoints, and the two services behind them:

| Deleted | Why it was door 1 |
|:---|:---|
| `POST /api/v1/media/generation/{image,speech,video}` | a capability invoked with no run: nothing metered it, nothing kept it, nothing recorded it |
| `POST /api/v1/media/analyze/{image,audio,video}` | the same, on the analysis half |
| `POST /api/v1/jobs` | the rawest of them — a feature key and an opaque payload map, straight to the queue |
| `MediaJobService`, `JobSubmissionService` | the delegates; leaving them would have left door 1 one `@PostMapping` away |
| `useBootstrapFeatures`, `executeFeature`, `useMediaJobReconciler`, `MediaApi` (CLI) | the client half of the same path |

**What stayed, and why it is not a door.** `POST /api/v1/media/upload` stores bytes the caller
already has, seals them (ADR-054) and returns an id the run path resolves against the actor who owns
it. `GET /api/v1/media/search` reads an index. Neither dispatches work, neither takes credits.
`GET /api/v1/features` also stays: it is a read of the capability registry that the admin console
uses, and the columns behind it are M4's deletion, not this run's.

**`POST /api/v1/jobs` was deleted rather than restricted to `SERVICE`.** The brief allowed a
service-only variant if a caller needed it; none did. The run path publishes step commands through
the studio outbox (ADR-067), and the two end-to-end suites that used the endpoint now start runs. A
`SERVICE`-only door is a door with a narrower doorway and the same absence of controls behind it.

**`JobQueuePublisherService` stays, and the compiler is why that reason is exact.** Deleting it —
on the assumption that nothing published jobs any more — failed on `JobController.approveJob`, which
releases a job a human has just approved. The job already exists, its payload was written when the
automation ran, and approval is the gate in front of it rather than a way in. That is the one
surviving `publish` call, and the rule in §5.1 names it as the exception it is.

## 5. §6 — the proof

### 5.1 `DoorOneClosedTest` — the half the plant exposed

`DoorOneControlsIT` asserts what the run path produces. It asserts nothing about what else might
exist — **restore `MediaGenerationController` and every one of its assertions still passes**, because
a second door cut beside the run path does not disturb the run path. The §6.4 plant is what showed
that, which is the point of planting rather than reasoning: the proof as first written would have
reported green over a restored door.

So the surface is asserted too. No class in this service's `adapter.rest` may reach
`JobService.createJob` or `JobQueuePublisherService.publish`, and no application service but the
publisher itself may reach `publish`. Seen failing with the planted controller restored:

```
Architecture Violation … 'no classes that reside in a package
'com.orazaka.conversationservice.infrastructure.adapter.rest..' should call method
JobService.createJob(String, String, Map, DataClass) … or should call method
JobQueuePublisherService.publish(JobCommand)' was violated (2 times):
Method <…PlantedMediaGenerationController.generate(java.util.Map)> calls method
<…JobQueuePublisherService.publish(…)> in (PlantedMediaGenerationController.java:32)
Method <…PlantedMediaGenerationController.generate(java.util.Map)> calls method
<…JobService.createJob(…)> in (PlantedMediaGenerationController.java:31)
```

This is the surface of **one service**. The repository-wide rule — no capability reachable other
than through a run, in any service — is M5's, and belongs in `orazaka-test-support` beside the other
governance rules.

### 5.2 `DoorOneControlsIT` — the controls, one at a time

The catalogue is installed by the bootstrap from the bundles on disk, so the controls are derived
from the packs rather than written by the fixture. Four tests:

1. **A capability invocation produces a run.** One run row, one step, one dispatch — and the job id
   exists exactly once on this plane, as a column of the step that minted it. The broker half (the
   command carrying the same id, addressed to the same run, written in the dispatch's own
   transaction) is `StepDispatchDurabilityIT`'s, because the executor here is a recorded stub so
   that a failure in this suite is unambiguously the engine or the pack.
2. **A STANDARD media run** carries the class its pack declares and settles **exactly once**.
3. **A SENSITIVE run receives all four controls**, asserted individually against the
   `document-validation` pack: the data class is `SENSITIVE` because the pack says so (door 1
   declared `STANDARD` for everything, having no pack to read); the append-only trail has a
   `RUN_STARTED` row, written for a protected class and for no other; the scope guard resolves with
   its refused terms and its refusal; and the run is purged at 45 days — past the SENSITIVE window
   of 30 and inside the standard 90 — with the trail outliving the row it describes.
4. **The six media capabilities are the composer's row**, and the SENSITIVE document Studio is not.

### 5.3 The grep, and what it returns

No caller of `/api/v1/media/generation/**` remains anywhere — source, tests, docs, CLI, e2e. What a
grep still finds, and why each is not a caller: one explanatory comment in `video.command.ts` saying
what the run replaced; three persistence tests that set and read the `uri_path` **column** of a
capability entity (the column M4 deletes); the seeds and the historical ADR-028 that carry the same
column values. Nothing constructs a request.

### 5.4 The case the SENSITIVE pack made against the predicate

Writing §6.3 is what found it. `document-authenticity` is one step over one required string —
`documentBase64` — so it passed the structural predicate of §3 exactly, and a chat bar cannot fill
it: there is nothing a user types that is a base64 identity document. The predicate would have put a
button on the composer that corrupts every run started from it.

An asset id, a sentence and a base64 payload are the same JSON type, so **the input declares which
it is**: `format: prose` for what a user types, `asset-id` for what they attach, and an input that
declares neither is not filled. Membership stays structural — one step, one required input — and
*fillability* is declared, which is the direction AGENTS.md §12's corollary requires: a pack author
outside this repository cannot be asked to remember, so silence costs a button rather than
corrupting a run. The three generation blueprints ship at **1.1.0** with the declaration.

## 6. Found during M3 — for M4's report

1. 🟡 **The five UI-manifest columns now have no consumer at all.** `icon` and `label` left with §3,
   `uri_path`, `http_method` and `payload_template` left with §5. Until M4 drops them they are data
   nobody reads, which is how `billable_unit` sat NULL for four capabilities.
2. 🟡 **`MediaApi.searchRag` in the web client has no caller.** Its endpoint survives (a read of an
   index), the export does not: nothing in the tree calls it but its own test. Not deleted here —
   no repairs in passing.
3. 🟡 **AGENTS.md §6 still names the router as an async-job producer.** After this run the only
   producer of `job.*` is the studio outbox, plus `JobQueuePublisherService.publishApproval`
   releasing an automation job a human approved. The contract describes a topology that is one run
   out of date.
4. 🟡 **The web BFF catch-all carries an unused `eslint-disable`** (`src/app/api/v1/[...path]/route.ts`),
   which ESLint reports as a warning. Pre-existing; surfaced because this run runs the linter.

## 7. Open findings, relisted in full

**Closed by this run**: #45 (`orazaka-media` written and installed nowhere) — and the second half of
it nobody had seen: three catalogued bundles that could not be installed into an empty catalogue.

**Still open, none closed in passing**: #19 (the M2M JWT — a deployment blocker), #29 (`pypdf`
undeclared), #33 (a protected job that never reaches terminal is never purged), #34 (a timed-out
execution is not cancelled), #36 (dead-letter queues nothing consumes), #37 (worker-routed Studio
steps have no job row), #38 (STANDARD jobs have no window in the job plane), #39
(`purgeJobsByUserId` leaves directories), #40 (`studio_outbox` never purged, one row per dispatch
now), #41 (`dataClassOf` reads an unknown studio as STANDARD), #42 (automation connector jobs carry
no data class), #43 (compose implements two of its seven declared inputs), #44 (two capability names
that lie — M4), #47 (two automation notification listeners cannot fail today, so their dedup claim
is safe by accident), plus the four recorded in §6.

## 8. Migrations

**None.** Everything this run changed on the data side is applied by the installer: the three
manifests that now declare their shelf, and the six blueprints at 1.1.0. A database that already
carries the bundles receives the new versions at the next start, because `isApplied` judges on the
version each Studio ships (§1.2); one that carries nothing receives all of it. No DDL changed.
