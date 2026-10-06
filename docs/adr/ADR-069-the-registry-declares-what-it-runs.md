---
title: "ADR-069 — The registry declares what it runs: a capability contract in two halves, two keys that lied, and the UI manifest deleted"
description: "M4. The e2e gate runs for the first time on the run path and finds that the studio service does not start at all. AGENTS.md §6 is rewritten against the code it describes. A capability declares its inputs AND its outputs, so a blueprint step is checkable in both directions and BlueprintFitnessTest stops reading a transcription. Only then do uri_path, http_method, payload_template, icon and label go — and the three consumers M3 said did not exist are dealt with on the way."
category: ADR
order: 69
---

# ADR-069 — The registry declares what it runs

- **Status**: Accepted
- **Date**: 2026-09-22
- **Scope**: `AGENTS.md` §6; `orazaka_capabilities` (`input_schema`, `output_schema`, five columns
  dropped); `CapabilityDeclaration`, `PackCapability`, `CapabilityDescriptor`, `OperationNode`,
  `CapabilityEntity`, `CapabilityManagerImpl`, `CapabilityRegistryService`, `PackInstallerService`,
  `GraphEngine`, `OperationGraphFilter`, `CapabilityEndpointProperties`, `FeatureResponse`;
  `BlueprintFitnessTest`, `ExecutorCoherenceRules`, [CFG-001] `ConfigBindingRules`;
  `pack.schema.json` and the two Tier-C manifests; `test_capability_contract.py`
- **Implements**: M4 of [`UNIFIED_PACK_SURFACE.md`](../UNIFIED_PACK_SURFACE.md) §5
- **Closes**: audit #43, #44
- **Follows**: [ADR-068](ADR-068-one-door.md)

## 0. The prerequisite: the e2e suites ran, and the studio service was not starting

M3 rewrote `JobLifecycleIT` and `AmqpContractIT` onto the run path and nothing executed them. Run
once against a live stack, they failed — four assertions across two suites, all at the same place:
`GET /api/v1/studios/composer` answered **502**.

The cause was mine, from M3. `PackBundleResolver` had two constructors — the injection one and a
package-private seam for tests — and Spring cannot choose from a constructor set it was not told
about. It looked for a no-arg constructor, found none, and the service failed context
initialisation:

```
Error creating bean with name 'packBootstrap' … 'packBundleResolver' …
Failed to instantiate [PackBundleResolver]: No default constructor found
```

**Every `/api/v1/studios/**` request in a real deployment had been answering 502 since M3**, and the
build was green throughout: every unit test builds that class by hand, and no integration test
boots that service's context. M3's §2 claim — "a fresh start ends with the shipped packs
installed" — was proven by an IT calling the bean, not by a service that starts.

The guard is [CFG-001] extended: that rule covered types the configuration **binder** builds, and
this was a bean the **container** builds, which is the same defect with a different injector.
`assertInjectableComponentsHaveOneConstructor` applies the container's own rule — one candidate,
else one `@Autowired`, else a no-arg — and is wired beside CFG-001 in all nine governance suites.
GOV-006 then caught the new rule itself, for judging a population it never proved non-empty; it
goes through `GovernanceSubjects.require` like the others.

### 0.1 The first repair did not work, and the new rule agreed with it

The stack was raised a second time, after all six commits. **The studio service still did not
start, with the same exception**, and the job service did not start either.

The seam had been made a `private` three-argument constructor behind a static factory, on the
reasoning that a private constructor is not an injection point. It is not an injection point, and
that is not the question the container asks.
`AutowiredAnnotationBeanPostProcessor.determineCandidateConstructors` begins at
`beanClass.getDeclaredConstructors()` — **private ones included** — and takes its single-candidate
shortcut only at `rawCandidates.length == 1`. Two declared constructors, none annotated, no no-arg:
the same `NoSuchMethodException: PackBundleResolver.<init>()`, now from a class whose javadoc
asserted it had "exactly one candidate".

The new rule cleared it, because it had been written from the same wrong premise — it counted
**non-private** constructors while the container counts all of them. *A rule that judges a different
population than the thing it protects is not a weak rule; it is a rule about something else.* It is
the same defect as `BlueprintFitnessTest`'s transcribed table one layer up, and this run produced
both.

Corrected to count every declared constructor, it fails on the live code with no plant needed:

```
[CFG-001] a bean the container cannot instantiate is a service that does not start, and no test
that builds it by hand will ever say so:
  PackBundleResolver is a Spring bean with 2 constructors the container cannot choose from
  (none is @Autowired and none is no-arg)
```

The fix is now a **declaration** rather than an arrangement (AGENTS.md §12): `@Autowired` on the
constructor the container must use. The private constructor stays as the shared implementation and
the static factory stays as the test seam, and neither has to be mistaken for anything.

### 0.2 The job service did not start either, and that one was the database

```
[orazaka-job-service] ERROR: column ce1_0.input_schema does not exist
```

The database the stack came up on predated this run's seed, so `input_schema` did not exist. The
migration is what an existing database catches up with, and applying it is also what verifies it.
It was incomplete: see §8, where the claim that the five dropped columns were "inert rather than
wrong" on an older database is disproved by `label NOT NULL`.

**Why the database was stale is not what it first looked like, and the correction matters.** The
`staging` profile is not careless about this: `stop-db-local` runs `docker compose down -v`, which
removes the named volume, so a run that completes leaves nothing behind and the next `up`
re-applies `infra/initdb/*` from scratch. The harness *is* hermetic on the database — **by design,
in `post-integration-test`.**

Which is exactly the phase that does not run when the build fails earlier. So this is not a second
finding; it is the **same** one as the leftover stack (§6.6): one teardown stops the JVMs *and*
drops the volume, and a red run skips both. A failed gate therefore poisons the next attempt twice
over — a stale stack holding the ports, and a stale database the seed no longer describes. Measured
rather than assumed: after a run that reached `post-integration-test`, `studio` was back to 0 rows
and `orazaka_capabilities` carried exactly this run's columns.

**The second finding of the first run** is §5's, and it is why this ADR's order is what it is:
`GET /api/v1/features` answered **500 — `NullPointerException: uriPath must not be null`** for any
deployment with a pack-contributed capability installed, which after M3's bootstrap is every
deployment. The e2e tier-1 contract had been failing on it and nobody had run that either.

### 0.3 Three more, each hiding the next

With both services starting, the suites got further and failed differently every time. The chain,
because each link was invisible until the one before it was cleared:

1. **`orazaka-media` could not install.** `PackInstallerService` PUTs
   `/internal/v1/billing/packs/{key}` during install; **the harness starts eight services and there
   are nine** — `orazaka-billing-service` (:8095) was never in the `staging` profile. Connection
   refused, install rolled back, no media Studios, and the composer row the run path is launched
   from came back **empty**. Added to the profile, before the studio service that provisions into it.
2. **Nothing said why.** `PackInstallerService` wraps the real fault as the *cause* of
   `PackInstallException("Install of bundle … failed and was rolled back")`, and `PackBootstrap`
   logged `failure.getMessage()` — the wrapper's own message, which names no cause. The loop retried
   every 30 s, forever, saying nothing. It logs the throwable now.
3. **Two tier-1 assertions had never executed.** httpyac's grammar is
   `?? [js] <selector> <operator> [value]` with the operator **last**, so the `==` inside a `===`
   is taken for it and `s.inputKind === "TEXT"` reaches the evaluator as `s.inputKind == = "TEXT"`.
   Measured against a throwaway server rather than guessed, because the first rewrite was wrong in a
   more alarming way:

   | shape | httpyac |
   |:---|:---|
   | `s.inputKind === "TEXT"` | `SyntaxError` |
   | `["TEXT","ASSET"].includes(s.inputKind)` | **no assertion at all** — no tick, no cross, the line is absent from the output |
   | `…filter(s => !"TEXT ASSET".includes(s.inputKind)).length == 0` | ✓ |

   The middle row is the one worth keeping: an assertion that does not run and does not say so.
   Both contracts now count the entries that would be wrong and compare that to zero, which puts the
   only `==` where httpyac expects it.

   Fixing them exposed a fourth, in the request immediately after: the run this suite starts was
   addressed as `/api/v1/studios/{{composer.$.[0].studioKey}}/runs`, and `$.[0]` is not valid
   JavaScript. **That request has errored on every run since it was written and never once reached
   the server** — so the tier-1 contract for starting a run has never executed either. A named
   request's parsed body indexes directly, and the filter now says what the heading always claimed.

**What the billing service's absence had been hiding is worse than the pack install.**
`HttpEntitlementProvider` logged *"Entitlement lookup failed for actor=… — allowing through"* on
every single request. The e2e gate had **never once exercised the entitlement check**; it failed
open on every call, because the service that answers it was not running. A gate that cannot reach
the control it is meant to protect reports the same green as one that passes it.

### 0.4 The media TOOLKIT was granted by no plan at all

With all of the above repaired, the suites failed on one assertion: *"No available Studio in the
composer row takes a text input"*. The row was no longer empty and the media Studios were in it —
**locked**. Proven in SQL rather than inferred:

| grant path for `studio.image-generation` to the dev actor | rows |
|:---|---:|
| via an ACTIVE plan subscription (`ultimate`) | **0** |
| via an ACTIVE pack subscription | **0** |
| anyone subscribed to `orazaka-media` at all | **0** |

`orazaka-media` is a **TOOLKIT**, so ADR-061 makes entitlement *be* the installation: there is no
purchase and no `studio_installation` row, and a plan grant is the only way an actor ever holds one
of its keys. No plan granted any of the six. `POST /api/v1/studios/image-generation/runs` answered
**409** through the real edge for an actor on `ultimate`.

**There was no pricing question to settle, and reading it as one was the error.** The intent is
already written in `infra/initdb/70-billing.sql`, three rows above the gap: `free` grants
`capability.image = true` and `capability.audio|video = false`; `premium` and `ultimate` grant all
three. The six rows are a **transcription** of that matrix into the vocabulary
`StudioAccessService` actually reads — each Studio inherits its own capability's value:

| Studio | capability | free | premium | ultimate |
|:---|:---|:---:|:---:|:---:|
| `image-generation` · `image-analysis` | image | ✓ | ✓ | ✓ |
| `speech-synthesis` · `audio-analysis` | audio | ✗ | ✓ | ✓ |
| `video-generation` · `video-analysis` | video | ✗ | ✓ | ✓ |

The two alternatives are both closed by a precedent three rows away. `studio.trade-showcase` is
granted in every plan precisely because `allows()` reads an absent key as a denial and a free
Studio would otherwise lock everyone out (ADR-034 §8.2) — the answer taken then was to **grant the
key**, not to route around entitlement. Exempting a TOOLKIT from entitlement would remove one of
the four controls M3 put in front of every run, which is what door 1 did. And a fixture that
subscribes itself asserts the fixture, the same way a fixture that writes its own rows asserts its
own `INSERT`s (M3 §6).

**`capability.image|video|audio` are superseded on the media path, not dead.** They remain the
plan-level statement, of the same family as `concurrency.jobs` and `model.class`, and they are
still read elsewhere. What they stopped answering — after ADR-066 made media a pack and ADR-061
made a TOOLKIT's installation derived — is *studio access*, which is answered by `studio.<key>`.
These six rows are what makes the two agree. Nothing was removed.

#### The guard, which matters more than the six rows

`SeedBootstrapIT` now asserts that **every Studio of a shipped TOOLKIT is granted by at least one
plan**. Without it the state that arrives silently is "the plan grants five Studios of six" — a
seventh Studio added to the bundle with no row in `70-billing.sql` ships locked for everyone, and
an absent key is indistinguishable from a deliberate refusal. That is the cousin of the defect M1
removed.

It reads the manifests rather than the database, because at that point no pack is installed: the
seed creates the tables and the bootstrap installs bundles at runtime, so the manifest is the
honest left-hand side. It parses them with SnakeYAML and not a regular expression, for the reason
this repository keeps rediscovering. VERTICALs are deliberately out of scope — their grant path is
the pack purchase, so a plan row is optional and requiring one would fail `realestate-studio`,
which is sold.

Seen red with a seventh Studio planted in the media bundle:

```
AssertionError: [orazaka-media/image-upscale is a TOOLKIT Studio and no plan grants
studio.image-upscale — it ships locked for everyone, and a TOOLKIT has no purchase to unlock it]
```

Reverted, green. A population check guards the rule itself: a manifest set with no TOOLKIT asserts
nothing, and says so (GOV-006).

### 0.5 The web arithmetic, closed per file

500 → 489 is `executeFeature.test.ts` (15 tests) deleted with `executeFeature.ts`, and
`startComposerRun.test.ts` (4 tests) added in its place: **500 − 15 + 4 = 489**, 68 suites before
and after. The CLI moved the same way: `media.api.test.ts` (4) out with `media.api.ts`,
`composer.run.test.ts` (6) in — 209 → 211. Nothing stopped being collected.

## 1. §2 — the governance contract described a job plane that had not existed for two phases

The sentence that was noticed — the router as the producer of async jobs — was the least of it.
Checked claim by claim against the code and against `docs/_generated/architecture.json`:

| §6 said | The code says |
|:---|:---|
| Producers: `router` (async jobs, 202 + jobId) | deleted in ADR-068; the conversation service publishes one job key, `job.automation.approved` |
| Producers: `business`/`core` (heavy commands) | neither module has ever touched the broker |
| Consumers **(only)**: worker, `JobEventRelay`, `WorkflowEventConsumer` | **neither class exists**; eight modules consume over nineteen queues; `business` consumes nothing |
| — | the **studio outbox**, the only producer of job work since ADR-068, was absent |
| — | the two **lanes** of ADR-067, `latency_class` and [LANE-001], were absent |
| exchanges `orazaka.jobs` / `orazaka.events` | and `orazaka.dlx`, which `AmqpContractIT` asserts |
| keys `job.{capability}.{action}` | plus a **subject** segment (`job.agent.dispatch.{userId}`, `evt.agent.result.{jobId}`) |
| job events `job.{id}.progress\|done\|error` | true, and they travel on **`orazaka.events`** — which is why the relay queue binds `job.#` there and not on the jobs exchange. Neither half was said |

Fifth text in this repository to assert something false about a control, after
`CreditReservationService`'s javadoc, `studio_run_audit.detail`'s "never user content",
`BlueprintFitnessTest`'s transcribed output table and §7 on the kill-switch — and **the first that
is normative**: every run loads this file first, so a stale §6 is a stale premise for every future
run. Rewritten, with a pointer to the generated model so the next reader checks rather than trusts.

## 2. §3 — two keys that lied, renamed by enumeration

```
orazaka.core.chat.speech  →  orazaka.core.media.speech          AUDIO synthesis, named chat.*
orazaka.core.media.audio  →  orazaka.core.media.audio.analysis  transcription, named like generation
```

Seventeen files had to agree, enumerated before anything was touched: the seed, two blueprints,
six Java test suites, four TypeScript modules, three hand-written docs. Three sets were deliberately
**not** touched — the ADRs, the applied migrations and the workflow briefs are history, and
rewriting history to match the present is how a record stops being one.

Routing keys are unchanged: `job.text.process` still carries speech, deliberately, because both
keys are drained by the same process and the only difference is which queue a two-second request
waits in. The seed's own note said so and still does.

**The enumeration found two more keys that lie, and these name nothing at all**: the CLI's flag
table bound `--text` to `orazaka.core.chat.text` and `--gen-image` to `orazaka.core.chat.image`,
neither of which has ever existed in the registry. Both flags failed with "not found in Operation
Graph" rather than running. Corrected here, because that is what an enumeration is for.

Both changed blueprints ship at **1.2.0**: a changed published blueprint is a new version.

## 3. §4 — the registry declares inputs *and* outputs

A blueprint chains its steps with `{{steps.<out>.<field>}}`, and nothing declared what a capability
produces. Every link in every DAG referenced a field no contract mentioned, no rule could check,
and the one attempt to check it — `BlueprintFitnessTest`'s `PUBLISHED_FIELDS` map — carried the
javadoc *"duplicated from the executors on purpose — that is what a fitness function is"*. It is
not: a fitness function compares two things the system already says, and there was only ever one.
So the copy rotted, and said audio analysis publishes `url` when its executor publishes `analysis`.

The contract is two `jsonb` columns now:

- **`input_schema`** — what a caller may pass: types, `required`, defaults, and the
  `format: prose | asset-id` M3 introduced for fillability. This is what `payload_template` carried
  as an untyped string of `${placeholders}`.
- **`output_schema`** — the fields a successful execution publishes, with types.

Declared where everything else about a capability is declared — the seed for the platform's eight,
`requires.capabilities[]` for a pack's — and written by the installer beside `routingKey`,
`billableUnit` and `latencyClass`. **Manifest declares, installer writes, platform reads**; no
fourth mechanism. Both default to `{}`, which is the fail-closed direction: an undeclared contract
matches nothing, so a step over it fails the build rather than dispatching against a promise nobody
made.

### 3.1 What the rule caught the moment it read data

`BlueprintFitnessTest` now checks a step in both directions — its inputs against `input_schema`,
its `{{steps.x.field}}` references against the referenced step's `output_schema` — and immediately
failed on **four declarations, all mine**, because I had transcribed them the same way the old map
had:

| capability | I declared | the worker publishes |
|:---|:---|:---|
| `orazaka.echo.text.reverse` | `content` | `text`, `metrics` |
| `orazaka.validation.document.screen` | `screened` | ten flattened fields, including `screenedJson` and `judgmentPrompt` |
| `orazaka.validation.document.signals` | `signals` | `report`, `reportText`, `signalCount`, `actionableCount` |
| `orazaka.validation.document.assemble` | `report` | `report`, `reportJson` |

Each was corrected by reading the worker that produces it. That is the whole argument for declared
data over a transcription, demonstrated on the first run of the rule that reads it.

It also caught my own seed edit: the enabled-capability reader in `BlueprintFitnessTest` and the row
reader in `ExecutorCoherenceRules` were **positional**, and both said *"parsed no capability rows —
the rule would assert nothing"* rather than passing. Both are anchored on values that have a shape
now (a handler key, a routing key), not on a column position.

Seen red with a planted reference:

```
image-generation: {{steps.image.thumbnailUrl}} — that step publishes [url, format]
```

## 4. §5 — the columns dropped, and the three consumers M3 said were gone

M3's report said the five UI-manifest columns had no consumer left. That was an overstatement, and
the honest count is **three**:

1. **`BlueprintFitnessTest`** read `payload_template` (the M2 rule carrying its defaults into
   schemas). §4 replaced what it guarded; the rule is deleted with the column rather than left
   passing over an empty population.
2. **`FeatureResponse`** read all five and *required* three non-null — the live 500 of §0.
3. **`GraphEngine` → `OperationGraphFilter`** read `uri_path` and `http_method` to decide whether a
   request was for a capability whose engine is offline. A **live security-adjacent control**,
   matching against paths that door 1 had deleted — dead for every capability but one.

`uri_path`, `http_method`, `payload_template`, `icon` and `label` are gone from the table, and with
them the endpoint rule that was written **four times** (the record, `PackCapability`, the JPA
`@PrePersist`, and the table's CHECK). An invariant with no field to guard is not kept in case.

**That one capability is why the filter still exists.** `orazaka.core.chat.completion` is genuinely
synchronous and stays off the broker (AGENTS.md §6), so this service really does serve it over
HTTP. The pairing of a path with the capability behind it now lives in the **service that owns the
endpoint** — `orazaka.router.capability-endpoints`, typed and read as a map rather than branched on
— instead of in a registry shared by every context. Same control, expressed where the path is known.

The operation graph shrinks with it: a node is an identity, a presentation context and a state. Its
label, icon and `TargetExecutionUri` came from those columns; a display name belongs to the pack
that ships the Studio (ADR-068 §3), and the endpoints it advertised are deleted. `GET
/api/v1/features` answers the one question left — which capabilities exist and which can run right
now — and stops 500ing.

### 4.1 What `is_enabled` now means

It survived, and what it meant changed under it. Before M3 a disabled row also removed a button from
the chat composer, so the flag conflated *"the platform will not run this"* with *"do not offer
this"*. The composer's row comes from Studios and an actor's access comes from entitlement, so
exactly one meaning is left: **a disabled capability is not dispatched** — `GraphEngine` renders it
Invisible, a blueprint step naming it fails [ADR-034 §15.2], and nothing routes its work. The
prober's degraded-mode state is reported separately and is never written here, which is the
difference between "cannot run right now" and "will not be run".

## 5. §6 — `#43`: the declaration was the defect, not the executor

`compose` declared seven inputs and implemented two. **I fixed the declaration**, and the reason is
not thrift: `captions`, `brandKit`, `clip`, `bRoll` and `aspect` were never implemented anywhere,
and implementing video compositing features is product work that a registry run has no business
inventing. The honest contract is what the worker does — `photos` and `audio` — and the missing
features are recorded below as a product gap rather than left as a promise a blueprint author will
believe. `realestate-reels` already stopped passing `bRoll` in M2, so nothing regressed.

The check is a **contract test in the worker** (`test_capability_contract.py`), because the
declaration is a row in Postgres and the executor is Python in another process: no static rule in
the Java build can see both, and one that tried would read the Python by regex from a module that
does not import it. What can see both is the worker — it knows which routing keys it drains and can
read the same seed the platform does. Same judgement as the metering-quantity rule and the billing
divergence contracts.

Two things it found about itself, both worth writing down:

- its first version listed the wrong modules for the video path and reported `durationSeconds` and
  `image` unread — **the test being wrong, not the worker**, which is the transcription problem one
  level up;
- its first matcher looked for the input name anywhere in the source, so a docstring saying
  *"captions are not implemented"* counted as an implementation and the planted declaration
  **passed**. Anchored on real payload access now. Seen red:

```
orazaka.studio.media.compose declares ['captions'], and the code that serves job.compose.assemble
never reads them.
```

The suite is wired into the build, because `test_main.py` already asserts that every Python suite in
the repository has a runner — a test nobody runs is no test, and that rule said so.

## 6. Found during M4 — for M5's report

1. 🔴 **There is no GraphQL server anywhere in this repository.** No dependency, no schema, no
   `@QueryMapping`, no route — and the CLI's `ApiClient.requestGql` posts to `<base>/graphql` for
   the operation graph, the interception schema and part of auth. `orazaka chat` and `orazaka graph`
   therefore cannot work at all. AGENTS.md §2 still names GraphQL as a transport the router
   translates. Not fixed here: restoring a transport is a feature, not a registry run.
2. 🟡 **The e2e harness reports three false alarms every run**: `waitAfterLaunch=5` is shorter than a
   Spring Boot start, so three services log "Process was not healthy even after 5 seconds" and then
   come up anyway, recovered by the antrun health poll. Noise that makes a real start-up failure
   hard to see — which is precisely what happened while diagnosing §0.
3. 🟡 **`compose` still has no captions, brand overlay, b-roll or aspect control.** The declaration
   no longer claims them (§6); the product gap is real and is now visible rather than promised.
4. 🟡 **`MediaApi.searchRag` in the web client has no caller** (carried over from M3's report).
5. 🟡 **An unused `eslint-disable` in the web BFF catch-all** (carried over).
6. 🔴 **The e2e harness never tears its stack down when the build fails.** `post-integration-test`
   does not run on a failed `verify`, so the first run's eight JVMs were still listening the next
   morning. The second run then waited **21 minutes** on a `/actuator/health` that answered `500`
   from a stale process, which reads exactly like a slow start. A gate whose failure poisons the
   next attempt costs more than the failure it reported.
7. 🟡 **Nothing in the repository applies `infra/migrations/*.sql`** — they are hand-run. The
   e2e harness does not need them (its `down -v` makes every run start from `infra/initdb/*`), but
   a developer's own database does, and no command carries them. *An earlier draft of this ADR
   claimed the harness was not hermetic on the database; that was wrong — see §0.2. It is
   hermetic, in the teardown that finding 6 shows does not always run.*
8. 🟡 **Three services log a health failure and start anyway** — `waitAfterLaunch` is 3–5 s against
   a Spring Boot start, recovered by the antrun poll. Same as finding 2, now measured: it is
   `conversation` (5 s), `identity` (3 s) and `job` (5 s), and `studio` makes a fourth when it is
   actually broken — which is how a real failure hid among three false ones for two runs.
9. 🟡 **The e2e gate never exercised entitlement** until this run: with `orazaka-billing-service`
    absent from the harness, `HttpEntitlementProvider` failed open on every request and said so in
    the log nobody read.
10. 🟡 **`PackBootstrap` retried forever without naming a cause** — fixed here, but the shape is
    general: wrapping a fault and logging only `getMessage()` discards exactly the part worth having.
11. 🔴 **httpyac can drop a `?? js` assertion without reporting anything** (§0.3). A strict equality
    is corrupted into a `SyntaxError`; an expression opening with `[` produces **no assertion and no
    error**. Either way the contract is not enforced, and in the second case nothing in the output
    says so. Nothing in this repository guards the dialect — a tier-1 contract can be written,
    reviewed, merged and never once evaluated.

## 7. Open findings, relisted in full

**Closed by this run**: #43 (an executor implementing two of seven declared inputs), #44 (two
capability keys that lied), and the media TOOLKIT grant gap found by the gate (§0.4), with a
`SeedBootstrapIT` guard so the next TOOLKIT Studio cannot arrive ungranted.

**Still open, none closed in passing**: #19 (the M2M JWT — a deployment blocker), #29 (`pypdf`
undeclared), #33 (a protected job that never reaches terminal is never purged), #34 (a timed-out
execution is not cancelled), #36 (dead-letter queues nothing consumes), #37 (worker-routed Studio
steps have no job row), #38 (STANDARD jobs have no window in the job plane), #39
(`purgeJobsByUserId` leaves directories), #40 (`studio_outbox` never purged), #41 (`dataClassOf`
reads an unknown studio as STANDARD), #42 (automation connector jobs carry no data class), #47 (two
automation notification listeners cannot fail today, so their dedup claim is safe by accident),
plus the eleven recorded in §6.

## 8. Migrations

`infra/migrations/2026-09-22-capability-contract.sql` — the two contract columns, the two renames,
and the eight platform contracts. A pack's capabilities are not updated there: the installer writes
them from the manifest at the next bootstrap, which is the only place that declaration lives.

**The first version of this file did not drop the five columns, and that was wrong.** The reasoning
was that nothing is deployed, the seed is authoritative for a fresh database, and an older local
database would keep "five columns nothing reads — inert rather than wrong". `label` and `icon` are
`NOT NULL` with no default, and the entity stopped mapping them, so on any existing database the
next capability `INSERT` the pack installer attempts fails outright:

```
ERROR:  null value in column "label" of relation "orazaka_capabilities"
        violates not-null constraint
```

A column the code no longer writes and the schema still requires is not inert; it is a bootstrap
that cannot run. "The seed is authoritative for a fresh database" was true and beside the point —
the machine this project runs on does not have a fresh database, and neither does the e2e harness,
which raises the stack with `docker compose up` over a surviving volume. The drops and the endpoint
`CHECK` are in the migration now, and it was applied locally before the gate passed.
