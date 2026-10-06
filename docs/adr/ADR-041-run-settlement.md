---
title: "ADR-041 — A run settles once, at the sum of what its steps measured"
description: "Why a Studio run reserved 480 credits and was debited 5, why the fix is that steps stop carrying the run's hold rather than each taking their own, why the settlement contract was extended instead of pricing steps outside billing, and what a run actually costs now."
category: ADR
order: 41
---

# ADR-041 — A run settles once, at the sum of what its steps measured

- **Status**: Accepted
- **Date**: 2026-08-31
- **Scope**: `products/orazaka` — `MeteredStep` and `CreditAuthorizationClient.settleAggregate` in
  `orazaka-billing-api`; `CreditLedgerService.settleAggregate`, `PackProvisioningController`'s
  sibling `CreditController` endpoint and `AggregateSettleRequest` in `orazaka-billing-service`;
  both `orazaka-billing-client` adapters; `CapabilityRoute.billableCapability` in
  `orazaka-jobs-api`; `StepDispatch` (field removed) in `orazaka-studio-api`;
  `CreditReservationService`, `RunSagaService`, `JobOutcomeEvent`, `JobOutcomeListener`,
  `AmqpStepExecutionAdapter` and `ColumnValueResolver` in `orazaka-studio-service`;
  `JobEventPublisher`/`JobListener` in `orazaka-job-service`; `app/consumer.py` and
  `app/telemetry.py` in the media worker; `studio_run_step` and the compose rows in
  `infra/initdb/{80-studio,30-jobs-config,70-billing}.sql`.
- **Amends**: [ADR-034 §4](ADR-034-studio-marketplace.md) — which described this protocol and was
  never implemented.
- **Closes**: `PACK_EXTENSIBILITY_ARCHITECTURE.md` §6.1.

## Context

A `realestate-reels` run reserved **480 credits and was debited 5.**

Three mechanisms combined. `RunSagaService` passed `run.holdId()` into every `StepDispatch`, so the
run's hold travelled in each step's job payload. `JobSettlementListener` bills any job outcome whose
payload names a hold, so the **first step to reach a terminal outcome settled the entire run** — and
it priced that step against the *hold's* rate, `AGENT`/`CALL`, whose quantity
(`ConsumptionReport.quantityFor(CALL)`) is a hardcoded `1`. Five credits. Every later step then found
the hold closed, `settleMeasured` returned false, and the listener released a hold that was already
gone. `CreditReservationService.settle` — the run's own settlement — was a `release`.

Its javadoc said the opposite: *"each step already settles its own measured consumption through the
executor that ran it, so charging this hold again would bill the same work twice."* No step ever did.
There are no per-step holds anywhere in the codebase, and `StepDispatch.holdId` was documented as
"the **run's** credit hold" two files away. The comment survived three phases and misled a reader
who went looking; it is corrected here, and the correction matters as much as the code.

## Decision

### 1. The run's hold is the run's. Steps carry no hold at all

`StepDispatch.holdId` is **removed**, not nulled — a field that must always be null is a trap for
the next author. A step that cannot see the hold cannot settle it by accident, which makes the
defect unrepresentable rather than merely fixed. The job service sees no `holdId`, so
`JobOutcomeEvent.isBillable()` is false and billing ignores the outcome; the steps simply report
what they measured in `job.{id}.done`, which `JobExecutionResult` has carried since phase C.

Per-step holds stay rejected, as ADR-034 §4 says: discovering mid-run that step five is unaffordable
is a worse product than a conservative estimate. The hold remains one guarantee of solvency taken
once — and at the end it becomes the debit, which is the half that was missing.

### 2. The saga accumulates, and settles once at the sum

Each step's measurements are written to `studio_run_step` in the **same statement** that marks the
step terminal, guarded by the same status predicate — so a redelivery that loses the race applies
neither, and a step can never be counted twice. Stored rather than accumulated in memory because a
restart between step four finishing and step five starting would otherwise lose the run's cost.

At the run's terminal transition the saga reads those rows, resolves each step's
`billable_capability` through `CapabilityRoutingClient`, and settles the hold once.

### 3. The settlement contract was extended; pricing did not leave billing

A run crosses capabilities priced in different units — `KILOTOKEN`, `IMAGE_STEP`, `OUTPUT_SECOND` —
and `settleMeasured` takes one report and prices it against the hold's own rate. Two ways out were
available.

**Rejected: price each report where it is measured and send one credit total.** `ConsumptionReport`'s
own contract forbids the weaker version of this — *"a producer that named the unit would be a second,
drifting copy of a pricing decision it does not own"* — and computing credits is worse than naming a
unit. It also cannot be done correctly: the pricebook is versioned and the hold pins
`pricebook_version`, so a caller pricing at "current" would charge a rate the hold was never
authorised against. `settle()` refuses a unit mismatch for the same reason ("a wrong debit is
unrecoverable trust damage"), and squeezing a credit total through it as a fake `CALL` quantity would
defeat exactly that guard.

**Chosen: `settleAggregate(holdId, List<MeteredStep>, idempotencyKey)`.** Billing receives
measurements *plus what produced them* — `(capability, model, ConsumptionReport)` — prices each
against its own row at the pinned version, sums, caps at the overshoot ceiling, and applies **one
debit against one hold**. One `usage_event` per step, so the total stays reconstructible from the
measurements that produced it. The run id is the idempotency key: a run settles exactly once.

An empty list, or nothing priceable in it, **releases** rather than debits: a run that measured
nothing must not be billed at its estimate. That is the direction `JobSettlementListener` already
chose for a single job.

### 4. Composition is priced apart from generation

`orazaka.studio.media.compose` gains `billable_unit = OUTPUT_SECOND` — the media worker has reported
`frames` and `fps` since it was written, so the duration was on the wire the whole time and only the
unit was missing. It is priced at a new `(VIDEO, 'orazaka-compose')` pricebook row rather than
VIDEO's default: both are video output, but 90 credits/second is what it costs to *invent* pixels
and an ffmpeg concat invents none. The worker reports `orazaka-compose` as its model — a statement
about which engine ran, not about what it costs — derived from the routing key, so no pack identity
enters the worker ([PACK-003] holds).

## Consequences

- **A `realestate-reels` run: 480 reserved → 480 reserved.** The debit moves from **5** to the sum
  of what its steps measured. Per step, with the seeded rates: `b-roll` 5 output-seconds × 90 = 450;
  `assemble` 15 output-seconds (5 photos × 3s) × 2.0 = 30; `describe` and `script` contribute **0**.
  Total **480**, against 5 before.
- **`describe` and `script` contributed nothing — closed by the amendment below.**
- **Failed runs are unchanged**: still released, never billed (ADR-034 §8.4), even when expensive
  steps succeeded before the failure. That is a policy decision this ADR deliberately does not
  revisit.
- **A step whose route no longer resolves is skipped with a warning** rather than failing the
  settlement, and one under-reporting executor does not abandon the debit for the four steps that
  did run. Refusing to settle would leave the actor's credits held for nothing.
- **`CapabilityRoute` gained `billableCapability`** — the other half of the row it already carried
  `billableUnit` from. Its absence was why the saga could only price against the run hold's own
  capability.

## Alternatives considered

- **A hold per step.** Rejected by ADR-034 §4 and still rejected: it moves an affordability failure
  from before the run to the middle of it, which is the worse product.
- **Keep `settleMeasured` and settle the largest step.** Rejected: it is a guess dressed as a
  measurement, and it would bill an unpredictable fraction of a run.
- **Sum in `GPU_SECOND` across every step.** Rejected: no capability is priced in it, and adopting it
  would reprice every capability on the platform to make one orchestrator's arithmetic convenient.
- **Let the saga read `credit_pricebook` directly.** Rejected: another context's table in another
  database (SEAM-001), and it would still price at the wrong version.

---

## Amendment (2026-08-31) — chat and vision now measure, and the gate that hid it

The consequence above ("`describe` and `script` contribute 0") was the largest thing this ADR left
open, and it was worse than it read: **chat and vision are the two most frequent step kinds**, and
the phase-E pack (`outbound-prospection`) is chat-only. Shipping it against an unmetered chat step
would have made the entire pack free — the compose trap, one size up.

### The gate first

No `maven-failsafe-plugin` was configured outside the e2e module's own profile, and surefire's
default includes match `**/*Test.java`, never `**/*IT.java`. **Twelve integration suites — 120 tests
— were invisible to `./mvnw clean install`** and ran only when someone named them with `-Dtest`.
That is how `StudioRunLifecycleIT` and `PackCatalogIT` stayed red for a whole phase after ADR-039's
seed migration. Failsafe is now bound in the parent (`integration-test` **and** `verify`; without
the second a failing IT is recorded and the build still passes). Two details were load-bearing:

- `<classesDirectory>${project.build.outputDirectory}</classesDirectory>`. Failsafe runs after
  `package`, which in a Spring Boot module has already swapped the artifact for the repackaged fat
  jar whose classes live under `BOOT-INF/classes`. Without this, `AssetControllerIT` dies at
  *discovery* with `NoClassDefFoundError` on a class sitting in `src/main`.
- The e2e module is untouched: it already sets `skipTests=${skip.e2e}` on this plugin, so its 14
  live-stack suites stay behind `orazaka test e2e`.

All 12 suites are green.

### Chat: `TokenUsage` crosses the port

`TokenUsage` already existed and the **synchronous** path already used it, through
`ChatCompletedEvent` → `ChatSettlementListener`. The asynchronous path could not reach it: the
inbound port's `ChatResponse` carried `(content, conversationId, metadata)` and
`ChatGeneratorClientImpl` dropped `resp.tokenUsage()` on the floor when mapping out of
`InternalChatResponse`. Every `AiClient` caller therefore received a response with no measurement,
which is why `ChatGenerationStrategy` returned `JobExecutionResult.of(result)`.

`ChatResponse` now carries `TokenUsage` — typed, never null, `TokenUsage.none()` meaning *the
provider reported nothing*, which is a different fact from consuming nothing and is what releases a
hold instead of billing a guess. Nothing was reinvented; the value simply crosses the boundary it
was already computed on.

### Vision: KILOTOKEN, not IMAGE_STEP

An image *analysis* is a VLM completion — it runs through the same `aiClient.chat`, the image
becomes prompt tokens, the description completion tokens. `IMAGE_STEP` cannot express that:
`quantityFor(IMAGE_STEP)` requires `steps > 0`, meaning **denoising** steps, which an analysis does
not have. Pricing vision there would mean inventing `steps = 1` to satisfy a unit — fabricating a
measurement, which is precisely what `ConsumptionReport`'s contract exists to prevent.

So vision keeps `billable_capability = IMAGE` (it is image work, and analytics should say so) and is
priced **per model** in `KILOTOKEN`, through four `(IMAGE, <vlm>)` pricebook rows. Image generation
keeps `IMAGE_STEP` through the `(IMAGE, NULL)` default. This is the shape `AUDIO` already uses one
capability over — TTS in `KILOCHAR`, transcription in `AUDIO_MINUTE` — where the seed says it
outright: *the metering unit is a property of the MODEL*. The capability row's `billable_unit` is
therefore `NULL` for vision, exactly as `AUDIO`'s rows are.

Reaching a model-specific row required the executor's **resolved** model to travel, so
`JobExecutionResult` gained `model`: a producer sends the `"default"` sentinel and only the executor
knows which engine ran. `JobListener` prefers it over the request's.

### Measured — trade-showcase, per step

| step | capability / model | measured | credits |
|:---|:---|:---|--:|
| `caption` | CHAT (default row, KILOTOKEN @ 1.0) | **237 tokens**, live | **1** |
| `describe` ×3 | IMAGE / VLM (KILOTOKEN @ 1.0) | — | 0 |
| `showcase` | IMAGE generation (IMAGE_STEP) | `gpuSeconds` only | 0 |

Reserved **100** (the blueprint's estimate, untouched) → debited **1**, against **0** before.

Only `caption` could be measured live, and it was: 237 real tokens off a real model, 0.237
kilotokens, ceiling 1, floor 1 → 1 credit. The other two are **not** closed by this amendment and
must not be read as such:

- **Vision cannot run inside a Studio at all**, for a reason that has nothing to do with billing:
  the studio dispatch passes `resolvedInputs` straight through, so a step declaring
  `assetId: {{item}}` arrives without the `filePath` the executor needs — `JobSubmissionService`
  resolves that on the synchronous path and `AmqpStepExecutionAdapter` does not. Every `describe`
  fan-out fails with *"Payload does not contain filePath field"*. Its billing is wired and pinned by
  test (`VisionAnalysisStrategyTest`, and `CreditLedgerInvariantsIT` prices 4200 tokens at 5
  credits), but no live figure exists — the local VLM also fails to load on this machine
  (`llama-server ... error loading model`), so this is unmeasured twice over.
- **Image generation still reports nothing priceable.** `ImageResponse` carries no dimensions or
  steps, so closing it means plumbing them out of the provider — the same shape of work as the chat
  fix, on a different port. It was outside this amendment's scope (chat and vision) and is open.

**Is the blueprint's estimate still credible?** Reported, not retouched: **no, it is conservative by
roughly an order of magnitude.** Fully metered, trade-showcase would be three VLM turns (a few
hundred to a few thousand tokens each) plus one 1024×1024 × 4-step generation ≈ 8 credits — call it
10–25 credits against an estimate of 100. Over-reserving is the safe direction (the hold is a
solvency guarantee and overshoot is capped), but it holds ~5× more of a user's balance than a run
costs. Recalibrating it belongs with the phase-0 pricebook pass, beside the placeholder rates it
depends on.

**Phase E is unblocked**: `outbound-prospection` is chat-only — one `CAPABILITY` step (`angle`,
chat) plus TRANSFORM, APPROVAL and CONNECTOR steps, none of which consume metered compute. Its
single billable step is now metered.
