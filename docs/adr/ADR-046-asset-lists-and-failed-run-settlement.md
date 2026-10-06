---
title: "ADR-046 — A list of asset ids is still assets, and a failed run's fault cannot be read from a string"
description: "Why realestate-reels was misdiagnosed as an environment limitation twice, why the platform/user boundary for settling a failed run is decidable in one direction only, and what 28 observed steps say about a credit whose floor charges twice its rate."
category: ADR
order: 46
---

# ADR-046 — A list of asset ids is still assets, and a failed run's fault cannot be read from a string

- **Status**: Accepted (§1), **Open — decision requested** (§2), Informational (§3)
- **Date**: 2026-09-02
- **Scope**: `products/orazaka` — `AssetFileResolver` and `JobListener` (job service);
  `ADR-034` §4 amended
- **Follows**: [ADR-042](ADR-042-studio-asset-resolution.md) (asset resolution at receipt),
  [ADR-041](ADR-041-run-settlement.md) (aggregate settlement), [ADR-045](ADR-045-metering-marker-guard.md)

## 1. A list of asset ids is still asset ids

### Context

`realestate-reels` failed at `assemble` with *"compose requires at least one readable photo"*, and
was written off as an environment limitation **twice** — once as a missing media runtime, once as a
video backend fault. Both were wrong.

ADR-042 put asset resolution at receipt, and resolved exactly one shape: the scalar payload key
`assetId`, which is what the vision fan-out uses. A composition step passes `photos` — a **list**.
Nothing resolved it. The media worker received ids where it expected paths, fell back to joining
them onto the upload root without the owner's directory or the file extension, found no readable
file, and raised the message above.

**That message is the point.** It reads as bad user input and it was our own gap. It is the reason
this ADR's §2 says what it says.

### Decision — three layers, and only the third was load-bearing

The failure looked like one defect and was three. Two of my fixes were aimed at real gaps that were
**not** what blocked the run, and each was proven inert by re-running it. Recorded in order, because
the sequence is the lesson:

1. **`AssetFileResolver.resolvePayload`** (job service) — rewrites every asset id in a payload,
   scalar or inside a list, to its absolute path, scoped to the acting actor as ADR-042 requires.
   Keyed on the *value's shape*, not the key's name: a list of asset-bearing keys — `photos`,
   `clip`, whatever the next pack invents — would put pack vocabulary in engine code [PACK-002].
   An asset id is a UUID, so a UUID naming a file *this actor owns* is an asset reference and
   nothing else plausibly is.
   **Inert for this bug**: `orazaka.studio.media.compose` routes to `job.compose.assemble`, the
   Python media worker — the Java listener never sees it. Kept, because it is correct for every
   capability that *does* route through the job service, and because writing it found the directory
   defect below.

2. **`_resolve_owned_asset`** (media worker) — the Python twin, with the same ownership rule, since
   this worker receives jobs the Java resolver cannot reach.
   **Also inert on its own**: what arrived was not a list of ids.

3. **`RunScope.resolveValue`** (studio contract) — *the actual defect.* `resolve` returns a
   `String`, and renders a list as its elements one per line. That is right for a prompt and is what
   its javadoc describes — but it was **every** step input's only option, so `photos:
   "{{inputs.photos}}"` reached the executor as two ids joined by a newline. The worker split on
   commas, got one unusable string, and raised the message above. `resolveValue` returns the
   referenced value when the template is **exactly one placeholder** over a list, and falls back to
   the old rendering otherwise — so a placeholder inside a sentence, a literal, or several
   placeholders behave precisely as before and no shipped prompt changes.

### Consequences

- **`realestate-reels` succeeded for the first time.** `assemble` produced a real 1080×1920 MP4 —
  180 frames at 30 fps from 2 stills. The hold reserved **480** and settled **15**: 2 vision + 1
  chat at the floor, plus 6 output-seconds of composition at 2.0 credits each.
- Written test-first at every layer, and the red was worth having: 4 of 7 Java assertions failed
  against the old behaviour, and one found a defect nobody was looking for. Output is written to
  `{uploadDir}/{userId}/{jobId}/`, `listFiles` returns directories, and nothing checked — so **a job
  id resolved to its own output directory and travelled on as if it were an uploaded asset.** Both
  resolvers now require a regular file.
- Ownership is unchanged and pinned on both sides: a list holding another actor's id keeps that id,
  and a `../` in an id escapes nothing.
- **The diagnosis was wrong three times before it was right** — twice as "the environment", once as
  "the job service". Every one of those was settled by re-running the Studio and reading what
  actually failed; none survived contact with a run. The blueprint that exercises the most step
  kinds is the one that found this, which is an argument for running it, not for trusting it.

## 2. Settling a failed run — **rejected**, because the boundary is undecidable

> **REOPENED AND CLOSED — 2026-09-08, see [ADR-053](ADR-053-typed-failure-cause.md).** The
> "when to revisit" note below said *at the cloud launch*, and it was reasoning about money.
> Phase H produced a reason that is not money: a scope-guard refusal and a model outage arrived
> identical, so a `SENSITIVE` pack's audit log could not tell *"we protected the user"* from
> *"we broke"*. That is [ADR-051](ADR-051-sensitive-controls.md)'s third control losing its
> meaning, not a billing policy waiting its turn. `job.{id}.error` now carries a declared cause,
> the boundary is readable, and the policy below applies as it was originally put. Everything in
> this section remains accurate about the state it described.

- **Status of this section**: Closed. The policy was proposed, argued against, and **withdrawn**.
  Nothing in the code changed; a counter was added instead.

The policy put was: a failed run settles what it consumed, never its estimate and never zero — a
**platform** fault releasing everything, a fault in the user's **input or configuration** settling
what ran. It is rejected because the saga cannot tell those apart.

**The platform side is decidable, and only that side.** `UnroutableCapabilityException` is our own
exception at our own dispatch site; `EXECUTION_TIMEOUT_EXCEEDED` and `EXECUTION_INTERRUPTED` are
sentinel constants our own `JobListener` emits; a step with no `job_id` never dispatched. Those four
need no string parsing.

**Every other failure is an opaque string.** `job.{id}.error` carries a free-form `String` — no
code, no category — produced by whichever executor failed. There is no failure the saga can
*positively* attribute to user input.

**And the counter-example came from the run that motivated the policy.** §1's failure read
*"compose requires at least one readable photo"* — as clear a statement of bad user input as an
error string gets — and it was our own defect, three layers deep. **A classifier built on those
strings would have billed a customer for our bug**, which is the "unrecoverable trust damage"
ADR-033 §1 exists to prevent. The policy would therefore resolve to billing for our own defects, or
to a settle-branch that is almost always empty. Neither is what was asked for.

**What would make it decidable**, if it is ever worth deciding, is the principle
[BILL-001](ADR-045-metering-marker-guard.md) already applies to metering: *declared, not inferred*.
`job.{id}.error` would carry a typed cause the failing executor sets — it knows whether it rejected
a payload or lost its model — and the saga would read a category instead of interpreting prose. That
is a contract change across the whole job plane, every executor including the Python worker.

> **When to revisit.** Not at a phase boundary — **at the cloud launch**. Today every failure is our
> own machine's, so releasing everything costs us nothing we would otherwise have collected. The
> moment compute is rented, an unattributable failure has a bill attached to it, and the typed cause
> stops being tidiness and starts being money. Until then this is deliberately open.

### What was built instead: two counters

Not a contract — a number, so the question can be argued from evidence rather than from intuition:

- `orazaka.saga.run.failed{consumedCompute=true|false}` — the **fraction** of failed runs that died
  after real compute was spent. Named on the saga rather than under `orazaka.studio.*`, because that
  prefix is the pack preference namespace on the wire and [PACK-002] refuses it in engine code. The
  rule fired on this exact line and was right to: a prefix that is only sometimes reserved is not
  reserved.
- `orazaka.billing.hold.released.credits{terminal=RELEASED|EXPIRED}` — the **amount** handed back,
  counted where the release happens and the estimate is known.

## 3. Instructing the pricing decision — numbers, not a recommendation

ADR-045 observed that every settled credit was `minimum_credits` and never the per-kilotoken rate.
That makes the volume-based pricebook decorative for text and vision, which is a **pricing decision
and not mine**. What follows is the evidence, read from `studio_run_step` across every real run.

**A — observed consumption by step type** (every real run, including the composition)

| billed as | steps | unit observed | credits |
|:---|--:|:---|--:|
| CHAT | 25 | 10 195 tokens (median 363) | **25** |
| IMAGE (vision) | 12 | 8 766 tokens (median 734) | **12** |
| IMAGE (generation) | 2 | `gpuSeconds` only — unpriced | **0** |
| VIDEO (composition) | 1 | 6.0 output-seconds | **12** |

**A′ — the split that matters: composition is already priced by its rate**

| 180 frames @ 30 fps | = 6 output-seconds × 2.0 credits | = **12 credits**, floor is 1 |
|:---|:---|:---|

One composition step costs more than all 37 token-metered steps put together (12 vs the 19 the rate
would charge them). **The floor problem is not "the pricebook"; it is specific to the token-based
capabilities**, whose unit is three orders of magnitude finer than a typical step consumes.

**B — the floor's share, token-based capabilities only**

| | |
|:---|--:|
| token-metered steps | 37 |
| steps under the 1-credit floor | **37 (100 %)** |
| tokens min / median / max | 237 / 406 / 921 |
| credits the **rate** alone would charge | **19.0** |
| credits actually charged | **37** |
| the floor charges | **1.95× the rate** |

**C — the same work at a finer credit** (rate unchanged at 1 credit/kilotoken; only granularity moves)

| granularity | floor is | sub-credits | = today-credits | floor share |
|:---|--:|--:|--:|--:|
| today (1×) | 1.000 | 28 | **28.0** | 54 % |
| 10× finer | 0.100 | 144 | **14.4** | 0 % |
| 100× finer | 0.010 | 1 313 | **13.1** | 0 % |

**D — inflection: where the rate starts to structure the bill**

A step exceeds the floor when `tokens > 1000 / granularity`.

| granularity | floor bites below | rate structures |
|:---|--:|:---|
| today (1×) | 1 000 tokens | **0 / 28 steps (0 %)** |
| 2× finer | 500 tokens | 11 / 28 (39 %) |
| 3× finer | 333 tokens | 17 / 28 (61 %) |
| 5× finer | 200 tokens | **28 / 28 (100 %)** |
| 10× finer | 100 tokens | 28 / 28 (100 %) |

The smallest step observed is 237 tokens, so **4.2× finer** is where the rate bites on every
observed step; the median is 406, so **2.5× finer** is where it bites on half.

**E — in money** (`billing.credit.unit-price-cents = 1`)

All 28 metered steps — 13 000 tokens — bill **28 credits = 28 ¢** today, against **13 ¢** at the rate
alone.

> **Not decided here, and deliberately:** the credit's granularity, the rates, and the blueprint
> estimates. The estimates in particular stay untouched until the unit question is settled, because
> recalibrating them against a unit under review would have to be done twice.
