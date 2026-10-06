---
title: "ADR-062 — The inert controls, closed: a switch that refuses, a rule on the binder, rules that must examine something, and a bill that follows the work"
description: "M1.5. The orchestration kill-switch bound and made to refuse rather than bypass; [CFG-001] anchored on what the two binding defects share; [GOV-006] against rules that judge the empty set, which turned eleven invocations red; IMAGE_STEP's two causes fixed apart; and [BILL-002], whose honest form is a divergence contract rather than a scan."
category: ADR
order: 62
---

# ADR-062 — The inert controls, closed

- **Status**: Accepted
- **Date**: 2026-09-14
- **Scope**: `CoreProperties`, `CoreConfiguration`, `DynamicPipelineExecutor`, `EnginePipelineBridge`,
  `ImageGeneratorClientImpl`; `orazaka-test-support` (`ConfigBindingRules`, `GovernanceSubjects`,
  every scanning rule); the governance suites
- **Follows**: the [M0.5 inventory](../measurements/inert-controls-inventory.md), which found these

## 1. Four items

The inventory was asked for findings and delivered them. This run closes four, and records what
closing them found. Every rule it adds was **seen failing on a planted violation** before it was
trusted: nine plants, nine red outputs, nine reverts, pasted below.

## 2. The orchestration switch

### 2.1 Bound

`CoreProperties.OrchestrationConfig` had a three-argument convenience constructor, used only by
tests. Two constructors and no `@ConstructorBinding`: the binder built no `OrchestrationConfig`,
`CoreConfiguration` fell back to `enabled`, and `false` was read by nothing — the `disable-ai` defect
a second time. The constructor is gone and its nine test callers pass the routing default it used
to inject.

**Tested against the real yaml, both services.** `OrchestrationSwitchBindingTest` in
`orazaka-job-service` and `orazaka-conversation-service` binds each service's own `application.yml`
through `CoreConfiguration`, with `ORCHESTRATION_ENABLED=false` — the variable the yaml names — as an
override. With the convenience constructor restored, both suites fail on exactly the two `false`
tests:

```
[ERROR] Tests run: 3, Failures: 2, … <<< FAILURE! -- in com.orazaka.conversationservice.infrastructure.config.OrchestrationSwitchBindingTest
[ERROR] Tests run: 3, Failures: 2, … <<< FAILURE! -- in com.orazaka.jobservice.infrastructure.config.OrchestrationSwitchBindingTest
Expecting value to be false but was true
```

The old `DynamicPipelineExecutorTest` asserted a `null` result when disabled, on a hand-built
object. It passed before the binding fix and would have passed after it.

### 2.2 What `false` does — traced, and why binding alone would have been worse than dead

The switch has one read: the top of `DynamicPipelineExecutor.process`. It returned `null`, and
`EnginePipelineBridge.compileContext` — the only path into the model for both `AbstractEngine.chat`
and `EngineStreamBridge` — **continued**: raw prompt, default provider, MCP tools attached, model
called.

| | Dead switch (before) | Bound only | Now |
|:---|:---|:---|:---|
| Phase 1 — `SafetyInterceptor` (crisis), `ScopeGuardInterceptor` (SENSITIVE), context | runs | **skipped** | turn refused |
| Phase 2 — `EntitlementInterceptor` (entitlement **and credit hold**), refiner, router | runs | **skipped** | turn refused |
| `disable-ai` — enforced only inside `process` (`enforceSecurityGate`) | enforced | **never evaluated** | turn refused |
| The model call | runs | **runs, ungoverned and unmetered** | not made |
| A prompt carrying inline media | skips the pipeline regardless | same | refused — the switch is read before that branch |

Repairing the binding and nothing else would have turned a kill-switch that could not kill into one
that, when thrown, disabled the crisis guard, the scope guard, the credit hold and `disable-ai` while
still calling the model — for chat, and for every Studio text step job-service runs. **Off now
refuses.** `requireEnabled()` is the single author of that meaning, called by `process` and by
`compileContext` before its media branch.

**Typed apart.** The refusal is `PipelineDisabledException`, not `PipelineShortCircuitException`:
job-service maps a short-circuit to `GUARD_REFUSAL`, which settles the work a run measured, and the
chat API answers it `403 upgrade_plan`. An operator switching the engine off is neither the user's
fault nor billable — `PLATFORM_UNAVAILABLE` in `JobListener.causeOf`, `503 engine_disabled` in the
conversation service (ADR-053).

AGENTS.md §7 documented the bypass under a key with no component (`…orchestration.pipeline.enabled`)
and called it a bypass. It now names the real key, says off refuses, and says what `disable-ai`
actually gates: AI-dependent interceptors, not the model call.

### 2.3 Behaviour change

**None today, and verified**: no `.env`, yaml, compose file or CLI command sets
`ORCHESTRATION_ENABLED`. The first `false` anyone sets will now stop engine turns — which is what
the yaml has called this switch all along.

**Found, not fixed** (audit #21): a prompt carrying inline media skips the whole pipeline with the
switch **on** — every gate above — and still calls the model. Exposure (which clients send inline
media on the synchronous path) is not established by this run.

> **Corrected by [ADR-063](ADR-063-the-media-turn.md) §1.** The exposure was established by the line
> that set `hasMedia`: the marker is read from the prompt string, so it is the chat API itself — any
> caller, no client capability. Closed there.

## 3. [CFG-001] — anchored on the two types, not on a description of them

| | `SecurityProperties` (pre-ADR-055) | `OrchestrationConfig` (pre-ADR-062) |
|:---|:---|:---|
| a `record`, so no setters | ✓ | ✓ |
| more than one constructor | ✓ no-arg delegate | ✓ three-arg delegate |
| any `@ConstructorBinding` | ✗ | ✗ |
| `@ConfigurationProperties` | ✓ | **✗** — a component of `CoreProperties` |
| reached by the binder | as an `@ConfigurationProperties` root | through `Binder.bind("orazaka.core", CoreProperties.class)` |

The annotation is true of one of the two; the first sweep keyed on it and missed the second.
"A record with a second constructor" is true of **seventeen** records, fourteen of which — `User`,
`JobCommand`, `PromptContext`, request DTOs — the binder never touches. What is true of both and not
of the fourteen: **reachable from a binding root through record components, more than one
constructor, none annotated `@ConstructorBinding`.**

**Read from bytecode, a deliberate deviation.** The workflow said to reuse `SourceFileScanner`. That
scanner matches literal lines; the anchor is a constructor set, an annotation on a constructor, a
field's generic type and a class literal beside a `bind` call. Reconstructing those from text is the
fragile regex §3 forbade. ArchUnit — already the engine behind forty rules here — reads them exactly.

**Coverage.** Binding happens in a running service, so the rule imports every `com.orazaka` class on
the service's runtime classpath: libraries without a suite (`orazaka-assets`, the clients) are bound
and checked inside the services that use them. It runs in core's suite and every service suite.
`orazaka-identity-service` had **no governance suite at all**; one is created with this rule only,
and the other rules' absence stays recorded.

**On its first run it found a third instance**, `CoreProperties.AudioConfig` (and
`ImageGenerationConfig`, §5). Both constructors removed. `AudioConfig`'s values are still literals in
`CoreConfiguration`, which masks the loss; recorded, not changed.

**Seen failing — the first known instance restored** (the pre-ADR-055 no-arg constructor):

```
  com.orazaka.core.infrastructure.config.SecurityProperties is built by the configuration binder (@ConfigurationProperties on SecurityProperties) and has 2 constructors, none annotated @ConstructorBinding. …
[CFG-001] configuration types the binder cannot construct (ADR-055, ADR-062):
[ERROR] Tests run: 1, Failures: 1, … <<< FAILURE! -- in com.orazaka.core.architecture.GovernanceTest
```

**The second known instance restored** — found through the `Binder.bind` root, not the annotation:

```
  com.orazaka.core.infrastructure.config.CoreProperties$OrchestrationConfig is built by the configuration binder (Binder.bind in CoreConfiguration.coreProperties() binds CoreProperties → orchestration) and has 2 constructors, none annotated @ConstructorBinding. …
[ERROR] Tests run: 1, Failures: 1, … <<< FAILURE! -- in com.orazaka.core.architecture.GovernanceTest
```

**A fresh violation** — a new `ReindexProperties` in knowledge-service with a convenience constructor:

```
  com.orazaka.knowledgeservice.infrastructure.config.ReindexProperties is built by the configuration binder (@ConfigurationProperties on ReindexProperties) and has 2 constructors, none annotated @ConstructorBinding. …
[ERROR] Tests run: 1, Failures: 1, … <<< FAILURE! -- in com.orazaka.knowledgeservice.architecture.KnowledgeServiceGovernanceTest
```

All three reverted; the nine suites green.

## 4. [GOV-006] — inert in a third way: invoked over nothing

### 4.1 The mechanism, made structural

`GovernanceSubjects.require(rule, population, subjects)` fails a rule whose subjects are empty,
naming the rule and what it found none of. ArchUnit rules already carry the equivalent
(`failOnEmptyShould`), **except that thirteen had switched it off by hand** with
`allowEmptyShould(true)` — twelve in `GovernanceRules`, one inline in `PersistenceBoundaryTest`. All
thirteen removed.

The seventh rule cannot forget what the first six were told, because
`GovernanceSubjects.assertEveryRuleIsNonVacuous` checks the rules themselves in bytecode: every public
`assert*` in `com.orazaka.test.architecture` must reach — directly or through its own helpers — an
ArchUnit `check`/`evaluate` or `require`, and nothing may call `allowEmptyShould`. On its first run it
listed **24 scanning entry points with no guard** and the ten methods with the switch off. It runs
from `orazaka-persistence-app`, beside [PACK-001] and [BILL-001]; `orazaka-test-support` declares no
test engine.

**Two forms of the defect were visible before anything ran**: three rules did
`if (!Files.isDirectory(root)) return;` (a misspelt source root passed green), and [SAGA-003] did
`if (body.isEmpty()) continue;` — rename the sixteen pure readers and it guards none of them, green.

### 4.2 The definition, corrected against the data

The first draft of the guard's javadoc said "every Mapper is final" over a module with no mappers had
"examined every class" and was not vacuous. Applying it showed that line would have kept exactly
[PACK-001]'s shape green. **A rule's subjects are what it judges.** Where there are none of them, it
judged nothing, and it is not invoked there.

### 4.3 What turned red — eleven invocations

| Suite | Rule | Why the subjects were empty | Decision |
|:---|:---|:---|:---|
| `SqlBoundaryTest` | [PACK-001] seed half | no `pack` row seeded since phase D | converted, §4.4 |
| persistence-app, persistence-identity | [ERR-107] mappers final/package-private | no `*Mapper` class — inlined into its consumer, which ERR-129 sanctions | not invoked there |
| persistence-app, persistence-identity | [ADR-007] collection fields private final | no such field in a non-record, non-entity class | not invoked there |
| `PersistenceBoundaryTest` | inline "Mapper not public" | no `*Mapper` in `application.service` | removed |
| `ToolsGovernanceTest` | [ERR-130] adapter-package kind | no class directly in `adapter.persistence`; tools keeps `entity/` and `repository/` below it | not invoked there |
| `EdgeGovernanceTest` | [ADR-035] no `permitAll` on internal surfaces | the edge has no `SecurityConfig` by design — it exchanges API keys for JWTs and every service enforces its own (AGENTS.md §8) | not invoked there |
| `AutomationServiceGovernanceTest` | [ADR-035] same | no HTTP endpoint, no `SecurityConfig`; the sibling rule for an `/internal` controller with no config still runs | not invoked there |
| `JobServiceGovernanceTest` | [ERR-130] domain holds no transport DTOs | no `domain` package | not invoked there |
| `IdentityGovernanceTest` | [ERR-130] support-package hygiene | no `infrastructure.support` package | not invoked there |

Each removed invocation leaves a one-line `// GOV-006:` justification where it was, and every rule
still runs where its subjects exist (3, 3, 4, 1 and 5 suites). **What this gives up, stated**: if a
mapper is added to a persistence module later, ERR-107 will not see it there. A rule that could only
ever run over the empty set in that module was not coverage; it was the look of it.

### 4.4 [PACK-001]

Its seed half checked ADR-036's invariants over seeded packs, of which there have been none since the
catalogue became bundles — its own javadoc said it "passes vacuously". Those invariants now live in
`PackBundle`'s and `PackStudio`'s constructors. What stays true of the seeds is the decision itself,
so the seed half is now that prohibition: **`infra/initdb` seeds no pack**, with the `CREATE TABLE
pack` statement as its subject — which fails the rule if the table ever moves. The manifest half is
unchanged. M1's seeded-kind check is gone with it: a seeded pack is now refused outright.

### 4.5 The six rules no suite called

| Rule | Decision | Evidence, run against the compiled tree |
|:---|:---|:---|
| `assertPersistencePackageHygiene` [ERR-109] | **wired** into both persistence suites | passes there, where converters, entities and repositories all exist; empty elsewhere |
| `assertApplicationInputsAreRecords` [HEX-003] | **deleted** | empty in every module — no module has `.application.dto` |
| `assertAdaptersImplementPorts` [HEX-004] | **deleted** | fails on every module — ports live in `domain.port`, so it would refuse correct code |
| `assertNoUnapprovedUtilsInProduction` [HEX-005] | **deleted** | names one library that only `orazaka-test-support` declares |
| `SourceFileScanner.assertNoBannedPatterns` | **made private** | its only caller is its own wrapper |
| `SourceFileScanner.assertNoEnvironmentInjection` [ERR-113] | **wired** into every suite | passes on 18 source roots — and core had a second, inline implementation, now replaced by the call |

### 4.6 Seen failing

**A new rule written like the 24 before it** (`assertNoTodoInReadmes`, scanning without `require`):

```
  GovernanceRules.assertNoTodoInReadmes judges a population it never proves non-empty: pass it through GovernanceSubjects.require, or express the rule as an ArchUnit rule
[ERROR] Tests run: 3, Failures: 1, … <<< FAILURE! -- in com.orazaka.persistence.architecture.GovernanceSubjectsTest
[GOV-006] governance rules that can pass over nothing:
```

**The ArchUnit guard switched off again** (`allowEmptyShould(true)` on `assertMappersFinal`):

```
  GovernanceRules.assertMappersFinal calls allowEmptyShould, which lets an ArchUnit rule pass having selected nothing — the guard this rule exists to keep on
[ERROR] Tests run: 3, Failures: 1, … <<< FAILURE! -- in com.orazaka.persistence.architecture.GovernanceSubjectsTest
```

**A misspelt source root** (`src/main/javaa`), which returned green before:

```
[ERROR]   KnowledgeServiceGovernanceTest.internalSurfaceDemandsServiceAuthority:58 [ADR-035] examined no source files under …/orazaka-knowledge-service/src/main/javaa
```

All reverted; 20 suites, 218 governance tests, green.

## 5. `IMAGE_STEP`, and [BILL-002]

### 5.1 Two causes, each with its own evidence

1. **`ImageGenerationConfig` had a second constructor** without `steps`; the binder built no image
   config. Removed in §3.
2. **`CoreConfiguration` never read the bound image config** and built one from literals, `steps`
   included. It now takes each field from the binding and falls back to the old literal only where
   the yaml says nothing.

`ImageStepsBindingTest` binds job-service's real yaml with `IMAGE_GEN_STEPS=10`. **After cause 1 was
fixed and before cause 2**, the binder test passed and the bean test failed:

```
[ERROR]   ImageStepsBindingTest.theMetersBeanCarriesTheDeploymentsSteps:51 [cause 2: CoreConfiguration built the image config from literals]
expected: 10
```

That run is the reason both are named: the visible fix left the meter billing 20 steps for a 10-step
deployment — **double what was done**.

### 5.2 The invariant, tested against the history before adopting it

The documented billing defects, five rows (ADR-046/047 held two):

| # | Defect | Proposed: *"no ConsumptionReport field from a constant or the request's intent — only what the executor reported"* | Adopted [BILL-002] |
|:---|:---|:---|:---|
| D1 | ADR-041: a run debited 5 of 480 — the first step settled the run's hold at `quantityFor(CALL) = 1` | ✓, but by forbidding flat fees, and `AGENT` is priced per `CALL` | ✓ — a `CALL` fee settles only the invocation that produced it |
| D2 | ADR-044: Studio chat steps billed twice | ✗ quantities were real | ✗ — a path; [BILL-001] |
| D3 | ADR-045: one async chat job, two holds | ✗ | ✗ — a path; [BILL-001] |
| D4a | ADR-046/047: image generation billed 0 — only unpriced `gpuSeconds` reported | ✗ nothing was a constant; the priced inputs were absent | ✓ — every input the unit needs must be present |
| D4b | ADR-046: the 1-credit floor, 54 % of credits padding | ✗ | ✗ — a pricing decision, not a quantity |
| D5 | M0.5: `steps` a literal 20 | ✓ | ✓ — and it also flags the *configuration* copy the fix left |

**Adopted:** *every quantity a job is billed on is evidence of the work — read from what the provider
returned or measured on the artefact it produced — and every input its unit needs is present; never a
literal, never our own copy of a configuration value, never a parameter of the request. A flat `CALL`
fee is the one quantity that is not a measurement: a price per terminal outcome, settling only the
invocation that produced it.* It covers D1, D4a and D5. It misses D2 and D3, which are paths and
[BILL-001]'s, and D4b, which is a price.

### 5.3 No honest static anchor — the first attempt, withdrawn

A bytecode rule — "a method that builds a billed measurement reads no configuration-bound type" —
was written and run. It flagged `generateImage` for reading the base URL, API key and timeout, and
`VisionAnalysisStrategy` for reading a model name: **none of them quantities**. "This method reads
configuration" is not "this quantity came from configuration"; linking a return value to a
constructor argument is data flow, which ArchUnit does not do. The rule read the wrong span — the
second failure mode the governance audit named — and was deleted rather than made green with
exceptions.

### 5.4 The contract instead, and the third provenance gap it exposed

`ImageGeneratorClientImplTest` runs the **real client and its provider SDK** against a stub
OpenAI-compatible endpoint that returns a **768×512** image for a **512×512** request. On the code as
it was, both tests failed:

```
[ERROR]   ImageGeneratorClientImplTest.theBilledDimensionsAreTheReturnedImagesNotTheRequests:108 [width billed from the request, not the work]
expected: 768
[ERROR]   ImageGeneratorClientImplTest.noDecodableImageIsUnmeasured:121
Expecting value to be false but was true
```

The adapter billed the dimensions it **asked** for, and billed a full image when none came back —
`ImageUsage`'s own javadoc had called these "promises, not observations". The usage is now measured on
the returned image; an image that cannot be decoded is unmeasured and releases its hold.

**Seen failing** — the billed width planted back as a configuration value:

```
[ERROR]   ImageGeneratorClientImplTest.theBilledDimensionsAreTheReturnedImagesNotTheRequests:118 [width billed from something other than the image that came back]
expected: 768
 but was: 512
```

Reverted; green.

**Residual, stated**: `steps` is the one input no image carries — sd-server takes it at launch — so it
is still read from configuration. `ImageStepsBindingTest` pins that the configuration is the variable
the launcher passes as `--steps`. Two readers of one variable remain the weakest link in this
capability's metering.

**Behaviour change, stated loudly**: a provider that returns only a URL is now **unmeasured and
released**, where it used to be billed at the requested size. The local sd-server path returns the
image's bytes and is unaffected; a hosted provider left on its default URL response would bill
nothing until the client asks for `b64_json` or measures the fetched file.

### 5.5 Found by the statement, outside the JVM, not fixed

`composer.py` reports `"fps": 30` — no `-r` is passed to ffmpeg — and `"frames": int(duration * 30)`
with `duration = len(photos) × seconds_per_photo`, the intended length. With audio the command adds
`-shortest`. Measured on the real composer with three photos and 2 s of audio:

```
REPORTED  frames=270 fps=30 -> billed output-seconds=9.00  width=1080 height=1920
MEASURED  frames=1 fps=25.0 duration=2.02s  width=1080 height=1920
```

**4.5× the output billed.** Without audio the 9 seconds come out right only because two fictional
numbers cancel. Recorded as audit #20.

## 6. Found and not fixed

- A chat turn carrying inline media skips every pipeline gate and still calls the model (§2.3, audit #21).
- Composition bills intended duration (§5.5, audit #20).
- `AudioConfig` values are still literals in `CoreConfiguration` (§3).
- `orazaka-identity-service`'s new suite runs [CFG-001] and ERR-113 only (§3).
- `CoreConfiguration` swallows a `Binder` exception at `debug` and continues with defaults — the
  mechanism that kept both switches quiet. [CFG-001] prevents the constructor cause; a different
  cause would still be silent.
- The M2M JWT on `/intent/route` is on the production-readiness audit as blocker §2.6, with the
  reasoning on ordering, and not implemented here.
- **`infra/migrations/2026-09-14-pack-kind.sql` could not be checked**: the local infra containers no
  longer exist — removed at some point around a Docker Desktop restart during this run — while the
  `orazaka_pgvector_data` volume survives. Run the migration after `orazaka start` recreates the
  database.
