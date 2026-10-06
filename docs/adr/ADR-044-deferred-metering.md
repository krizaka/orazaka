---
title: "ADR-044 — An inference metered by its orchestration takes no hold of its own"
description: "Why every Studio chat step was billed twice, why the fix is a marker the producer sets rather than something the interceptor infers, and why the entitlement check stays where the hold leaves."
category: ADR
order: 44
---

# ADR-044 — An inference metered by its orchestration takes no hold of its own

- **Status**: Accepted
- **Date**: 2026-09-02
- **Scope**: `products/orazaka` — `EntitlementInterceptor` in `orazaka-interceptors`;
  `AmqpStepExecutionAdapter` in `orazaka-studio-service`.
- **Corrects**: [ADR-041](ADR-041-run-settlement.md), whose aggregate settlement assumed steps carry
  no hold — true of the hold ADR-041 removed, false of the one the pipeline takes for itself.
- **Found by**: [ADR-043](ADR-043-prospection-pack.md), the first run with billing switched on.

## Context

**Every Studio chat step was billed twice.** Measured on three prospection runs: the wallet moved
**16 credits for 8 inferences**, and there were **eleven credit holds where three had been
authorised**.

Two metering paths ran over the same work and neither knew about the other:

- `EntitlementInterceptor` takes a `CHAT` hold per inference, and `ChatSettlementListener` settles
  it. Its own comment states the assumption — *"No jobId: this turn is synchronous, there is no
  async job behind it"* — and a Studio step is precisely the case that excludes.
- The run's `AGENT` hold settles the same steps in aggregate (ADR-041).

Nobody had seen it because **billing had never been switched on**: `orazaka.billing.service-secret`
was missing from every consumer, so `BILLING_ENABLED=true` crashed each service at startup
(ADR-043). Every earlier figure in this repository was computed from the pricebook rather than read
from the ledger, and a computed figure cannot show you a second hold.

## Decision

### The producer declares it, the interceptor obeys

`AmqpStepExecutionAdapter` stamps `orazaka.metering.deferred = true` into the step's payload; the
job service already merges `orazaka.*` payload keys onto the context, so it reaches the pipeline
unchanged. `EntitlementInterceptor` skips **the hold** when it sees it.

**Declared, not inferred.** The interceptor could have sniffed for a `runId` in the context, and
that would have been worse: every future producer that happens to carry one would become silently
unbilled, and the interceptor would be guessing at a claim it cannot verify. A marker is a statement
its author is accountable for — *"I meter this, and here is the hold that proves it"*.

Namespaced `orazaka.metering.` rather than `orazaka.studio.` so that no pack namespace appears in
engine code that has to read the key ([PACK-002]).

### The entitlement check stays

Only the hold moves. `EntitlementInterceptor` still resolves the actor's snapshot and still refuses
a plan that does not include chat — a deferred turn that is not entitled is short-circuited exactly
as before, and `EntitlementInterceptorTest` pins that separately from the no-hold case. **Metering
moves; permission does not.**

## Consequences

**Measured — `lead-research`, the same run before and after:**

| | holds | of which CHAT | debited |
|:---|--:|--:|--:|
| before | 4 | 3 | **6** |
| after | 1 | **0** | **3** |

Wallet 19 984 → 19 981 for three chat steps measuring 250 + 320 + 454 tokens. Across the three
prospection runs the pattern was 16 credits for 8 inferences; it is now the 8 the pricebook says.

- **The run hold is now the only authorisation for its steps**, which is what ADR-041 intended and
  what makes its overshoot cap meaningful: a per-turn hold sat outside that ceiling entirely.
- **Synchronous chat is untouched.** A turn with no marker behaves exactly as before — the marker is
  set by one producer, for steps whose run already holds.
- **The gap this leaves**: any *future* orchestrator that settles its own work must set the marker,
  and nothing forces it to. The honest guard would be a fitness function over producers of
  `job.*` commands, and it is not written — a second orchestrator does not exist yet, and a rule
  with one subject is a rule written against a hypothesis.
