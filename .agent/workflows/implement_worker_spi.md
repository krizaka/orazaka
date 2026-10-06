---
description: PACK SPI — PHASE C (un-seal the executor, register workers, publish the wire protocol)
---

# Workflow: Phase C — the worker SPI

Design intent: [`docs/PACK_EXTENSIBILITY_ARCHITECTURE.md`](../../docs/PACK_EXTENSIBILITY_ARCHITECTURE.md)
§2.2 (the sealed SPI), §3.3 (S2, S3), §3.4 (the AMQP contract *is* the SPI), §6 (the plan).
Prior run: [`implement_pack_spi.md`](implement_pack_spi.md) (phases A+B) and
[ADR-037](../../docs/adr/ADR-037-pack-spi-and-open-core.md).
**The design document is normative for *what* and *why*. This workflow is normative for *how* and
*in what order*. Where they disagree, the design document wins and this file is corrected.**

> **Read the phase A+B report first.** It closed seam S1 (routing is data) and it left four things
> explicitly for this phase. They are §4.4 below. Do not rediscover them.

## §0 Init

1. Load `AGENTS.md` — §2 (tiers, **[ERR-122] the AutoConfiguration SPI rule**), §3, §4, §6, §9, §11.
2. Load `.agent/rules/messaging_standards.md`, `naming_conventions.md`, `testing_standards.md`.
3. Read `docs/PACK_EXTENSIBILITY_ARCHITECTURE.md` §2.2, §2.3, §3.3, §3.4, §6, §7.
4. Read, **before writing anything**:
   - `orazaka-libs/orazaka-ai-engine/orazaka-interceptors/src/main/resources/META-INF/spring/…AutoConfiguration.imports`
     and one of its `*AutoConfiguration` classes — **this is the pattern you are copying**, not
     inventing. Orazaka already solved discovery once; the job plane never got it.
   - `orazaka-apps/services/orazaka-job-service/…/JobExecutionStrategy.java` and `JobListener.java`
     — the `strategiesByHandler` map is already SPI-shaped; only the sealing and the visibility are
     in the way.
   - `orazaka-apps/workers/orazaka-worker-media/app/consumer.py` — bindings still literals in source.
   - `orazaka-libs/orazaka-contracts/orazaka-jobs-api/` — where the new public types belong.

## §1 Scope of THIS run — phase C only

**S2 (executor SPI) + S3 (worker registration) + the wire protocol + the four carry-overs of §4.4.**

**Out of scope, do NOT start** — `pack.yaml` / `PackInstaller` / the `pack` CLI verb (D), any content
pack (E, H, J), capability availability in `StudioAccessService` (F — this phase *feeds* it, it does
not implement it), `orazaka-packs/` layout (G), `regulatory_class` behaviour (I). If C is green and
you have budget left, **stop and report**.

**Explicitly excluded, and to be done alone before you start**: the repo-wide `spotless:apply`
reformatting. It touches ~151 unrelated files. Mixing it into this diff makes the review worthless.

## §2 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §2 [ERR-122] | Discovery is `AutoConfiguration.imports`, exactly as `orazaka-interceptors` does it. Not a `ServiceLoader`, not a classpath scan, not a `Map` bean built by hand. |
| AGENTS.md §2 — tier purity | The `JobExecutor` interface goes in Tier-1 `orazaka-jobs-api`: pure JDK + JUnit. An executor implementation may use Spring; the **contract** may not. |
| AGENTS.md §6 | The wire format does not change. You are documenting and registering it, not redesigning it. Any change to an exchange, routing key or payload shape is out of scope — report it instead. |
| AGENTS.md §4 — config vs data | Worker bindings are declared by the worker (`worker.yaml`) and recorded in `worker_registry`. Not in a service's `application.yml`. |
| AGENTS.md §3 | `WorkerRegistryService` (capability-oriented). `JobExecutor` (a role, not a pattern). No `*Manager`, `*Handler`, `*Processor`. |
| ERR-103 | One top-level type per file **+ one mirroring test file**. |
| **Fail loudly** | Same rule as phase A. A `handler_key` with no registered executor, or a `worker_family` no worker claims, is a configuration error that must surface at startup and at publish — never a message on a queue nobody drains. |
| **Behaviour preservation** | The six existing strategies must execute identically after un-sealing. They are the regression suite. |

## §3 File manifest — phase C

```
# ── S2: un-seal the executor SPI ───────────────────────────────────────────
CREATE  orazaka-libs/orazaka-contracts/orazaka-jobs-api/.../domain/port/JobExecutor.java
CREATE  .../domain/model/JobExecutionResult.java          (typed result + reported consumption)
CREATE  .../domain/exception/JobExecutionException.java   (moved out of job-service)
MODIFY  orazaka-apps/services/orazaka-job-service/.../JobExecutionStrategy.java
          → deleted; the six strategies implement JobExecutor and become public
MODIFY  .../amqp/{Video,Vision,Audio}AnalysisStrategy.java
MODIFY  .../amqp/{ImageGeneration,SpeechSynthesis,ChatGeneration}Strategy.java
CREATE  orazaka-apps/services/orazaka-job-service/src/main/resources/META-INF/spring/
          org.springframework.boot.autoconfigure.AutoConfiguration.imports
CREATE  .../infrastructure/config/JobExecutorAutoConfiguration.java
MODIFY  .../amqp/JobListener.java                         (discovery by injected List<JobExecutor>)

# ── S3: worker registration ────────────────────────────────────────────────
MODIFY  infra/initdb/30-jobs-config.sql                   (+ worker_registry + heartbeat index)
CREATE  orazaka-apps/services/orazaka-job-service/.../application/service/WorkerRegistryService.java
CREATE  .../infrastructure/adapter/rest/WorkerController.java   (/internal/v1/workers — SERVICE only)
CREATE  .../infrastructure/adapter/schedule/WorkerHeartbeatSweeper.java
CREATE  orazaka-apps/workers/orazaka-worker-media/worker.yaml
MODIFY  orazaka-apps/workers/orazaka-worker-media/app/{consumer,main}.py  (read worker.yaml; register; heartbeat)
CREATE  orazaka-apps/services/orazaka-job-service/src/main/resources/worker.yaml  (it is a worker too)

# ── the protocol ───────────────────────────────────────────────────────────
CREATE  docs/WORKER_PROTOCOL.md                           (versioned wire spec — §4.3)

# ── §4.4 carry-overs from phase A+B ────────────────────────────────────────
MODIFY  orazaka-apps/services/orazaka-conversation-service/.../JobQueuePublisherService.java
MODIFY  orazaka-apps/services/orazaka-conversation-service/.../JobMeteringService.java
MODIFY  orazaka-apps/services/orazaka-studio/orazaka-studio-service/.../HttpCapabilityRoutingAdapter.java
MODIFY  orazaka-libs/orazaka-build/orazaka-test-support/.../architecture/GovernanceRules.java  (+ executor coherence)
MODIFY  <8> <Module>GovernanceTest.java

CREATE  docs/adr/ADR-038-worker-spi-and-registration.md
```

## §4 The work, specified

### §4.1 S2 — un-seal, do not redesign

`JobListener` already builds `Map<String, JobExecutionStrategy> strategiesByHandler` from an injected
list and already fails on a duplicate `handlerKey`. That is a working SPI wearing a sealed interface.
The change is narrow:

1. `JobExecutor` in Tier-1: `String handlerKey()` + `JobExecutionResult execute(JobCommand, Context)`.
   `Context` comes from `orazaka-core` — **if that import would make Tier-1 impure, pass the fields
   the executors actually use instead, and say so in the report.** Do not weaken the tier rule to
   make an import compile.
2. The six strategies become public, implement `JobExecutor`, keep their `handlerKey()` values
   **unchanged** — those values are in `orazaka_capabilities.handler_key` rows.
3. `default byte[] extractFileBytes(...)` on the sealed interface is shared *implementation*, not
   contract. Move it into a package-private base class or duplicate it; **a Tier-1 port must not do
   file I/O.**
4. Register through `AutoConfiguration.imports` + a `JobExecutorAutoConfiguration`, mirroring
   `orazaka-interceptors`. An out-of-tree jar dropped on the classpath must contribute an executor
   with no core edit — that is the acceptance criterion, not the mechanism.

### §4.2 S3 — worker registration and heartbeat

```sql
CREATE TABLE worker_registry (
    worker_name   VARCHAR(80) PRIMARY KEY,
    worker_family VARCHAR(60) NOT NULL,       -- matches orazaka_capabilities.worker_family
    bindings      JSONB       NOT NULL,       -- ["job.video.*", "job.compose.*"]
    version       VARCHAR(30) NOT NULL,
    concurrency   INT         NOT NULL DEFAULT 1,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    status        VARCHAR(20) NOT NULL DEFAULT 'HEALTHY'   -- HEALTHY | STALE | DRAINING
);
CREATE INDEX idx_worker_family ON worker_registry(worker_family) WHERE status = 'HEALTHY';
```

`worker.yaml` beside each worker declares `name`, `family`, `bindings`, `version`, `concurrency`. The
worker reads it at boot, declares its queues **from it** (the Python worker's `VIDEO_BINDING` /
`COMPOSE_BINDING` literals go away), registers over `POST /internal/v1/workers`, and heartbeats.
`WorkerHeartbeatSweeper` marks a worker `STALE` past a configured horizon.

**Registration must not be a startup dependency.** A worker that cannot reach the job service must
still consume — the registry is an availability signal, not an authorisation. Retry in the
background; log; keep working. Getting this backwards turns an observability feature into an outage.

Nothing consumes `status` in this phase. Phase F does. Say so in the DDL comment, as `regulatory_class`
does in `80-studio.sql`.

### §4.3 `docs/WORKER_PROTOCOL.md` — the actual extension point

The design's load-bearing claim (§3.4): **the worker SPI is the AMQP contract, not a Java interface.**
`orazaka-worker-media` is Python, links nothing, and participates fully. Write that contract down as
a versioned spec so a third party can implement it:

- envelope and required headers (`messageId`, correlation, `holdId` presence semantics)
- inbound: `orazaka.jobs`, `job.{capability}.{action}`, prefetch/concurrency expectations
- outbound: `job.{jobId}.progress|done|error` on `orazaka.events`, payload shapes
- consumption reporting — the `metrics` map billing prices, and what "absent" means
- idempotency by `messageId`, DLQ naming, retry/backoff expectations
- registration and heartbeat (§4.2)
- a **conformance checklist** a new worker can be tested against

`AmqpContractIT` in `orazaka-end2end` already asserts part of this. Point the document at it, and add
assertions where the spec claims something no test covers — a protocol nobody verifies is a wish.

### §4.4 The four carry-overs — each was reported, none is optional

1. **`JobMeteringService.capabilityOf`** — a `contains()` chain mapping `feature_key` → billable
   capability. Its javadoc claims it *"mirrors the resolution the publisher already applies… so a new
   feature is priced the same way it is routed"*. **That sentence is now false**: routing is data.
   Replace the chain with the capability's row (`billable_unit`/`worker_family` are already there),
   and fix the javadoc **even if you cannot fix the code in this run**. A comment that lies is worse
   than a chain that is honest about being a heuristic.
2. **`JobQueuePublisherService.getDefaultRoutingKey`** — the conversation service's own copy, which
   never had a `compose` branch, so the two had already diverged before phase A. Route through
   `CapabilityRoutingClient` like the studio service does. **First establish whether a compose job is
   reachable from this path at all** and report the answer; it changes whether this is a live bug or
   dead code.
3. **Route cache invalidation.** `HttpCapabilityRoutingAdapter` caches with a bounded TTL because the
   config-change event the design assumed **does not exist**. So `is_enabled = false` is not an
   instant kill switch — a disabled capability stays dispatchable for up to the TTL. Acceptable for
   cost, **not acceptable for a `REGULATED` pack** (phase I/J). Publish a config-change event on
   `orazaka.events` when a capability row changes and invalidate on it, keeping the TTL as the floor.
4. **Executor coherence rule.** There are now two independent dispatch discriminants: `routing_key`
   picks the queue and therefore the process; `handler_key` picks the code path inside it. A
   capability can be misconfigured in either. Add a governance/startup check: every enabled
   capability's `handler_key` resolves to a registered `JobExecutor`, and its `worker_family` is
   claimed by at least one `worker.yaml`. Fail the build for the first, log loudly at startup for
   the second.

## §5 Acceptance gate — run these, in order

```bash
# 0. PRECONDITION — the tree is already formatted and committed separately.
git status --short          # expect no pending spotless-only churn

# 1. Build and full suite. NOTE: verify does not install; phase A's report cost a re-run on this.
./mvnw -q clean install

# 2. Governance, including the new executor-coherence rule
./mvnw -q test -Dtest='*GovernanceTest'

# 3. Stack up
orazaka stop --purge && orazaka start && orazaka dev

# 4. BEHAVIOUR PRESERVED — the six executors still execute
orazaka test e2e

# 5. S2 bites: an out-of-tree executor is discovered.
#    Build a throwaway jar with one JobExecutor + its AutoConfiguration.imports, drop it on the
#    job-service classpath, restart. It MUST appear in strategiesByHandler with NO core edit.
#    Then remove it. Record the exact steps in the report — this is the phase's whole point.

# 6. S3: workers register and heartbeat
psql … -c "SELECT worker_name, worker_family, bindings, status FROM worker_registry;"
#    expect orazaka-worker-media and the job service, HEALTHY
#    stop the media worker, wait past the horizon, re-query: expect STALE

# 7. Registration is not a startup dependency
#    Start the media worker with the job service DOWN. It MUST consume anyway.

# 8. Carry-over #3: invalidation is not TTL-bound any more
#    Set a capability is_enabled = false, then dispatch within one second.
#    MUST refuse. (Before this phase it dispatched for up to the TTL.)

# 9. Carry-over #4: coherence bites
#    Point a capability's handler_key at a non-existent executor:
./mvnw -q test -Dtest='*GovernanceTest'     # MUST FAIL naming the capability. Revert.

# 10. The protocol is verified, not just written
#     Every claim in WORKER_PROTOCOL.md marked "MUST" has a test in AmqpContractIT or is
#     listed in the doc as unverified. No silent third category.
```

Phase C is done when **all ten** pass. Steps 5 and 8 are the phase: if an out-of-tree executor needs
a core edit, S2 is not open; if a disabled capability still dispatches, the kill switch is still
advisory.

## §6 Do NOT

- **Do not** run `spotless:apply` in this session. It is a separate, solitary commit.
- **Do not** change the wire format. Document it. If it needs changing, report and stop.
- **Do not** replace `AutoConfiguration.imports` with a `ServiceLoader` or a classpath scan.
- **Do not** put file I/O on the Tier-1 `JobExecutor` port.
- **Do not** make worker registration a startup dependency.
- **Do not** change any `handler_key` value — they are rows in `orazaka_capabilities`.
- **Do not** implement capability availability in `StudioAccessService`. Phase F consumes what you
  register; it is not yours to write.
- **Do not** fix the two preserved routings from phase A (`media.audio` → analysis handler,
  `chat.speech` → text queue) as part of this refactor. Now that routing is data they are one-row
  changes; propose them as a separate follow-up with the behavioural consequence spelled out.
- **Do not** touch the user's uncommitted working-tree changes.
- **Do not** commit or push.
- **Do not** modify `docs/_generated/*` by hand.

## §7 Before declaring done

1. Run the `.agent/workflows/review_architect.md` gate.
2. `initdb` and interfaces changed ⇒ run `.agent/workflows/sync_documentation.md`.
3. Write **`docs/adr/ADR-038-worker-spi-and-registration.md`**: the AMQP contract as the extension
   point and the Java SPI as a convenience for in-process executors; why registration is advisory and
   not authorising; the two-discriminant model (`routing_key` = process, `handler_key` = code path)
   and the coherence rule that guards it; and why the route cache moved from TTL-only to
   event-invalidated. Name the rejected options: `ServiceLoader`, classpath scanning, and making the
   registry authoritative for dispatch.
4. Update `docs/PACK_EXTENSIBILITY_ARCHITECTURE.md` §2.2 and §2.3 to CLOSED with the commit ref.
   Keep the rows.
5. Report: files created/modified, the ten gate results verbatim, **the exact reproduction steps for
   gate 5** (the out-of-tree executor), the answer on whether compose is reachable from
   `JobQueuePublisherService`, and any place the design turned out to be wrong.

## §8 Next phases (do not start without an explicit go)

- **D — pack bundle.** `pack.yaml` JSON Schema, transactional `PackInstallerService`,
  `orazaka pack validate|install|publish`, migrate the existing packs out of the core seeds.
- **E — Prospection pack** (Tier D) — D's acceptance fixture: zero new capability.
- **F — availability.** `worker_registry.status` + capability health feed `StudioAccessService`:
  no healthy worker ⇒ the Studio shows unavailable, no run submitted, no credits held.
- **G — open-core split.** `orazaka-packs/`, licences, `orazaka.packs.sources`, one Tier-D and one
  Tier-W reference pack in the open.
- **H — Validation pack** (Tier W) — `orazaka-worker-docs`, the first real consumer of this phase.
- **I / J — `regulatory_class` enforcement, then the Wellbeing pack.**
