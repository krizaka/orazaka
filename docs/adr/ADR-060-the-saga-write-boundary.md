---
title: "ADR-060 — The saga's write boundary, and the dead code ADR-059 shipped"
description: "Re-measuring ADR-059's 'not split: 1 to 6' from the transitions instead of the file. Four of the six write nothing, which is a better reason to leave them than the one given. Also records the second settlement author that refactor left behind."
category: ADR
order: 60
---

# ADR-060 — The saga's write boundary

- **Status**: Accepted
- **Date**: 2026-09-12
- **Scope**: `RunSagaService`, `GovernanceRules` — `[SAGA-001]` strengthened, `[SAGA-003]` added
- **Corrects**: [ADR-059](ADR-059-run-saga-split.md), in two ways

## 1. First, a defect that run shipped

[ADR-059](ADR-059-run-saga-split.md) moved the settlement computation into `RunSettlementService`
and said so. **It did not remove it from `RunSagaService`.** The scripted edit cut one of two blocks
and failed silently on the second, leaving `meteredSteps` and `MeasuredRow` behind as dead code —
**a second author of the settlement computation, created by the run whose ADR says there is one.**

It compiled. All 2772 tests passed, because an uncalled private method compiles and nothing calls
it. `[SAGA-001]` did not catch it either: that rule checks for calls to `settle` and `release`, and
this copy called neither — it only computed.

Removed here, and `[SAGA-001]` now also fails on a second type that **computes** what a run
measured, which is settlement's other half. Verified against the file exactly as ADR-059 left it:
the strengthened rule names `RunSagaService` for it.

Scoping that addition found its own boundary. It first fired on `CreditLedgerService` in the
billing service, which prices a `MeteredStep` on the ledger's behalf — the counterparty executing a
settlement, not a second author of the studio's invariant. The rule is now confined to the studio
context, which is where "a run's hold closes once" is a rule at all.

## 2. The argument ADR-059 gave was too coarse

That ADR left invariants 1 to 6 together on the ground that they "are one thing … they read each
other's state by construction". Measured from the transitions rather than from the file:

| Invariant | Writes | Reads |
|:---|:---|:---|
| 1 — DAG advancement | **nothing** | — |
| 2 — scope construction | **nothing** | `studio_installation`, `studio_run_step` |
| 3 — fan-out | **nothing** | `studio_run_step` |
| 4 — step persistence | `studio_run`, `studio_run_step`, broker | `studio_run_step` |
| 5 — outbox body | **nothing** | — |
| 6 — terminalisation | `studio_run`, `studio_run_step`, hold, outbox, audit | — |

**Four of the six write nothing.** Deciding whether a step is ready, resolving a template, expanding
a fan-out and building an event body are pure functions of state. Only 4 and 6 mutate anything.

## 3. Which makes the conclusion right for a different reason

The defect this whole thread is about is a **write** defect. ADR-041 cost 475 credits when a method
holding the run's billing identity used it while building something else. **A method that writes
nothing has no identity to leak.**

So invariants 1, 2, 3 and 5 are not merely tolerable where they are — they are *structurally
incapable* of producing that failure. That is a stronger reason to leave them than "they need each
other", and it also says exactly where the next one could come from: **only between 4 and 6, the
two writers.**

It also reverses the shape of the answer. ADR-059 read as *"six invariants that are too entangled to
separate"*. The measurement says *"two invariants that write, and four that cannot hurt anyone"* —
and the first reading would have justified a split along the wrong line if anyone had pushed for
one.

**No third split.** Cutting the pure readers out would be splitting by *shape* rather than by what
has leaked, which is the same mistake as splitting by size wearing better clothes.

`[SAGA-003]` pins it instead: those sixteen methods write nothing. The day one of them starts
writing is the day this argument expires, and it would expire silently.

## 4. And the rule that checks the argument had the bug it warns about

`[SAGA-003]`'s first implementation located a method by matching its name followed by a parameter
list and a brace. That also matches a **call site**: `allTerminal(blueprint, stepStates(runId))) {`.
The rule read an `if` block, found no writes in it, and passed a planted violation.

The javadoc above it already said *"brace matching rather than 'until the next method', because a
rule that reads the wrong span either misses a violation or invents one, and both have happened in
this file."* I wrote that sentence and then shipped the failure it describes. It is anchored to a
member declaration now, and the planted violation fails by name.

Two defects in two runs, both in the machinery that was supposed to prevent defects, both found
only by planting a violation and checking the rule actually went red. **A governance rule that has
not been seen to fail is a rule with no evidence behind it**, and that is now the third time this
thread has paid to learn it.
