---
description: UNIFIED SURFACE — M2.5 (durability, lanes, a ceiling per lane, a dedup claim that releases). Prerequisite to M3.
---

# Workflow: M2.5 — the run path becomes load-bearing

Design intent: [`docs/UNIFIED_PACK_SURFACE.md`](../../docs/UNIFIED_PACK_SURFACE.md) **§5.2**, which is
normative for this run. Prior runs: ADR-061…066, and
[`docs/measurements/M0-run-overhead.md`](../../docs/measurements/M0-run-overhead.md).

> **Why now.** The run path is still a *secondary* path carrying development traffic. M3 makes it the
> only path, and everything tolerable at that status becomes load-bearing the same day. Three of the
> four items below have never bitten for one reason — a single instance on a happy path — which is
> also why the missing `FOR UPDATE SKIP LOCKED` never bit.

## §0 Prerequisite — reconcile the test count, before anything else

M1.7 reported **2 891** Java tests. M2 reports **2 687**. One test was deliberately deleted
(`test_without_audio_the_billed_rate_is_the_files_rate`). That leaves roughly **two hundred
unaccounted for**, and no `pom.xml` in M2's eight commits touches collection.

In a project where twelve IT suites, five Python tests, twenty-seven pack tests and six governance
rules each vanished silently, an unexplained deficit of two hundred is not a rounding difference.

1. Compare the two runs **per module**, not in aggregate.
2. If it is benign — a different command, a module not rebuilt, `-T 1C` aggregating differently — say
   so in one paragraph and continue.
3. **If any suite stopped being collected, stop. That is the run**, and the rest of this workflow
   waits.

## §1 Scope — four items, in this order

§2 the outbox on step dispatch · §3 lanes · §4 the per-lane ceiling · §5 the dedup claim · §6 `#46`.

Order matters: the outbox changes dispatch latency, lanes change the queue topology, and the ceiling
is defined per lane, so it cannot precede them.

**Out of scope, do NOT start** — deleting `MediaGenerationController`, `useBootstrapFeatures`, the
composer button row, or the `orazaka.*` key hole in `POST /api/v1/jobs` (M3); dropping the UI-manifest
columns or the two lying capability names `#44` (M4); the bypass rule (M5); the capability output
contract (§7); the seam-input audit. The twelve-plus open findings stay open and get relisted.

## §2 The outbox on step dispatch

`AmqpStepExecutionAdapter` calls `rabbitTemplate.convertAndSend` directly while
`RunSagaService.advance` is `@Transactional`. `JobQueuePublisherService` — the other producer — goes
through `outboxStore.append`, with AGENTS.md §6 cited in its own javadoc.

So the run path is the one place in Orazaka where a rollback after the send leaves a job running
against a step row that no longer exists. The hold lives in **another service** and is therefore not
rolled back with it: hold taken, run gone, worker burning the model, aggregate settle never called.

1. Publish step dispatch through the transactional outbox, like every other producer.
2. **Then re-run the M0 harness.** The instrument exists; use it to say what durability cost. M0
   measured p95 30.5 ms against a 250 ms threshold with door 1 paying a 500 ms relay poll the saga did
   not. Expect the two doors to come out at par, and **report the new number** — the decision does not
   change at three orders of magnitude of margin, but an unmeasured regression is how margin
   disappears.
3. The studio outbox publishes without `FOR UPDATE SKIP LOCKED`. It has never bitten because there is
   one instance. Say whether this run is the moment to fix it, and do it if it is one line here.

## §3 Lanes — separate queues and consumers, never AMQP priorities

`orazaka-job-service/worker.yaml` declares `bindings: ["job.media.*", "job.text.*"]` with
`concurrency: 2`. Two image generations occupy both slots and every text step waits — measured on this
machine at **p50 67 s for image against 4.9 s for vision**.

> `x-max-priority` reorders *waiting* messages at fetch and preempts nothing. With `prefetch=1` and a
> 67-second job in flight, no priority frees the consumer. Priority inside one queue solves the
> blocking only in the case where it does not occur. **Lanes are queues and consumers**, which
> `worker.yaml` has supported since ADR-038: a lane is a binding and a queue, not a subsystem.
>
> And lanes do not create a second GPU. They move the wait onto whoever asked for the long work — the
> right trade, but a **fairness property between tenants**, with no observable effect at one user.

Three constraints, all of them this project's existing principles applied again:

1. **Declared, not inferred.** A `latency_class` column on the capability row —
   `INTERACTIVE | BATCH`, naming the user's relationship to the wait rather than a rank, so nobody
   argues for a promotion. Populated from the durations already recorded in `orazaka_jobs`, not
   guessed. **Two classes, never three.** And a rule must redden when a capability's declared class
   contradicts the queue its routing key feeds, or the column is documentation — exactly the defect
   `billable_unit NULL` was, and which M2's pricebook assertion closed for that column.
2. **A pack does not choose its own lane freely**, or everything is `INTERACTIVE`. Same principle as
   *a blueprint is untrusted input even from an admin*.
3. **No scheduler.** No fair-share, no ageing, no weighted round-robin. Two queues, two consumer pools.

## §4 The ceiling, per lane

`RunSweeper` reaps on `s.started_at < now() - make_interval(secs => ?)` against one global
`run.step-timeout-seconds`, and `started_at` is stamped when the step row is inserted — **at dispatch,
before any worker takes the message**. Queue wait therefore counts against the deadline.

One number must then be large enough not to reap a 67-second image that queued, and small enough to
catch a 200 ms text step that hung. Today the contradiction is invisible because there is no
contention. Once the queue genuinely fills, a legitimately-queued image job gets reaped: run `FAILED`,
hold released, worker still burning the Neural Engine for a run that is already dead. **That is a
correctness consequence, not a latency one.**

A ceiling per lane dissolves it. While you are here, `#34` (a timeout that does not cancel execution)
and `#33` (a protected job never reaching terminal is never purged) both live on this seam — **say
whether they are closed by this change or merely adjacent**, and do not silently widen scope.

## §5 The dedup claim that is never released

`JobSettlementListener:49` — `if (!messageDedupService.claim(CONSUMER, messageId))` — claims by
`INSERT`, and nothing removes the claim when the handler fails afterwards. Redelivery finds the claim,
skips, and **the settlement is lost forever: work done, never billed.** This is "claimed atomically,
never released", the exact trade the dedup work already identified once — double-processing swapped
for silent loss.

1. The natural fix is that the claim and the work share one transaction, so a rollback undoes both.
   Check whether the listener is transactional and whether everything it calls is local; if anything
   crosses a service boundary, the transaction is not enough and you must say what is.
2. **There are five `MessageDedupService` implementations** — billing, knowledge, automation, studio,
   and the shared one in persistence. Check each for the same shape. Fixing one is how this defect
   family has survived: the audit already found five copies of one rule with three authors wrong.
3. The class javadoc says "releases it". Verify what that sentence refers to. Four comments in this
   codebase have now asserted something false about a control.

## §6 `#46` — a fallback that trades billing for availability, silently

A provider refusing `verbose_json` is retried without it; the job then settles unmeasured and the hold
is released. That is silent free inference.

**Reuse `UnmeteredTurn`.** M1.7 solved exactly this for `#25`: the turn is served, the event is
recorded, and if the record fails the turn is refused. Do not invent a second mechanism — the last two
runs both improved by copying a pattern that already existed in the repository (`JobListener`'s
namespaced merge, and this).

## §7 Named, deliberately not acted on

**The capability registry declares inputs and not outputs.** `payload_template` is data, so
`BlueprintFitnessTest` can check a step's inputs against it; output shapes live in a hand-written
table, which is why that table said `orazaka.core.media.audio` publishes `url` — transcribed when the
row was still called "Audio Generation".

The consequence is larger than one wrong row: a blueprint chains steps by `{{steps.<out>.<field>}}`,
so **every link in every DAG references an output field that nothing declares and nothing can check**.
`#43` is the same gap from the other end — the assembler declares seven inputs and implements two, and
the new rule cannot see it because it checks the opposite direction.

This belongs to M4, with the registry cleanup. It is recorded here so it does not evaporate between
phases.

## §8 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | 100% local. No CI, no cloud. |
| AGENTS.md §4 | `latency_class` is a **row**, like `routing_key` and `billable_unit`. |
| AGENTS.md §6 | The wire format does not change. Lanes are bindings and queues, not a new grammar. |
| **Lanes, not priorities** | §3. `x-max-priority` is not a solution to a busy consumer. |
| **Build-breaking defects fixed on sight** | The amendment M1.8 earned. |
| **Copy the pattern that exists** | §5, §6. Two runs in a row improved by doing this. |
| **Every new rule or contract seen failing** | Plant, paste, revert. |
| **No repairs in passing** | Record for M3's report. |

## §9 Before declaring done

1. §0 answered first, in its own paragraph, before any other work is described.
2. `./mvnw -o clean install` green with all `*IT`; Python, CLI, web green; `spotless:check` bound.
   **State the Java test count and its delta against 2 687.**
3. Every control from every previous run: active, green, **diff empty** unless deliberately extended.
4. §2.2: the re-measured overhead, with the number.
5. §3: the lane rule seen red on a capability whose declared class contradicts its queue.
6. §4: whether `#33` and `#34` are closed or adjacent.
7. §5: the five dedup implementations, each with its verdict.
8. Open findings relisted in full. None quietly lost.
9. **Commit if green. Never push.**

## §10 Next — M3, the irreversible one

Delete `MediaGenerationController`, `MediaAnalysisController`'s generation paths,
`useBootstrapFeatures`, `executeFeature`, the composer button row; move CLI and mobile onto the run
API. `/api/v1/media/analyze/upload` **stays** — uploading an asset is not a capability invocation.
Closing door 1 also closes the `orazaka.*` key hole and `#32`'s remainder.

Then M4 (drop the UI-manifest columns, the two lying names `#44`, and the output contract of §7) and
M5 (the rule that stops the bypass reopening).
