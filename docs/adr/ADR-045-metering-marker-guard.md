---
title: "ADR-045 — The second producer had no marker, and only the ledger could say so"
description: "Why ADR-044's fix was half a fix, why a fitness function with three subjects was worth writing against ADR-033's own precedent, and what five Studio runs actually cost when read from credit_ledger_entry instead of the pricebook."
category: ADR
order: 45
---

# ADR-045 — The second producer had no marker, and only the ledger could say so

- **Status**: Accepted
- **Date**: 2026-09-02
- **Scope**: `products/orazaka` — `JobCommand` (Tier-1 `orazaka-jobs-api`), `JobQueuePublisherService`
  (conversation service), `AmqpStepExecutionAdapter` (studio service), `EntitlementInterceptor`
  (interceptors), new `MeteringMarkerRules` + `MeteringMarkerTest` [BILL-001]
- **Completes**: [ADR-044](ADR-044-deferred-metering.md), which fixed one of two producers
- **Rests on**: [ADR-033](ADR-033-credit-metering.md) §1

## Context

ADR-044 fixed the Studio path and closed with a caveat: *"any future orchestrator that settles its
own work must set the marker, and nothing forces it to … a rule with one subject is a rule written
against a hypothesis."*

Both halves of that sentence were wrong.

**There was no future orchestrator to wait for.** A second producer already existed —
`JobQueuePublisherService`, the async interactive path — and it had been double-billing the whole
time. Measured on one submitted chat job, from `credit_hold`:

```
HOLDS opened by ONE async chat job: 2
   CHAT  est=2  settled=1  SETTLED  job=82295b1f     ← JobMeteringService.authorize()
   CHAT  est=2  settled=1  SETTLED  job=-            ← EntitlementInterceptor, which stamps no
   DEBIT -1 bal=99985                                  jobId because it believes none exists
   DEBIT -1 bal=99984
```

Two credits for one inference, on the plainest path the product has.

**And the precedent was against the caveat.** ADR-033 §1 states that *"a double-debit is
unrecoverable trust damage and warrants two independent guards"* — the reasoning behind the ledger
carrying both an `idempotency_key UNIQUE` and the `processed_messages` dedup for one failure mode.
The same ADR made the hold sweeper a build-enforced fitness function *before* a hold had ever been
stranded, because it is "the most commonly omitted component of credit systems". Neither of those
waited for a second subject.

## Decision

### 1. The marker is a Tier-1 wire key, not three private copies

`JobCommand.DEFERRED_METERING_KEY` with `withDeferredMetering()` and `deferredMetering()`. Three
modules in three bounded contexts must agree on the exact string; the sanctioned way for one context
to depend on another's vocabulary is a Tier-1 contract (AGENTS.md §2). It had been a private copy in
each of two of them — and the third was written with no copy at all, which is precisely the failure
duplication invites.

### 2. `JobQueuePublisherService` stamps it, conditionally

```java
JobCommand authorized = metered.holdId() != null ? metered.withDeferredMetering() : metered;
```

Conditional on `holdId`, not unconditional: `authorize()` returns the command unchanged when billing
is off or unreachable, and claiming to meter what nobody metered would leave the work **free**
rather than double-charged. The marker asserts "a hold exists", so it is set exactly when one does.

### 3. [BILL-001] — every `job.*` producer declares or disclaims its metering

`MeteringMarkerRules.assertEveryJobProducerDeclaresItsMetering` scans production sources: a class
naming the jobs exchange outside `infrastructure/config` either declares the marker or appears on
`EXEMPT` with a written reason of at least sixty characters. Stale exemptions fail too.

**Matched on the destination, not on `convertAndSend`.** The first draft matched the broker call and
passed while missing `JobQueuePublisherService` entirely — that producer publishes through the
transactional outbox, so the exchange name reaches an `OutboxMessage` and the broker call happens
later in a relay. A rule that sees one of two transports is worse than no rule, because it reports
green.

Three subjects today: two stamp, one is exempt — `ConnectorDispatcher`, which dispatches
`job.agent.dispatch.{userId}` to a user's own CLI agent, running no inference here and reaching no
pipeline.

## Consequences

**Measured, one async chat job:**

| | holds | debited |
|:---|--:|--:|
| before | 2 | **2** |
| after | 1 | **1** |

### What the ledger said about the rest

Every figure below is read from `credit_ledger_entry` and `credit_hold` on a purged billing
database with `BILLING_ENABLED=true` — never computed from the pricebook.

| Studio | hold | est. | **settled** | inferences | reconciles |
|:---|:---|--:|--:|--:|:---|
| trade-showcase | 1 × AGENT | 100 | **3** | 2 vision + 1 chat | 3 × 1 |
| trade-showcase (2nd) | 1 × AGENT | 100 | **3** | 2 vision + 1 chat | 3 × 1 |
| lead-research | 1 × AGENT | 60 | **3** | 3 chat | 3 × 1 |
| outbound-prospection | 1 × AGENT | 120 | **2** | 2 chat | 2 × 1 |
| followup-sequences | 1 × AGENT | 80 | **3** | 3 chat | 3 × 1 |

**One hold per run, zero `CHAT` holds, on every one** — ADR-044 holds up under observation.

**`realestate-reels` could not be measured, and the environment is not why.** The pack was
purchased, the studio unlocked, and the run reached `describe` ×2 and `script` — three real
inferences, 1 908 tokens — before failing:

| step | outcome |
|:---|:---|
| `describe` #0, #1 | SUCCEEDED — 688 and 735 tokens, `llava:latest` |
| `script` | SUCCEEDED — 485 tokens |
| `approve` | SUCCEEDED |
| `b-roll` | FAILED — `HTTP Error 400: Bad Request` from the video backend |
| `assemble` | FAILED — `compose requires at least one readable photo` |

The second failure is a defect, not a missing runtime: `JobListener.resolveAssets` resolves the
scalar `assetId` key only, while `assemble` passes `photos` — a *list* of asset ids — so
ADR-042's asset resolution never reaches the compose step. List-valued asset inputs are unresolved
for every capability that takes them. Named here, not fixed: it is a job-plane change with its own
blast radius, and this commit is already two billing changes wide.

**A failed run pays nothing for the work it did.** The hold was `RELEASED` — 480 reserved, **0
debited** — after three successful inferences had consumed real GPU time. At the job level that is
ADR-033 §1 working as designed ("a failed job is never billed"); at the *run* level ADR-041 settles
once at the end, so a run that fails on its last step discards the measured cost of every step that
succeeded. Whether that is generous-by-design or a leak is a product decision, not a bug to fix
quietly, and it is recorded here rather than answered.

**Two things the ledger showed that no computed figure could.**

*The price is the floor, not the rate.* Every settled credit is `minimum_credits`, never the
per-kilotoken rate: the largest inference measured was 769 tokens, so no step reached one kilotoken
and every one cost exactly 1. The pricebook's rates are, at these prompt sizes, unreachable — the
cost of a run is the count of its inferences.

*The estimates are 20–60× the reality*, not the 5× previously reported — and that earlier figure was
itself computed, which is exactly the class of number this exercise invalidated. The estimate is not
cosmetic: it **is** the hold. A `free` actor's 100-credit grant is entirely consumed by one
`outbound-prospection` hold that settles at 2. **Not recalibrated here** — deliberately out of
scope, and a number this far off deserves its own decision rather than a quiet edit.

### The trap that hid all of it

`orazaka.billing.service-secret` was absent from all four consumers, so `BILLING_ENABLED=true`
crashed every service and billing had never once run. That is fixed — all four carry the key.

The failure mode was, at least, **loud**: `ServiceTokenProvider`'s constructor calls
`Objects.requireNonNull` and refuses a secret under 32 characters, so a fifth consumer that forgets
the key fails at bean construction with a message naming the fix. It never bills silently.

What remains untested is that a billing-enabled service *starts at all* — nothing in the build boots
one with `orazaka.billing.enabled=true`, which is why a missing key survived for as long as no one
flipped the flag. That is a real gap and it is named here rather than fixed, because the fix is an
integration test per service and this commit is already two billing changes wide.
