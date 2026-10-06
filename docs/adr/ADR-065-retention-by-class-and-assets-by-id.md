---
title: "ADR-065 — The disclosure surface, closed: retention that follows the class into the job plane, a trail that records outcomes and not inferences, assets by id and never by path, guards that name the rule and not the match"
description: "M1.8, the last remediation run. The data class travels on JobCommand and job-service purges a protected job's files, then its row, at terminal state; a tombstone catches a directory written after its purge. The append-only run trail loses the column that held crisis responses. The compose worker refuses absolute paths instead of checking them. Crisis and scope guards log which rule fired, never the term."
category: ADR
order: 65
---

# ADR-065 — The disclosure surface, closed

- **Status**: Accepted
- **Date**: 2026-09-15
- **Scope**: `DataClass` (moved to jobs-api), `JobCommand`, `StepDispatch`, `RegulatoryClass`,
  `AmqpStepExecutionAdapter`, `StudioRunService`, `JobPersistenceProvider` and its JPA adapter,
  `JobService`, the four door-1 producers, `JobListener`, `JobRetentionService`, `JobRetentionSweeper`,
  the conversation relay's `JobEventListener`; `RunAuditService`, `RunSagaService`, `RunSweeper`;
  `consumer._resolve_owned_asset`; `SafetyInterceptor`, `ScopeGuardInterceptor`; `30-jobs-config.sql`,
  `80-studio.sql`, two migrations
- **Implements**: M1.8 of [`UNIFIED_PACK_SURFACE.md`](../UNIFIED_PACK_SURFACE.md)
- **Closes**: audit #27, #28, and the open point of #26 (guards logged the matched term)
- **Follows**: [ADR-064](ADR-064-trust-boundaries.md)

## 1. #27 — each context purges what it owns, and the class travels with the work

### 1.1 What the job plane kept

A SENSITIVE or REGULATED step runs as a job. Its row in `orazaka_jobs` holds the payload (the template
with the user's words, the declared guard subject), the result and the error message — for a refused
turn, the pack's crisis response. Its directory `{uploads}/{actor}/{job}/` holds the same payload as an
encrypted `input.json`, the output as `result.json`, and a copy of any input media. The studio's
`RetentionSweeper` deletes `studio_run`; nothing deleted the job's copy.

Measured on the local database before the migration: **56** terminal jobs carrying a protected
declaration (36 with REGULATED's crisis terms), **all 56 with a directory on disk**, and **11** rows
whose `error_message` is the crisis response with its helpline.

### 1.2 The decision — option (b), with (c) as the value SENSITIVE takes

**The class travels with the job; job-service purges its own rows and its own files; the class
parameterises the window; SENSITIVE's and REGULATED's window is "at terminal state".** One mechanism.

**(a) rejected — a run purge that deletes its jobs crosses two contexts.** Either the studio service
reads or writes the job plane's table, which SEAM-001 forbids, or it asks by message, and then
**retention depends on a delivery**: one lost event and the data survives with nothing to signal it. A
guarantee with a silent failure mode is not a guarantee, and it is the defect class these runs close.

**(c) alone rejected** — the payload is needed *during* execution (retry, dead letter, diagnosis), and
not persisting protected steps would make the protected path structurally different from the normal
one, therefore the less exercised one. (c) survives as a *value*: zero after terminal.

### 1.3 The class on the wire — a Tier-1 addition, never defaulted

It did not travel. `DataClass` lived in `studio-api` and stopped at the studio's edge.

| Where | What changed |
|:---|:---|
| `jobs-api` | `DataClass` moves here (the studio contract depends on jobs-api, not the reverse). `JobCommand` gains a **typed component** `dataClass` — not a payload key: door 1 lets an end user write `orazaka.*` payload keys (ADR-064 §7), and a class is not theirs to choose. `withReservation`/`withDeferredMetering` carry it |
| `studio-api` | `StepDispatch` requires it (`requireNonNull`); `RegulatoryClass.dataClass()` maps the pack's class |
| `AmqpStepExecutionAdapter` | publishes `"dataClass"` on the command, beside `payload`, not inside it |
| `JobListener` | **a command without a class is refused before anything is stored**: no row adopted, no `input.json`, no execution; `job.{id}.error` with `EXECUTOR_FAULT` and `JOB_DATA_CLASS_UNDECLARED` (the platform's defect, never the user's — it releases the hold). A row a producer already created is closed `FAILED`. An adopted job keeps the class it arrived with |
| `JobPersistenceProvider`, `JobService` | `createJob` takes the class; the JPA adapter refuses `null` with `"a job must declare its data class"` |
| `orazaka_jobs` | `data_class VARCHAR(20) NOT NULL`, **no `DEFAULT`**, `CHECK` on the three values |

### 1.4 Door 1 has no class — what it takes, and why that is acceptable now

The four door-1 producers (`JobController`, `JobSubmissionService`, `MediaJobService`,
`MediaGenerationController`) **declare `STANDARD` explicitly**, with the reason beside each line. It is
a declaration, not a default: removing it fails compilation, and a command published without one is
refused.

Acceptable **now**, for three reasons that hold today and are each checkable:

1. **No pack declaration reaches the job plane through door 1.** Every SENSITIVE and REGULATED blueprint
   runs through `StudioRunService`, which stamps the class from the pack's row. Door 1 is an end user
   submitting their own chat or media work.
2. **STANDARD is what the same material already is elsewhere.** A user who types the same sentence into
   chat has it kept in `orazaka_chat_sessions` under the platform's ordinary retention. Door 1 is not
   more sensitive than the conversation surface beside it.
3. **M3 closes door 1**, and what it removes is four marked lines, not a fallback someone has to find.

What it does **not** make acceptable is recorded in §6: door 1 still accepts a filesystem `filePath`.

### 1.5 The window lives on the class

`DataClass.jobRetentionAfterTerminal()` returns `Duration.ZERO` for SENSITIVE and REGULATED and empty for
STANDARD — the job plane keeps an ordinary job as it always has (§6 records that this is its own open
question). On the enum and not in configuration: a configurable period is one that can be lengthened,
and "nothing past terminal" is the decision, not a tuning. Terminal means `COMPLETED` or `FAILED`; a
running job keeps its material (asserted).

**Purging at terminal does not break a run**, checked rather than assumed: the studio reads a step's
outcome from `job.{id}.done` (`JobOutcomeListener` → `applyOutcome`), never from the job's files;
blueprints chain steps by value (`{{steps.screened.judgmentPrompt}}`), never by a file; and
document-validation's worker writes nothing to disk. The consequence, stated: **a protected step cannot
hand over a file by URL**. None does today — every SENSITIVE and REGULATED output is `TEXT` or `JSON`.

### 1.6 The file, then the row — and what comes back afterwards

`JobRetentionService.purgeExpired` (sweep every 60 s, `orazaka.jobs.retention-sweep-interval`), per job,
each statement committing on its own:

1. **Tombstone** — `orazaka_job_purge (job_id, user_id, purged_at)`: the ids and when, nothing the job
   held.
2. **The directory** `{root}/{actor}/{job}`, both ids validated as single path segments. If it cannot be
   deleted, **stop: the row stays**, because it is the only pointer to what could not be deleted.
3. **The row.**

The reverse order loses the pointer and the encrypted directory becomes immortal. In this order, a crash
between 2 and 3 leaves a row whose files are gone; the next sweep selects it again and finishes.

**The reconciliation exists because the window exists whatever the order, and because something real
writes after terminal**: `JobListener` bounds an execution with `CompletableFuture.get(timeout)`, which
abandons it without cancelling it — a timed-out execution can still write `result.json`.
`reconcileOrphans` deletes, again, any tombstoned job's directory that has come back, and forgets
tombstones after seven days. It cannot scan the upload root for directories without rows instead:
worker-routed Studio steps write outputs there with no row at all, and that scan would delete a
STANDARD reel.

The upload root is resolved by the sweeper from the same key and the same `PathResolver` as
`JobListener` — a sweep that computed its own would purge a directory the executor never wrote.

**The relay had to change with it.** The conversation service's `JobEventListener` updates the job row on
`job.*.done|error` and threw when the row was missing; an outcome heard after a purge would have been
retried into the relay DLQ — the outcome's content, kept in a queue after the plane deleted it. It now
drops a terminal event for a job with no row. Stated because it is broader than retention: worker-routed
Studio steps never had a row, and their outcomes stop throwing too.

### 1.7 The key material

An asset's data key exists only **wrapped, in the header of the file it encrypts** (ADR-054,
`EnvelopeCodec.writeHeader`). Deleting the file deletes the only copy of that key; an atomic write's
`.tmp` sibling lives in the same directory and goes with it. The master key survives by design — it
wraps every other file — and what it can open is a file that is no longer there.

A key-holder can undo the purge only with a copy of the bytes: **a backup** (none exist in the local
phase — when they do, their window must follow the class, or protected jobs need a per-class key that a
purge destroys) or **blocks the volume has not reused**. Overwriting before unlinking is not done: on
APFS and SSDs it does not reach the original blocks, and a control that looks like shredding without
shredding is worse than a stated residue. Recorded in §6.

### 1.8 Proof — the row and the files, asserted apart

`ProtectedJobRetentionIT` (job-service, Testcontainers): the real `JobListener` runs a SENSITIVE and a
STANDARD command to `COMPLETED`, writing real encrypted files; the row is written over the real DDL.
Five tests: the SENSITIVE row gone **and** its directory gone, as two assertions, with the STANDARD twin
kept; a running REGULATED job untouched; an undeletable directory keeps its row, and the next sweep
removes both; a directory written after its purge is deleted again, and its tombstone holds no content;
the schema refuses a job with no class.

Plants, each reverted:

| Plant | Red |
|:---|:---|
| A — `jobRetentionAfterTerminal()` always empty | `aSensitiveStepRunToTerminal…:173 [the SENSITIVE job's row] expected: 0 but was: 1` (and the reconciliation and undeletable-directory tests) |
| B — the row deleted, the directory never touched | `aSensitiveStepRunToTerminal…:174 [the SENSITIVE job's files] Expecting value to be false but was true` — **the row assertion above it passed**: the two are independent |
| C — the row, then the file | `aDirectoryThatCannotBeDeleted…:204 [the only pointer to what could not be deleted] expected: 1 but was: 0` |
| D — no reconciliation | `aDirectoryWrittenAfterThePurge_isDeletedAgain:228 Expecting value to be false but was true` |
| E — `JobListener` reads an undeclared class as STANDARD | `aJobThatDeclaresNoClass_isRefusedBeforeAnythingIsStored:741 Never wanted here` · `aRowTheProducerAlreadyCreated…:774 Argument(s) are different!` |
| F — the relay updates a purged row | `JobEventListenerTest.onJobEvent_terminalForAPurgedJob_isDropped:100 Never wanted here` |
| G — the JPA adapter defaults an absent class | `createJob_withoutAClass_isRefusedNotDefaulted:104 Expected java.lang.NullPointerException to be thrown, but nothing was thrown.` |
| H — the studio adapter stops publishing the class | `theDataClassTravelsWithTheJob:111 … to contain entries: ["dataClass"="SENSITIVE"]` |
| I — the class published under another key | `theClassAStudioPublishesByName_isReadBackAsTheClass:764 expected: <SENSITIVE> but was: <null>` |

**What it cannot see**: the IT writes the row through a JDBC twin of the port over the real table,
because the JPA adapter is package-private to `orazaka-persistence` and job-service has no JPA test
context. `JobEntity`'s `@Column(name = "data_class")` is covered by the adapter's unit test, not by a
database.

**The IT does not load `30-jobs-config.sql` whole**, and the reason is a finding: the file has not
bootstrapped a fresh database since 2026-09-09 (§6). It executes the job plane's own four statements
read out of the real file, and asserts it found four.

## 2. §2.2 — the append-only trail and shortened retention point in opposite directions

### 2.1 What the audit row contained

`studio_run_audit`: `run_id, actor_id, pack_key, studio_key, data_class, event, step_id, detail,
failure_cause, recorded_at`, append-only by trigger. `detail` was declared *"a reason code, never user
content"*. `RunSagaService.failRun` filled it with **the failed step's error message** — for a guard
refusal, the pack's reviewed answer; on a REGULATED pack, **the crisis response itself**.

On the local database: **11** rows carrying the crisis response (`"Je m'arrête là, parce que ce que vous
ve…"`), 21 the wellbeing scope refusal, 2 the validation pack's — permanent, in the one table retention
cannot touch. `orazaka_jobs` was never the worst carrier.

### 2.2 The rule, landed

**The trail records that a run happened and its outcome class — never what it matched, never the
subject.** It now holds `run_id, actor_id, pack_key, studio_key, data_class, event, step_id,
failure_cause, recorded_at`. `detail` is gone: from the INSERT, from `recordFinished`, from the DDL, and
from the local database by migration, **which removes existing values from an append-only trail** — done
deliberately and said here. The trigger guards `UPDATE` and `DELETE`, not DDL.

`StudioRunLifecycleIT.theTrailRecordsTheOutcomeNeverWhatWasMatched` runs a REGULATED step to a crisis
refusal and asserts the run's own `errorMessage` is the crisis text (the run is the user's material,
under its class's window), `failure_cause` is `GUARD_REFUSAL`, and `row_to_json` of the trail row does
not contain the helpline. Planted with the previous `RunAuditService` and DDL: red, the row read
`"detail":"Je ne suis pas en m…"`.

### 2.3 The conflicts — stated, not settled quietly

- **No code read `detail`.** No query, no endpoint, no test before this one.
- **ADR-053 §2 leaned on it in prose**: it rejected a `QUOTA_EXHAUSTED` cause because *"the identity of
  the refusing gate already travels as detail"*. In the trail, it no longer does. The event still
  carries the refusal to the saga; the permanent record does not say which gate refused.
- **The trail can no longer tell a crisis refusal from a scope refusal** — both are `GUARD_REFUSAL`. That
  is the rule working, not a loss: a reason code `crisis_content` in a permanent row is the sensitive
  inference itself. ADR-053's operator question — *how many protected runs did we refuse, and how many
  did we break* — is one query, unchanged.
- **What the rule still allows is not nothing**: `actor_id` with a wellbeing `pack_key` says this person
  used a wellbeing studio. That is "a run happened", which the rule permits; it is written here so it is
  a choice someone read.

## 3. #28 — reference an asset, do not validate a path

### 3.1 The fix

`_resolve_owned_asset` returned an absolute path untouched, *"already resolved upstream"*. The upstream it
trusted — job-service's `AssetFileResolver` — never sees a compose job, which routes straight to the
worker. **An absolute path is now refused, not checked**: `None`, the same answer as an id that does not
exist, so the refusal says nothing about whether the file was someone's (404, not 403). Checking the path
against the owner's root would have kept a way of asking for files by location that nothing needs.

What remains is resolution **by id, server-side, against the job's actor**: a single path segment
(`basename(candidate) == candidate`), looked up under the root derived from `userId` — the command's
actor, never a payload value — and kept only if its `realpath` is a regular file under that root. The
Java side was already so: `AssetFileResolver` scopes to `JobCommand.userId()`, and `AssetController`
answers 404 for another actor's asset (`AssetControllerIT`).

This does not close door 1's `orazaka.*` key hole (M3). It means the worker no longer relies on the run
path being the only producer.

### 3.2 What the resurrected test asserted

`test_an_absolute_path_is_left_alone` asserted `_resolve_owned_asset(root, owner, absolute) ==
absolute`, for a file in the owner's own directory. It was written in `a5e3c586` (2026-09-03) — **the
same commit as the `isabs` branch it describes**, to match it — and never ran until ADR-064's collection
guard made it reachable. Nobody had asked whose file the path named. It is now
`test_an_absolute_path_is_not_an_asset_reference`: another actor's file by path → `None`; the caller's
own file by path → `None` too, because the path is what is refused, not the owner.

Planted (the branch restored): `'/var/folders/…/550e8400-…-446655440002/temp/a1b2c3d4-….png' is not
None`. Reverted.

### 3.3 The three content packs

Every blueprint in `orazaka-packs/` scanned for asset-shaped inputs (`photos`, `audio`, `assetId`,
`filePath`, `imagePath`, `image`): **none passes a filesystem path**. `realestate-studio`'s `assemble` step
passes `photos: {{inputs.photos}}` (ids) and `bRoll: {{steps.bRoll.url}}` — a URL the compose worker
never reads (§6). Both `describe` steps pass `assetId: {{item}}`. No contract change for any pack.

## 4. §4 — the matched term

| Guard | Logged before | Logged now |
|:---|:---|:---|
| `SafetyInterceptor` | `Crisis content matched on the declared term '{}'; answering the reviewed text` | `Crisis guard fired (crisis_content); answering the reviewed text` |
| `ScopeGuardInterceptor` | `Refused a turn on the declared out-of-scope term '{}'` | `Scope guard fired (out_of_declared_scope); answering the pack's refusal` |

The earlier comment justified the term as *"the pack's word, not the user's"*. On a crisis guard **the
presence of the match is the disclosure**: the line said what this person wrote.

**The refusal reason does not embed the match.** `PipelineShortCircuitException` carries a constant
reason code (`crisis_content`, `out_of_declared_scope`, `subject_not_examinable`) and, as its message,
the pack's reviewed text — the same for every user who triggers it. `JobListener` logs the interceptor
id and that code. The relay logs the pack's answer at `WARN`: it names the rule, never the match.

`SafetyInterceptorTest`/`ScopeGuardInterceptorTest.logsTheRuleNeverTheMatch` capture the guard's log and
assert the reason code is present and neither the term nor the turn is. Planted:
`Expecting actual: "Crisis guard fired (crisis_content) on the declared term plus vivre" not to contain:
"plus vivre"`. Reverted.

## 5. Last runs' controls

`[CFG-001]` (`ConfigBindingRules`), GOV-006 (`GovernanceSubjects`), `[LOG-001]` (`LoggedContentRules`),
the Python collection guard (`TestTheRunnerCollectsEveryDefinedTest`), `ImageGeneratorClientImplTest`,
`TestCompositionDivergenceContract` and `UserPreferencesContractTest`: **no diff**, green in the full
build.

## 6. Found during M1.8 — for M2's report, whatever the colour

The rule of this run: nothing below was repaired.

1. 🔴 **`30-jobs-config.sql` does not bootstrap a fresh database** since `2b41a478` (2026-09-09):
   `orazaka_capabilities` misses a comma between two constraints and ends with a trailing one, so psql
   stops at that table. Existing volumes are unaffected — the migration ran. No test loads the file; this
   run's IT is the first thing that tried.
2. 🔴 **Door 1 accepts a filesystem path.** `POST /api/v1/jobs` passes its payload verbatim;
   `JobListener.resolveAssets` scopes only `assetId`, `saveInputPayload` archives whatever `filePath`
   names, and the executors read it. Any file the job service can read, named by an authenticated user.
   Not the `orazaka.*` hole ADR-064 recorded — a second one on the same door.
3. 🟠 **A protected job that never reaches terminal is never purged.** A job-service crash mid-execution
   leaves it `PROCESSING`; the redelivery is skipped by the claim never released (#30);
   `JobReconciliationService` recovers only jobs with a `result.json`. `RunSweeper` closes the run, not
   the job.
4. 🟠 **A timed-out execution is not cancelled** and can write its output, and try to mark the job
   `COMPLETED`, after `job.{id}.error` was emitted and the hold released. §1.6 contains its effect on
   retention; the behaviour is untouched.
5. 🟠 **`realestate-studio` bills a b-roll the reel never contains**: `bRoll` (450 of the run's 480
   credits, ADR-034) is passed to compose, which reads only `photos` and `audio`.
6. 🟡 **Dead-letter queues nothing consumes** — `orazaka.jobs.video.dlq`, the relay's
   `orazaka.events.job-relay.dlq`, the worker-bound queues' — keep messages, and a protected step's
   payload, with no window.
7. 🟡 **Worker-routed Studio steps have no job row**, so the class-driven purge cannot see what a worker
   writes. No protected step writes today (document-validation's worker writes nothing); a protected
   compose step would.
8. 🟡 **STANDARD jobs have no window in the job plane**, while STANDARD runs age out at 90 days.
9. 🟡 **`purgeJobsByUserId` deletes rows and leaves directories** (`repository.deleteByUserId` only).
10. 🟡 **`studio_outbox` rows are never deleted** once published (billing purges its own). Content-free:
    ids, actor, studio key.
11. 🟡 **`StudioRunService.dataClassOf` reads a studio with no pack row as STANDARD** — the one default
    left on the class's path, documented there as deliberate (reclassifying legacy studios).
12. 🟡 **Automation connector jobs carry payloads with no class**, in a plane with no class-driven
    retention.
13. Residue, not a defect: a purge can be undone from a copy of the bytes — a backup, or unreused
    blocks (§1.7). When backups exist, their window must follow the class.

## 7. Migrations

- `infra/migrations/2026-09-15-audit-without-detail.sql` — drops `studio_run_audit.detail`.
- `infra/migrations/2026-09-15-job-data-class.sql` — adds `data_class`, backfills it, sets `NOT NULL` and
  the `CHECK`, adds the protected-terminal index and `orazaka_job_purge`. **The one place a class is
  inferred**, and only for rows written before producers declared one: a REGULATED step carried
  `orazaka.safety.crisis-terms`, a SENSITIVE one `orazaka.scope.refused-terms` (ADR-051, ADR-055).

Both applied to the local database, both re-applied without error. The backfill classified 36 rows
REGULATED, 20 SENSITIVE, 62 STANDARD. Every protected row is terminal: **the first job-service start
will purge 56 rows and 56 directories.**
