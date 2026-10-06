---
title: "ADR-053 — The typed failure cause: a failed run says why, and the saga stops guessing"
description: "ADR-046 §2 reopened, for a reason that is not billing: a SENSITIVE pack's audit log could not tell 'we protected the user' from 'we broke'. job.{id}.error now carries a declared cause across both languages, which settles the withdrawn settlement policy and lets a blueprint discriminate on it."
category: ADR
order: 53
---

# ADR-053 — The typed failure cause

- **Status**: Accepted
- **Date**: 2026-09-08
- **Scope**: `FailureCause` (Tier-1), `JobEventPublisher`, `JobListener`, `JobOutcomeEvent`,
  `RunSagaService`, `RunAuditService`, `RunSweeper`, `BlueprintStep`, `BlueprintMapper`,
  `telemetry.py`, `consumer.py`, both reference pack workers, `docs/WORKER_PROTOCOL.md`
- **Reopens and closes**: [ADR-046 §2](ADR-046-asset-lists-and-failed-run-settlement.md)
- **Applies**: [AGENTS.md §12](../../AGENTS.md) — *Declared, not inferred* — for the fifth time

## 1. Why now, and not at the cloud launch

ADR-046 §2 filed this under *"revisit at the cloud launch"*, on the ground that while every failure
is our own machine's, releasing everything costs us nothing. That reasoning was about **money**, and
it was sound about money.

Phase H produced a reason that is not about money. The validation pack set `onError: SKIP` on its
model step so an outage would still yield a nine-tenths-deterministic report — and a **scope-guard
refusal was swallowed by the same policy**, because a refusal and an outage arrived identical. The
pack had to fall back to `onError: FAIL`, which means an Ollama hiccup now discards a report that
was almost entirely computed.

That is a product regression, but it is not the finding. The finding is what it implies for a
`SENSITIVE` pack's audit log: two runs, one where **we protected the user** and one where **we
broke**, produce the same row with different prose in it. ADR-051 built that log so a protected
pack could show what happened to protected material. A log that cannot separate those two answers
is not a control; it is a record of the fact that something ended.

**That is the third control losing its meaning, not a billing policy waiting its turn.**

## 2. The vocabulary, argued

Five causes. A category exists only where it answers differently on one of two axes — *did the
platform do its job correctly*, and *does the answer say the user was at fault* — or where it names
a **different thing an operator must go and fix**, which is what the audit log is for.

| Cause | Settles what ran | Blames the input | Operator action |
|:---|:---:|:---:|:---|
| `GUARD_REFUSAL` | **yes** | no | none — working as designed |
| `INPUT_INVALID` | **yes** | **yes** | none |
| `EXECUTOR_FAULT` | no | no | fix our code |
| `PLATFORM_UNAVAILABLE` | no | no | restore a dependency |
| `TIMEOUT` | no | no | capacity, or the bound itself |

**The settlement rule is one sentence: we bill for work we performed correctly, and never for our
own failure.** A gate declining to serve and a payload an executor checked and rejected are both
the platform behaving exactly as built, so the compute already spent is settled. A defect, an
absent dependency and a missed deadline are ours, so the whole hold goes back.

The last three settle identically and are still three, because *"our code is wrong"*,
*"Ollama was down"* and *"it never came back"* are three different mornings, and the trail exists to
say which.

### An earlier draft billed only `INPUT_INVALID`, and it was wrong

The first version of this ADR made `GUARD_REFUSAL` release, reasoning from ADR-051 §3 that a
refusal is free. It does not survive a multi-step run: it makes a refusal free **only when it
happens first**, so an actor's bill would depend on which step an out-of-scope phrase happened to
reach — and it made a refusal and a model outage settle identically, which is the exact confusion
this ADR exists to end. Under the rule as written, a refusal arriving before any work still costs
nothing, because nothing was measured. The guarantee survives; the arbitrary edge does not.

### Two candidates rejected

- **`QUOTA_EXHAUSTED`.** The entitlement gate is also a gate that short-circuits, but the
  *identity* of the refusing gate already travels as detail. Promoting one gate into the vocabulary
  while every other stays generic is the asymmetry that makes a vocabulary grow without bound.
- **`UPSTREAM_REFUSAL`** — a third-party provider declining on rate limit or content policy. Real,
  distinct, and **the one the cloud launch will need**. Deliberately absent while every provider is
  on this machine: a category no producer can set is the opposite of a declaration.

## 3. Absence is an executor fault, never a refusal

`FailureCause.of(null)` and `FailureCause.of("BAD_INPUT")` both return `EXECUTOR_FAULT`. A producer
that says nothing, or invents a word, degrades to the reading that **releases the hold and blames
nobody**. Deliberate in both directions:

- a worker not yet taught this contract — an older one, a third party's — keeps working and costs
  its users nothing;
- vocabulary drift cannot silently start billing people.

**No branch infers `INPUT_INVALID`.** In Java, `handleExecutionFailure` reads only *structural*
facts from the exception — an unreachable dependency is `PLATFORM_UNAVAILABLE`, everything else is
`EXECUTOR_FAULT` — and never text. In Python, `INPUT_INVALID` is raised only from the worker's own
`InvalidJobPayload` type, which the catch-all cannot reach, and a test asserts that structurally.
ADR-046 §2's counter-example holds: *"compose requires at least one readable photo"* read exactly
like bad input and was our own defect three layers deep. It is `EXECUTOR_FAULT` by construction.

## 4. The contract crosses both languages

`cause` travels on `job.{id}.error` as its **name**, never an ordinal — an ordinal would silently
re-map every consumer the day a cause is inserted. `docs/WORKER_PROTOCOL.md` §3.1 documents it as a
**MUST**, with checklist rows 5b and 5c, and the vocabulary is mirrored in `telemetry.py` with a
test asserting the two lists are equal.

Four Java producers declare it: the timeout handler (`TIMEOUT`), the interruption handler
(`PLATFORM_UNAVAILABLE` — the platform stopping accepted work), the refusal branch
(`GUARD_REFUSAL`), the general handler (`causeOf`), and the dead-letter consumer
(`EXECUTOR_FAULT` — retries exhausted tells us we could not finish it and nothing about why).

**And a fifth that declared nothing at all.** `RunSweeper` fails runs whose steps stopped
reporting, and it wrote no cause *and no audit row* — the one terminal path that recorded nothing,
which is the hole a trail cannot have. It now declares `TIMEOUT` and writes the row.

## 5. What it unblocks

**(a) The settlement policy of ADR-046 §2 applies**, as put: platform faults release everything,
a fault in the input settles what ran. `failRun` takes the declared cause and branches on
`settlesMeasuredWork()`.

**(b) The audit log records the category, not the sentence.** `studio_run_audit.failure_cause`,
indexed, so *"how many protected runs did we refuse, and how many did we break?"* is one query.

**(c) A blueprint step can discriminate.** `onErrorByCause` overrides `onError` per category —
additive, so every blueprint written before this behaves exactly as it did:

```json
"onError": "SKIP",
"onErrorByCause": { "GUARD_REFUSAL": "FAIL" }
```

The validation pack takes back what it gave up: an outage still yields the deterministic report
with the judgment rule honestly marked `INSUFFICIENT_EVIDENCE`, and a refusal reaches the user. A
misspelt cause is refused at parse time rather than ignored — a policy silently dropped because
`GAURD_REFUSAL` was mistyped looks exactly like the policy being applied and not helping.

## 6. Measured

Same pack, same Studio, `regulatory_class: SENSITIVE`.

**Two categories in the trail** (blueprint 1.0.2, where the step fails on either cause):

```
bef6f9f7 | RUN_FAILED | SENSITIVE | GUARD_REFUSAL
d7898172 | RUN_FAILED | SENSITIVE | TIMEOUT
```

**Two outcomes from the same step** (blueprint 1.1.1, `onError: SKIP` + `GUARD_REFUSAL: FAIL`):

```
38c9cc8f  judge FAILED TIMEOUT        -> report SUCCEEDED, run SUCCEEDED  (settle path)
de11b5bd  judge FAILED GUARD_REFUSAL  -> run FAILED, answered in the pack's own words (release)
```

**Both settled zero credits, and the reason is worth more than a manufactured difference.** On this
blueprint the only priced work is the model call, and in both scenarios the model call is exactly
what did not happen: the deterministic step measures `{"tokens": 0}` because a regex spends no
tokens. The settlement *decision* differs — one run went down the settle path, the other down the
release path — and the *amount* is zero either way because there was nothing to price. That a
refusal costs nothing here is ADR-051 §3 holding, not the policy failing to bite; the amounts
diverge where priced work precedes the failure, which `StudioRunLifecycleIT` drives directly.
