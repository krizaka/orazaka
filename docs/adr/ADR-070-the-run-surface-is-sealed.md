# ADR-070 — The run surface is sealed

- **Status**: Accepted
- **Date**: 2026-09-22
- **Scope**: `products/orazaka` — `orazaka-libs/orazaka-test-support` (new `RunSurfaceRules`,
  `RunSurfaceRulesTest`), seven `*GovernanceTest` suites.
- **Milestone**: M5 of [`docs/UNIFIED_PACK_SURFACE.md`](../UNIFIED_PACK_SURFACE.md) — the last of the
  sequence. Predecessors: ADR-061…069.

---

## 1. Why a rule and not a test

M3 closed door 1 and then planted a restored direct controller to check its own work.
`DoorOneControlsIT` **stayed green**. It asserts what the run path produces — a run row, a data
class derived from the pack, an audit line, one aggregated settlement — and a second door cut beside
the first disturbs none of that.

**A test of what the correct path does cannot detect an additional incorrect path.** Absence is not
assertable by sampling presence. `DoorOneClosedTest` was written in M3 as the missing half, scoped to
one service and naming its own javadoc successor. This is that successor.

## 2. The property

> Every capability invocation reaches the broker through a run.

Concretely: **no inbound HTTP entry, in any module, may reach the job plane except through the run's
own dispatch seam.** A capability invoked over HTTP without a run carries none of a run's controls —
no data class from its pack, no retention by that class, no audit trail, no scope guard. That is what
door 1 *was* (ADR-068 §5), not an implementation detail of it.

## 3. The sinks are derived, and the derivation was wrong four times

`DoorOneClosedTest` names two sinks: `JobService.createJob` and `JobQueuePublisherService.publish`.
A hand-written list is `BlueprintFitnessTest`'s output table again — correct until someone adds a
third publisher, and silently wrong after. So the sinks are derived from what actually publishes.

The derivation is in two halves, both read from source:

1. **How the exchange is named** — every `String` constant declared equal to `orazaka.jobs`
   contributes its own name, so a service that spells it in its own `AmqpConstants` is found without
   the rule knowing that class exists.
2. **What dispatching is** — a class that still mentions one of those names *after its declarations
   are removed* is handing the exchange to something, and handing the jobs exchange to something is
   what dispatching onto it is.

**Writing that second half took four corrections, and each was found only because the next thing
broke:**

| the derivation said | what it missed |
|:---|:---|
| a verb list: `convertAndSend`, `OutboxMessage` | the studio adapter's verb is `appendCommand` — the transcription defect, *inside the rule written to avoid it* |
| the same scan, on raw source | it matched `convertAndSend` in a **comment** saying what had been replaced — M4's Python-docstring failure, one language over |
| any class naming the exchange | the governance rules name it in prose to say what they check, and counted themselves |
| any dispatcher is a sink | the run's own seam is a dispatcher, so the rule's **first verdict was that `StudioRunController.start` — the correct path — was door 1** |

The fourth is the one worth keeping. A rule that forbids reaching the broker forbids the run, unless
it can say what "through a run" means structurally.

### 3.1 What "through a run" is, structurally

The run dispatches a step through `StepExecutionClient`, whose argument is a `StepDispatch`
carrying the `runId`. **The type makes a run impossible to omit.** A controller that reaches that
adapter has a run behind it because it could not have built the argument otherwise; a controller
that reaches any other dispatcher does not.

So the seam is named and everything else is derived, and **the asymmetry is deliberate**: sinks grow
— a third producer arrives and a transcribed list is quietly wrong — while the run seam is
architecturally singular. Naming it with its reason is the declared-exemption pattern the brief
mandates, not a list. A new publisher does not implement that port, so it is caught.

## 4. The population this rule examines

**Every production class on the module's classpath that Spring exposes as an inbound HTTP entry** —
annotated `@RestController` or `@Controller`, or carrying any `*Mapping` method annotation — **and
that is the same population the property is about, because door 1 was a transport entry that
dispatched a capability with no run behind it.**

The subjects are taken from the *annotations*, never from a package name. `DoorOneClosedTest`
matched `..infrastructure.adapter.rest..`; a controller landing anywhere else — which [ERR-130]
permits nowhere but which a rule may not assume — would have been invisible to it while being just
as reachable over HTTP. This is [CFG-001]'s mistake in the other direction: precise about
non-private constructors while the container counted every declared one. Proven, not asserted: the
plant was moved to `com.orazaka.jobservice.web` and the rule still found it (§6).

**The vacuity guard is separate and was earned.** The rule's first wiring reported green in
`orazaka-job-service` having examined **zero** sinks — [PACK-001]'s shape, in the run that exists to
prevent it. Now: the repository-wide dispatcher set must be non-empty; the module's subjects must be
non-empty; and if the module's classpath carries a dispatcher, at least one must survive to be
judged, because a class whose source dispatches and whose bytecode shows nothing means the
derivation has rotted. A module whose classpath holds no dispatcher at all returns early, and that
is a true pass rather than a vacuous one: services are separate processes, so a controller cannot
reach another app's class, and a classpath with no dispatcher is a module where the property holds
by construction. The day it gains one, the check bites with no edit.

## 5. Why source and not bytecode

`javac` inlines a `static final String` compile-time constant into its call site, so
`MessagingContract.JOBS_EXCHANGE` leaves **no** reference to `MessagingContract` in the caller's
bytecode. The jobs exchange and the events exchange are indistinguishable to a bytecode-only rule —
and telling them apart is the whole rule, since `AgentController` publishes agent presence to the
events exchange from a `@RestController` and is not a bypass. Reachability is still computed over
the bytecode, transitively, where the call graph actually is: `DoorOneClosedTest` needed a second
test for the delegate case, and a rule that only saw direct calls would be one indirection from
useless.

## 6. What the rule found, and in what order it was made to fail

**Against the repository as it stands, it finds nothing.** Door 1 is genuinely shut: across the
seven suites, the only path from an HTTP entry to the job plane is the one declared exemption. That
is a result, and it is stated rather than implied.

It was made to earn that. With the exemption removed, the rule reports exactly one path and no
other:

```
com.orazaka.conversationservice.infrastructure.adapter.rest.JobController.approveJob
      → com.orazaka.conversationservice.application.service.JobQueuePublisherService.publishApproval
```

So the exemption is load-bearing rather than decorative, and the service that carried door 1 has one
remaining route to the job plane, which is the gate.

Then the plant, **in `orazaka-job-service`, which `DoorOneClosedTest` never covered** — a third
producer with its own controller, which is precisely the case the derived sink set exists for:

```
[DOOR-001] an HTTP entry that reaches the job plane is door 1 coming back.
  com.orazaka.jobservice.infrastructure.adapter.rest.PlantedMediaController.generate
        → com.orazaka.jobservice.application.service.PlantedDispatchService.dispatch
```

Moved to `com.orazaka.jobservice.web`, outside any `adapter.rest` package, it is still found:

```
  com.orazaka.jobservice.web.PlantedMediaController.generate
        → com.orazaka.jobservice.application.service.PlantedDispatchService.dispatch
```

Reverted, green. One service passing is not a repository passing, which is why the plant went where
the old rule could not see.

## 7. The exemptions, each carrying its reason

- **`JobController#approveJob` → `JobQueuePublisherService`.** Approval is a **gate in front of work
  already written**, not a way in: the job row and its payload were written when the automation ran,
  and the endpoint releases it. M3 established this the hard way — the compiler refused to delete
  `JobQueuePublisherService` because this path still needed it.
- **`orazaka.core.chat.completion` is not exempted, because it is never a subject.** It is
  synchronous and off the broker by contract (AGENTS.md §6), reaches no dispatcher, and the rule has
  nothing to say about it. It is named so the next reader knows the omission was decided rather than
  overlooked.

Neither is a suppression. An exemption is a caller and a dispatcher with the reason beside them in
the rule, and a new one costs its author that paragraph — *an exemption that is a list entry with no
reason is how the next one gets added in silence.*

## 8. Static, deliberately

No part of this rule runs a stack. The e2e harness that would be the obvious place to prove a door
stays shut has just been found to leave its stack up on a red build, to lose a contract assertion
without reporting it, and to have never exercised entitlement at all (ADR-069 §0.3, §6). **It is the
least-verified component in the repository**, and a rule about a door that must never reopen cannot
be carried by it.

## 9. Open findings, relisted in full

**Closed by this run**: nothing — M5 adds a control and repairs no defect, because the repository
was already clean of the thing it forbids.

**New, found while wiring it**: 🟡 **the generated governance registry says `none` for a rule that
is enforced.** `docs/_generated/GOVERNANCE.md` attributes call sites per method *name* and cannot
tell two overloads apart, so every family that offers a no-arg convenience beside a
`JavaClasses` variant renders the convenience as "Enforced by **none**" — `[CFG-001]` twice,
`[EXEC-001]`, `[EXEC-002]`, `[ERR-130]`'s support-package rule, `[LOG-001]`, and now `[DOOR-001]`.
AGENTS.md §10 makes that column a finding when it reads `none`; seven false ones train the reader to
skip it, which is the same decay as an assertion that never runs. Not repaired here — it is the
generator's, not this rule's.

**Still open, none closed in passing**: `#19` (the M2M JWT — a deployment blocker), `#29` (`pypdf`
undeclared), `#33` (a protected job that never reaches terminal is never purged), `#34` (a timed-out
execution is not cancelled), `#36` (dead-letter queues nothing consumes), `#37` (worker-routed
Studio steps have no job row), `#38` (STANDARD jobs have no window in the job plane), `#39`
(`purgeJobsByUserId` leaves directories), `#40` (`studio_outbox` never purged), `#41` (`dataClassOf`
reads an unknown studio as STANDARD), `#42` (automation connector jobs carry no data class), `#47`
(two automation notification listeners cannot fail today, so their dedup claim is safe by accident),
plus the eleven of [ADR-069](ADR-069-the-registry-declares-what-it-runs.md) §6.

## 10. What is left is not a continuation of this sequence

`UNIFIED_PACK_SURFACE.md` closes here. The deployment block (`#19`, Flyway before the first real
data row, PITR with a restore drill actually performed, an edge read timeout and circuit breaker,
rate limiting on identity/billing/studio), the **seam-input audit** — four seams opened for
open-core, one examined and it had the defect, and that one is due *before any third-party pack is
installed* rather than before a phase — the harness's three 🔴, and the open findings above: each is
a decision, not a next workflow.
