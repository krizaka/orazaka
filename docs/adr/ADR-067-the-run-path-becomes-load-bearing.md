---
title: "ADR-067 — The run path becomes load-bearing: a durable dispatch, two lanes with two consumer pools, a ceiling per lane, and a dedup claim that is given back"
description: "M2.5, the prerequisite to M3. Step dispatch moves into the transactional outbox, so a rollback can no longer leave a worker running against a step row that does not exist. Lanes are queues and consumers keyed on a declared latency_class, never AMQP priorities. The sweeper's ceiling is per lane because queue wait counts against a deadline stamped at dispatch. And the dedup claim is released when the handler fails, in the five consumers that kept it."
category: ADR
order: 67
---

# ADR-067 — The run path becomes load-bearing

- **Status**: Accepted
- **Date**: 2026-09-16
- **Scope**: `AmqpStepExecutionAdapter`, `OutboxService`, `OutboxRelay`, `studio_outbox`;
  `MessagingContract`, `JobsTopologyConfig`, `JobListener`, `worker.yaml`, `orazaka_capabilities`;
  `RunSweeper`, `RunSagaService`, `studio_run_step`, `studio_runtime_config`; `CapabilityRoute`,
  `CapabilityDeclaration`, `CapabilityRegistryService`; `JobSettlementListener`,
  `JobOutcomeListener`, `SubscriptionChangeListener`, `ConnectorOutcomeListener`,
  `RagIndexListener`; `LaneCoherenceRules` [LANE-001]
- **Implements**: M2.5 of [`UNIFIED_PACK_SURFACE.md`](../UNIFIED_PACK_SURFACE.md) §5.2
- **Closes**: audit #30, #46
- **Follows**: [ADR-066](ADR-066-media-becomes-a-pack.md)

## 0. The gate: 2 891 → 2 687 reconciled before anything else

M1.7 reported 2 891 Java tests and M2 reported 2 687. Compared **per suite**, across the two build
logs: **2 891 over 540 classes** then **2 941 over 547**. Not one suite stopped being collected. The
arithmetic closes exactly — 7 new suites (23 tests) and 14 suites that grew (27 tests) — and the
deficit was **my own reporting error**: the sum was taken with a grep anchored on `^[INFO]`, and
Maven prints a module's totals line as `[WARNING]` when that module has a skipped test.
`orazaka-conversation-service` has one (`OllamaStreamTest`), so its **254 tests** were dropped from
the total. 2 687 + 254 = 2 941. The number in M2's report was wrong; nothing was lost.

## 1. §2 — the dispatch is durable with the state that describes it

`AmqpStepExecutionAdapter` called `rabbitTemplate.convertAndSend` from inside `RunSagaService.advance`,
which is `@Transactional`. It was the one producer in Orazaka publishing straight from a transaction —
`JobQueuePublisherService`, the other one, has gone through the outbox with AGENTS.md §6 in its javadoc
all along.

**Why it is the worse half of the dual-write bug on this path.** A rollback after the send leaves a
worker executing against a step row that no longer exists, and the credit hold it took lives in the
**billing service**, where a rollback here cannot reach it: hold taken, run gone, accelerator busy,
aggregate settle never called.

`studio_outbox` gains `exchange` and `message_id` — the two columns `outbox_events` has carried all
along — `OutboxService.appendCommand` writes a dispatch in the caller's transaction, and the relay
publishes to the exchange each row names, with the `messageId` on the message properties, as raw JSON
bytes with a content type. That is the persistence relay's shape, copied rather than re-invented,
and the id is what the job service dedups a redelivery by.

`StepDispatchDurabilityIT` asserts both directions against the real `80-studio.sql`: a committed
dispatch leaves one row addressed to `orazaka.jobs`, unpublished, carrying the routing key and the job
id; a rolled-back one leaves nothing. **Plant** (the append written on its own connection, outside the
saga's transaction): `a job the run no longer knows about must never reach a worker — expected: 0 but
was: 1`. Reverted.

### 1.1 Measured, because the instrument exists

| | M0 (before) | M2.5 (after) |
|:---|:---|:---|
| Saga A+B, p95 | 19.7 ms / 30.5 ms (two runs) | **19.2 ms** |
| Saga A+B, p50 | 12.4 ms / 14.2 ms | **10.4 ms** |
| Statements | 37 (22 + 15) | **37 (22 + 15)** |

No regression, against a 250 ms threshold. **The harness stubs the executor**, so it cannot see the
adapter at all — the marginal cost of a durable dispatch is measured where it happens, in
`StepDispatchDurabilityIT`: **p50 0.85 ms, p95 1.21 ms, max 2.70 ms** for the append.

What a dispatch now waits for is the relay poll. Its interval drops **5 000 → 500 ms** to match door
1's, so the two doors are at par by construction: ≤ 500 ms, mean 250. The decision does not move at
an order of magnitude of margin, and an unmeasured regression is how margin disappears.

**§2.3's premise is stale.** The studio relay has had `FOR UPDATE SKIP LOCKED` since ADR-058 §3, with
the comment naming it. Nothing to fix.

## 2. §3 — lanes are queues and consumers, never priorities

`worker.yaml` declared `job.media.*` and `job.text.*` on one pool of two. Two image generations
occupied both slots and everything else waited. Measured on this machine **from `orazaka_jobs`, not
guessed**:

| Capability | n | p50 | p95 |
|:---|---:|---:|---:|
| `orazaka.core.media.image` | 4 | **67.1 s** | 100.5 s |
| `orazaka.core.media.vision` | 16 | **4.9 s** | 9.7 s |
| `orazaka.core.chat.completion` | 97 | **1.1 s** | 7.4 s |

> `x-max-priority` reorders *waiting* messages at fetch and preempts nothing. With `prefetch=1` and a
> 67-second job in flight, no priority frees the consumer — priority inside one queue solves the
> blocking only in the case where it does not occur.

`orazaka.jobs.interactive` (`job.text.*`, `job.media.analyze`) and `orazaka.jobs.batch`
(`job.media.generate`), each with its own DLQ and its own consumer pool
(`orazaka.jobs.lanes.{interactive,batch}-concurrency`). **No scheduler**: no fair-share, no ageing, no
weighted round-robin. RabbitMQ has no volume in `docker-compose`, so the renamed queues leave nothing
stale behind a broker restart.

**And the honest part: a second lane is not a second accelerator.** It moves the wait onto whoever
asked for the long work — a fairness property between tenants, with no observable effect at one user.

### 2.1 `latency_class` is a row, and two classes never three

INTERACTIVE and BATCH name **the user's relationship to the wait**, not a rank, so nobody argues for a
promotion. The rule that assigns them: *INTERACTIVE is work bounded by the model's own speed — a
turn, one image to describe, a sentence to speak; BATCH is work whose duration follows what the user
supplied or asked to produce.* Under it the two capabilities billed per source minute are batch by
construction, which is what `AUDIO_MINUTE` already says about them.

Image analysis moves to `job.media.analyze`: **one key cannot feed two queues**, and sharing
`job.media.generate` with generation is exactly what made the lane impossible. Same grammar
(`job.{capability}.{action}`), other action — the wire format is unchanged.

**A pack does not choose its own lane.** Its manifest has no field for it, `CapabilityDeclaration`
carries it as a read-only projection, and `CapabilityRegistryService` overwrites whatever a
registration sends with `BATCH`. The column's DEFAULT is `BATCH` too, and `SeedBootstrapIT` asserts
that: an unclassified capability waits where waiting is expected rather than blocking the queue
someone is sitting in front of. The five pack capabilities in the local database took it.

**[LANE-001]** (`LaneCoherenceRules`, wired in `JobServiceGovernanceTest`) reddens when a declared
class contradicts the queue its routing key feeds, reading the bindings from `MessagingContract`
rather than a second copy of them — that second copy is how `PUBLISHED_FIELDS` came to describe a
field no executor produces. A key no lane binds belongs to a worker's own queue and stays
[EXEC-002]'s question. **Plant** (image analysis left INTERACTIVE on the batch key):
`orazaka.core.media.vision declares INTERACTIVE and its routing key job.media.generate feeds the BATCH
lane`. Reverted.

## 3. §4 — a ceiling per lane, because queue wait counts against the deadline

`started_at` is stamped when the step row is **inserted** — at dispatch, before any worker takes the
message. One global `run.step-timeout-seconds` of 900 s was therefore 9× the measured p95 of an image
generation and 120× a chat step's: a hung interactive step sat for a quarter of an hour, and once the
queue genuinely fills a legitimately-queued image gets reaped — run `FAILED`, hold released, and the
worker still burning the accelerator for a run that is already dead. **A correctness consequence, not
a latency one**, which is why it is closed before M3 makes this the only path.

`studio_run_step` carries the lane it was dispatched into, stamped by the saga from the capability's
row rather than re-resolved later: the class that applies is the one the platform held when the work
was sent, so reclassifying a capability cannot move the deadline of a step already in flight. Two
rows replace the one: `run.step-timeout-seconds.interactive` **300 s** (30× the measured p95) and
`.batch` **1 800 s** (room for queue wait behind ~25 image generations at p50 67 s). **Plant** (both
lanes reading one ceiling): `Argument(s) are different! … at position [6]`. Reverted.

### 3.1 #33 and #34 are adjacent, not closed

- **#34 — a timed-out execution is not cancelled.** Untouched. The sweeper fails the *run*; the job
  service's `CompletableFuture` keeps running and can still write its output. The lane ceiling changes
  *when* the run is failed, not whether the work stops.
- **#33 — a protected job that never reaches terminal is never purged.** Untouched. The sweeper closes
  `studio_run`; `orazaka_jobs` belongs to another context and its retention waits for the job's own
  terminal state, which nothing sets.

Both stay open, and this run did not widen to them.

## 4. §5 — the claim is given back, in the five consumers that kept it

`JobSettlementListener` claimed by `INSERT` and nothing removed the claim when the handler threw
afterwards: the redelivery found it, skipped, and **the settlement was lost forever — work done, never
billed** (#30). That is the trade the dedup work already named once: a double-process swapped for a
silent loss.

The pattern existed three files away. `UnmeteredTurnListener` has carried claim → try → release →
rethrow since M1.7, so that is what the others carry now.

| Consumer | Verdict |
|:---|:---|
| `billing/JobSettlementListener` | **fixed** — local work; re-settling is safe on the ledger's idempotency key |
| `studio/JobOutcomeListener` | **fixed**, and what a transaction would *not* cover is stated: `applyOutcome` settles through billing over HTTP, so a failure after that call has already moved money; the aggregate settle's idempotency key is what makes the redelivery safe |
| `studio/SubscriptionChangeListener` | **fixed** — resume/pause set a state, safe to reapply |
| `studio/ConnectorOutcomeListener` | **fixed** — the step update is guarded by its status predicate |
| `knowledge/RagIndexListener` | **fixed** — ingestion is keyed by tool id and replaces what it wrote |
| `billing/UnmeteredTurnListener` | already correct — the source of the pattern |
| `automation/AutomationJobListener` | **correct as is, deliberately** — it converts every failure into FAILED telemetry and never throws; releasing would re-run a connector action, i.e. a second Slack message |
| `job-service/JobListener` | **correct as is**, same reason: every path ends in a terminal outcome. Its residual is a **crash** between claim and terminal, which no release can fix and which is #33's cause |
| `automation/Identity+PasswordNotificationListener` | nothing can throw today — the send is a log line |

**The five implementations all carry `release`; the defect was never in them.** It was in who called
them, which is exactly how this family survived being fixed once. The interface's javadoc — "claim by
INSERT … and `release` on failure" — describes the contract correctly; what was missing was its use.
**Plant** (the release removed from the settlement path): `Wanted but not invoked:
messageDedupService.release("billing-settlement", "amqp-1")`. Reverted.

## 5. §6 — #46, free inference is recorded rather than shrugged off

A provider that refuses `verbose_json` is retried plain (ADR-066), the job settles unmeasured, and the
hold is released. Silent free inference.

**`UnmeteredTurn` is reused, not re-invented.** M1.7 wrote it for exactly this question on the credit
gate: the work is served, the event is recorded, and billing collects it into `unmetered_turn` for
reconciliation. `JobListener` now records one for any completed job that **held credits** and reported
nothing its declared unit can price — judged with `ConsumptionReport` itself rather than a second copy
of its rules — and records it **before** marking the job complete, so a failure to record fails the
job instead of hiding it. That is the posture ADR-064 chose for the same question. **Plant** (the call
removed): `a free turn must be recorded, not shrugged off — expected: <1> but was: <0>`.

## 6. §7 — named, deliberately not acted on

**The capability registry declares inputs and not outputs.** `payload_template` is data, so a rule can
check a step's inputs against it; output shapes live in a hand-written table, which is why that table
said `orazaka.core.media.audio` publishes `url`. The consequence is larger than one wrong row: a
blueprint chains steps by `{{steps.<out>.<field>}}`, so **every link in every DAG references an output
field that nothing declares and nothing can check**. #43 is the same gap from the other end. This
belongs to M4 with the registry cleanup, and is recorded here so it does not evaporate between phases.

## 7. Found during M2.5 — for M3's report

1. 🟡 **`studio_outbox` published rows are never purged** (#40) and the table now carries one row per
   step dispatch as well as per event, so it grows faster. The persistence relay's `purgePublished`
   is the pattern; not copied here, because no repairs in passing.
2. 🟡 **Two automation listeners cannot fail today** — `IdentityNotificationListener` and
   `PasswordNotificationListener` "send" by logging, so their claim is safe by accident. The day a
   real sender lands there, the claim needs the release the others now have.

## 8. Open findings, relisted in full

**Closed by this run**: #30, #46.

**Still open**: #19 (the M2M JWT — a deployment blocker), #22-adjacent none, #29 (`pypdf` undeclared),
#33 (a protected job that never reaches terminal is never purged), #34 (a timed-out execution is not
cancelled), #36 (dead-letter queues nothing consumes), #37 (worker-routed Studio steps have no job
row), #38 (STANDARD jobs have no window in the job plane), #39 (`purgeJobsByUserId` leaves
directories), #40 (`studio_outbox` never purged — see §7), #41 (`dataClassOf` reads an unknown studio
as STANDARD), #42 (automation connector jobs carry no data class), #43 (compose implements two of its
seven declared inputs), #44 (two capability names that lie — M4), #45 (`orazaka-media` is written but
not installed), plus the two recorded above.

## 9. Migrations

- `infra/migrations/2026-09-16-studio-outbox-commands.sql` — `exchange` and `message_id`.
- `infra/migrations/2026-09-16-capability-lanes.sql` — `latency_class`, its values, and image
  analysis's routing key.
- `infra/migrations/2026-09-16-lane-ceilings.sql` — `studio_run_step.latency_class` and the two
  ceiling rows, replacing the single one.

All three applied to the local database.
