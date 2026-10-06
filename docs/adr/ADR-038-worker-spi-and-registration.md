---
title: "ADR-038 — Worker SPI: the AMQP contract as the extension point, with advisory registration"
description: "Why the executor SPI was un-sealed into a Tier-1 JobExecutor discovered through AutoConfiguration.imports, why the real extension point is the AMQP protocol rather than that interface, why worker registration is advisory and never authorising, and how the two dispatch discriminants — routing_key and handler_key — are each guarded."
category: ADR
order: 38
---

# ADR-038 — Worker SPI: the AMQP contract as the extension point, with advisory registration

- **Status**: Accepted
- **Date**: 2026-08-30
- **Scope**: `products/orazaka` — `orazaka-jobs-api` (`JobExecutor`, `JobExecutionContext`,
  `JobExecutionResult`, `JobExecutionException`, `WorkerRegistration`); the six executors and
  `JobListener` in `orazaka-job-service`, plus `JobExecutorAutoConfiguration`,
  `ExecutorCoherenceService`, `WorkerRegistryService`, `WorkerController`,
  `WorkerHeartbeatSweeper`; `worker_registry` and `billable_capability` in
  `infra/initdb/30-jobs-config.sql`; `worker.yaml` in the job service and the media worker;
  `app/registration.py` and `app/consumer.py`; `ExecutorCoherenceRules` in `orazaka-test-support`;
  `docs/WORKER_PROTOCOL.md`.
- **Extends**: [ADR-037](ADR-037-pack-spi-and-open-core.md) — which closed S1 and stated this
  orientation without yet implementing it.
- **Implements**: `docs/PACK_EXTENSIBILITY_ARCHITECTURE.md` §2.2, §2.3, §3.3 (S2, S3), §3.4 — phase C.
- **Supersedes**: the Proposed version of this record, which named the problem and deliberately
  decided nothing.

## Context

`JobExecutionStrategy` was package-private **and** `sealed`, permitting exactly the six strategies
that ship here. Adding an executor meant editing a file in this repository and recompiling the core:
a cloud-only pack could not add one, a third party could not add one, and an open-core split was
structurally impossible because every commercial pack would arrive as a core patch — a fork, whatever
it was called (design §2.2).

The irony recorded in ADR-037 stands: Orazaka had already solved discovery once. `orazaka-interceptors`
ships an `AutoConfiguration.imports` SPI with seven registrations, and AGENTS.md §2 makes it a rule
[ERR-122]. The job plane never got the same treatment.

## Decision

### 1. The extension point is the AMQP contract, not a Java interface

`docs/WORKER_PROTOCOL.md` is published as a versioned specification: envelope, routing grammar,
outcome events, consumption reporting, idempotency, DLQ naming, registration, and a conformance
checklist. **A worker is anything that honours it.**

This is not aspiration — it is already true. `orazaka-worker-media` is Python, links no Orazaka
library, and participates fully. Writing the contract down changes nothing about how the system runs
and everything about who can join it.

The consequence is deliberate and inverts the obvious reading of "SPI": **the Java `JobExecutor` is a
convenience**, for executors cheap enough to run in-process. It is not the mechanism. The broker is
the plugin boundary, which is also what stops a badly-behaved third-party worker taking the platform
down with it — a guarantee no in-process interface can offer.

### 2. `JobExecutor` is Tier-1, and does not carry the engine's `Context`

The port is `String handlerKey()` plus
`JobExecutionResult execute(JobCommand, JobExecutionContext)`, in `orazaka-jobs-api`.

The signature could not take the engine's `Context`: that type lives in `orazaka-core` (Tier-2) and
carries an engine `Authority`, so a Tier-1 port referencing it would put the whole engine on the
classpath of every out-of-tree executor. Phase C's workflow anticipated this and said to pass the
fields the executors actually use instead — and the investigation produced a sharper answer than
expected: **not one of the six reads a field from `Context`.** Four forward it whole into an
`AiClient` request; two ignore it entirely.

So the *shape* travels and the engine type does not. `JobExecutionContext` carries `actorId`,
`correlationId`, `preferences` and authority **names**; `ExecutionContextMapper` translates it back
into an engine `Context` inside the job service, at the boundary, once — the anti-corruption layer
[ERR-127] asks for.

Two further consequences of tier purity: `JobExecutionException` moved into Tier-1, because an
out-of-tree executor must be able to throw it; and the shared `extractFileBytes` helper left the
interface for a package-private `MediaJobExecutor` base class, because **a Tier-1 port must not do
file I/O.**

### 3. Discovery is `AutoConfiguration.imports`, exactly as interceptors do it

A jar on the classpath carrying its own imports file contributes a `JobExecutor` with no edit to
this repository. `JobListener` injects `List<JobExecutor>` and refuses to start on a duplicate
`handlerKey` — a check that mattered more once the SPI opened, since the collision can now come from
a jar nobody here reviewed.

The six in-repo executors remain component-scanned rather than declared in
`JobExecutorAutoConfiguration`. Moving them would have required widening `ModelResolver` to public
purely to satisfy a wiring class — the encapsulation leak [ERR-110] exists to prevent — and Spring
collects every `JobExecutor` bean into one list regardless of origin, so an in-repo executor and an
out-of-tree one are indistinguishable to the listener. The phase workflow is explicit that the
criterion is out-of-tree discovery, "not the mechanism".

### 4. Registration is advisory, never authorising

`worker_registry` records what each worker declares and when it was last heard from;
`WorkerHeartbeatSweeper` marks silent workers `STALE`. **Dispatch never consults it.** A capability's
`routing_key` alone decides where a job goes.

A worker that cannot reach the job service registers in the background, retries, and **keeps
consuming**. Making registration a precondition would mean a worker perfectly able to serve traffic
stops serving it because a side-channel was down — an observability feature converted into an
outage.

Nothing reads `status` in this phase. Phase F does, turning it into availability a user can see. It
is recorded now so that behaviour is a read rather than a migration, exactly as `regulatory_class`
was placed empty in ADR-036.

### 5. Two dispatch discriminants, two guards

Routing became data in ADR-037, which left every capability with two independent discriminants that
fail differently:

| Discriminant | Picks | Failure | Guard |
|:---|:---|:---|:---|
| `routing_key` | the **process** | message sits on a queue nobody drains | **[EXEC-002]** every routing key is covered by some `worker.yaml` binding |
| `handler_key` | the **code path** inside it | message arrives correctly and dies there | **[EXEC-001]** every in-process capability's handler key has an executor |

[EXEC-001] is **scoped to capabilities routed to a JVM service**, and that scope is the point: a
worker dispatching on the routing key alone has no use for a handler key. Demanding one would fail
the build on `video.generate` and `media.compose` — the two capabilities that best demonstrate the
AMQP contract being the real SPI. The scope is read from the repository's own taxonomy
(`orazaka-apps/services/**` versus `orazaka-apps/workers/**`, AGENTS.md §2) rather than a hard-coded
name.

[EXEC-002] is **binding-based, not family-based**, because `worker_family` proved too coarse to
answer the question: phase A seeded `family=media` across three routing keys spanning two processes.
Family is a descriptive label; bindings are the exact answer. `ExecutorCoherenceService` covers at
runtime what the build cannot see — a row an operator added last night, and a jar that failed to
load.

### 6. The route cache is event-invalidated, with the TTL as a floor

ADR-037 shipped `HttpCapabilityRoutingAdapter` with a TTL and reported the gap: the config-change
event the design assumed **did not exist**, so `is_enabled = false` was an eventual kill switch,
dispatchable for up to a minute. Acceptable while the only cost is money; not acceptable for a
`REGULATED` pack that must stop the instant it is withdrawn (phases I/J).

`evt.capability.changed` now travels on `orazaka.events`, published through the transactional outbox
in the same transaction as the row write — a dual write would let the row change without the
announcement, which is the same stale-cache bug one layer down. The studio service evicts on arrival.
The TTL remains as the floor for a dropped eviction.

## Alternatives rejected

**`ServiceLoader`.** A second discovery mechanism beside the one the codebase already uses, and one
that cannot inject: every executor needs engine ports and Spring already owns their lifecycle. It
would buy framework-independence the platform does not want and pay for it with a parallel wiring
story.

**Classpath scanning.** Discovery by accident. It finds abandoned classes, test doubles and
half-migrated code as readily as executors, and it fails at the worst moment — when someone shades a
jar. `AutoConfiguration.imports` requires an author to *declare* an intention, which is why the
interceptors use it.

**Making the registry authoritative for dispatch.** Rejected on the failure mode: it converts "the
job service could not be reached for a moment" into "this worker stops serving traffic it can
serve". Availability signals must not become permissions.

**Requiring a Java executor for every capability.** Would have failed the build on the Python
worker's two capabilities, i.e. on the evidence for the whole design. Scoping [EXEC-001] to
in-process execution is not a weakening; it is the rule finally saying what it means.

## Consequences

- An out-of-tree jar contributes an executor with no edit here. A worker in any language contributes
  by honouring a published protocol.
- `JobExecutionException` changed package, so the free-text `error` field of a failed job now
  contains `com.orazaka.jobs.domain.exception.JobExecutionException` rather than the old
  service-local name. No wire *shape* changed; the string did.
- `billable_capability` joined `orazaka_capabilities`, so the money path reads a row instead of a
  `contains()` chain. Values are transcribed from that chain, including one that is **wrong**:
  `orazaka.studio.media.compose` bills as `CHAT`. Correcting it is now a one-row `UPDATE`, and the
  consequence — compose runs pricing against the `VIDEO` pricebook row — is stated rather than
  slipped in.
- The conversation service's own routing chain is gone. It refuses an unroutable capability at
  submission rather than publishing to the text queue, which makes two **pre-existing** defects
  visible immediately: `orazaka.core.media.speech` and `orazaka.core.media.video.analysis` are
  submitted by controllers and have no capability row at all. They were already failing at dispatch;
  they now fail at submission, where the caller can see why.
- `worker_family` is documented as descriptive. Phase F should read bindings.

## References

- [`docs/WORKER_PROTOCOL.md`](../WORKER_PROTOCOL.md) — the contract this ADR makes normative
- [ADR-037](ADR-037-pack-spi-and-open-core.md) · [ADR-033](ADR-033-credit-metering-and-billing.md) ·
  [ADR-035](ADR-035-service-to-service-authentication.md)
- `docs/PACK_EXTENSIBILITY_ARCHITECTURE.md` §2.2, §2.3, §3.3, §3.4, §6
