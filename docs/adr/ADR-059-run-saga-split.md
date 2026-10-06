---
title: "ADR-059 — Splitting RunSagaService by what leaked, not by how long it was"
description: "Eight invariants in one author. Two are separated — the one that already cost 475 credits, and the one positioned identically. The other six stay, because splitting them would create the seam the first defect lived in."
category: ADR
order: 59
---

# ADR-059 — The saga split

- **Status**: Accepted
- **Date**: 2026-09-11
- **Scope**: `RunSettlementService` (new), `StepDeclarationService` (new), `RunSagaService`,
  `StudioRunService`, `RunSweeper`, `GovernanceRules` — `[SAGA-001]`, `[SAGA-002]`
- **Method from**: [ADR-057](ADR-057-one-capability-model.md) and
  [ADR-058](ADR-058-no-service-kit.md). Those asked *one invariant, how many authors*. This asks
  the mirror: **one author, how many invariants**

## 1. The enumeration

Eight, not the seven that were listed. Each stated as *what is true when a transition ends*, with
who depends on it.

| # | Invariant | Depended on by |
|:--|:---|:---|
| 1 | **DAG advancement** — a step runs only when everything it depends on has succeeded, and one outcome advances the run once | the whole class |
| 2 | **Scope construction** — a step's templates resolve against the run's inputs, the installation's config and the outputs of finished steps | dispatch, transform, the run's outputs |
| 3 | **Fan-out** — a fan-out step has one row per item and is done only when every instance is | advancement, step state |
| 4 | **Step persistence** — a step's outcome is written once; a redelivery applies neither | advancement |
| 5 | **Outbox emission** — a terminal transition emits exactly one event | subscribers |
| 6 | **Terminalisation** — a run reaches a terminal state once, and its steps are cancelled with it | settlement, the audit trail |
| 7 | **Settlement** — a run's hold is closed exactly once: settled at the sum measured, or released | billing, the sweeper, cancel |
| 8 | **Pack declaration transport** — a dispatched step carries what its pack declared, and the engine supplies no subject of its own | the two guards, in another service |

The eighth was not on the list because it did not exist when the list was written. It arrived over
[ADR-051](ADR-051-sensitive-controls.md), [ADR-055](ADR-055-regulated-controls-and-the-wellbeing-pack.md)
and their follow-ups, and it is most of the growth: 751 lines at the ADR-041 fix, 997 before this
change, with a 123-line block of pack lookups among the additions.

## 2. Has the concentration already cost? Yes, once, and exactly at a seam

**Not the defect that was expected.** ADR-044's double billing — the per-turn hold taken by
`EntitlementInterceptor` while the run also settled — did **not** live here. Its fix landed in
`AmqpStepExecutionAdapter`, as a declared marker on the wire. That was a seam between two services,
not a concentration inside one class.

**The one that did live here is [ADR-041](ADR-046-asset-lists-and-failed-run-settlement.md)'s**, and
it is precisely a contamination between invariant 1 and invariant 7:

> `RunSagaService` passed `run.holdId()` into every `StepDispatch`, so the run's hold travelled in
> each step's job payload. The first step to finish settled the entire run — priced against the
> hold's own `AGENT/CALL` rate, quantity hardcoded to 1. **480 credits reserved, 5 debited.** Every
> later step then found the hold closed.

That is what concentration produces. Not a class that is too long — a **method that reaches for a
fact belonging to a different rule because it happens to be holding it.** The method was building a
step's payload and had the run's billing identity in scope, so it used it.

**And invariant 8 is standing in exactly the same place.** `dispatch()` had grown four pack lookups
— the refused domain, the crisis terms, the reviewed reply, the user's own words — all ferried by
the method that advances the DAG, for the same reason `holdId` was. They are correct today. They
are correct in the way `holdId` was correct for three phases.

So the answer to *"one defect, and it is corrected"* is: **one defect, corrected, and a second
invariant sitting in the position that produced it.** That is enough to act, and only on those two.

## 3. What was split, and what was not

**Split — invariant 7.** `RunSettlementService` is the sole author of closing a run's hold. It had
**three**: the saga settled, `StudioRunService` released on cancel, `RunSweeper` released on sweep.
All three now call it, so there is one place to read to know when a run stops costing money.
Opening the hold stays at run creation — moving it would add a second concern to satisfy a symmetry
nobody needs, and the question that had three answers was *when does it close*.

**Split — invariant 8.** `StepDeclarationService` is the sole author of what a dispatched step
carries from its pack.

**Not split — invariants 1 to 6.** They are one thing: what is true after a transition. They read
each other's state by construction, and separating them would create seams between them. The one
defect this class has produced lived at a seam. Splitting a coherent invariant into two services to
reach a line count would be buying more of exactly what cost 475 credits.

A class of 886 lines carrying six invariants that need each other is not the same object as one
carrying eight of which two are passengers.

## 4. The rules

- **`[SAGA-001]`** — only `RunSettlementService` calls `settle` or `release`.
- **`[SAGA-002]`** — only `StepDeclarationService` reads `pack.scope_guard` or `pack.safety` **for a
  dispatch**. The installer is exempt and the exemption is the interesting part: it reads the same
  columns to answer *may this pack install in this region*, which is not a dispatch carrying a
  declaration. A rule that conflated them would force the installer through a dispatch-shaped
  service to ask something dispatch has no opinion about.

Both confirmed to fire by name, with compilable violations.

## 5. What the naming rule caught

The new class was first called `StepDeclarations`. `[ERR-129]` failed the build: `application/service`
holds only `*Service`. The rule was right, and it is worth recording that the rename was forced by a
rule written for a different reason — a class that is not a service does not belong in that package,
and the one being added is a service.
