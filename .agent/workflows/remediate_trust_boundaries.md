---
description: UNIFIED SURFACE — M1.7 (caller-controlled keys in trusted maps, Python tests that never run, the billing failure posture, logs as a data-class channel). Last remediation run before M2.
---

# Workflow: M1.7 — four trust boundaries, then M2

Prior runs: [`remediate_inert_controls.md`](remediate_inert_controls.md) (ADR-062),
[`close_media_turn_bypass.md`](close_media_turn_bypass.md) (ADR-063).
Findings being closed: `PRODUCTION_READINESS_AUDIT.md` **#23, #24, #25, #26**.

> **This is the last remediation run before M2, and that is a commitment.** #22 (audio never billed)
> is deliberately excluded: it belongs to M2, which brings the audio capabilities and their divergence
> contract, and fixing it beside that work rather than inside it is how it ends up half-covered.
> Anything new you find here is **recorded for M2's report**, not turned into an M1.8 — unless it is
> live and 🔴, in which case surface it as a decision rather than scheduling it yourself.

## §0 Init

1. Load `AGENTS.md` — §0, §2, §3, §7, §9, §11, §12.
2. Read audit findings #23–#26 and ADR-063.
3. Read, **before writing anything**:
   - `orazaka-libs/orazaka-ai-engine/orazaka-core/.../pipeline/DynamicPipelineExecutor.java` lines ~176–181
   - `krizaka/krizaka-users/krizaka-users-core/.../IdentityServiceImpl.mergeAndSavePreferences`
   - `orazaka-apps/services/orazaka-job-service/.../amqp/JobListener.java` lines ~290–300 — the
     **namespacing discipline that already exists in this repository**
   - the worker test file whose tail sits after `unittest.main()`

## §1 Scope — four items

§2 `#23` · §3 `#24` · §4 `#25` · §5 `#26`. Nothing else.

**Out of scope, do NOT start** — `#22` (M2), the `orazaka-media` bundle or any blueprint (M2), the
marketplace entitlement band (M2's opener), the outbox / lanes / per-lane ceiling (M2.5), deleting any
controller (M3), the M2M JWT (deployment block). If the four are green and you have budget left,
**stop and report**.

## §2 `#23` — caller-controlled keys in a trusted map

### §2.1 The chain, confirmed by reading both ends

```java
userMetadata.put("userId", context.userId());
userMetadata.put("conversationId", context.conversationId());
userMetadata.putAll(context.preferences());   // ← persisted user input
userMetadata.put("roles", …);                 // ← after, therefore untouchable
```

`IdentityServiceImpl.mergeAndSavePreferences` does `merged.putAll(preferences)` with **no key
allowlist**, so arbitrary keys reach the user record and travel to the line above.

**`roles` is safe only because of the line order.** Nobody decided that. `userId` and
`conversationId` are placed before the merge and are therefore overwritable; authorities are not, by
accident.

### §2.2 Therefore: do not reorder

Moving the three `put` calls below the `putAll` makes all three safe today, teaches nothing, and the
fourth trusted field the next author adds will go above the merge. **The structural fix is that
caller-controlled data never shares a key space with trusted context** — a namespaced sub-map, or a
nested value, so a collision is not expressible.

This repository already solved this once: `JobListener` merges a `namespaced` map, not a raw one.
The job plane has the discipline; the preferences path never received it. **Copy the existing
pattern; do not invent a second one.**

Reject reserved keys at the identity write boundary as well, so bad data never persists — but the
namespace is the fix and the validation is depth, not the other way round.

### §2.3 Sweep every sibling, because this is a shape and not an incident

There are roughly eight non-test `putAll` sites in this repository. **Audit all of them** and answer
one question per site: *is the source fully controlled by the callee?* Where it is not, it is this
defect with a different source. Look in particular at:

- `ContextService.preferences.putAll(profile.rawPreferences())` — both services
- `UserContextResolver.newUserMetadata.putAll(securityData)`
- `JobListener.consumption.putAll(reported)` — **worker-reported consumption merged into the
  consumption map.** If a worker can report arbitrary keys there, this is the same defect standing in
  the metering path.

Report the table of sites and verdicts even for the ones that are fine.

### §2.4 A rule, with the same escape clause you used well last time

Write a guard that reddens when caller-controlled data is merged into a map holding trusted fields.

**If no honest static anchor exists, say so and write a contract test instead** — the same judgement
you exercised when you deleted your own bytecode rule for reading the wrong scope and replaced it with
the divergence contract. A rule that flags model names and URLs is worse than no rule, because people
learn to ignore it. Plant a violation, watch it redden, revert.

## §3 `#24` — tests that are unreachable because of where they sit

Five worker tests, including the owner-confinement checks, sit after `unittest.main()` and never run.
Seventh inert control, new mechanism, and once again the ones that do not run are the security ones.

1. Move them so they run. Report what they assert **and whether any of them fails now that it does** —
   a test that has never executed has never passed either. This is the §2 lesson of the last run:
   making something reachable is a change.
2. Then the guard. The obvious anchor is module-level code following `unittest.main()`, but derive it
   from the file rather than from this sentence. Whatever you land must also answer the more general
   question: **does the number of tests the runner collects match the number defined?** That is the
   Python analogue of the empty-set meta-rule, and it catches the eighth mechanism as well as this
   one.

## §4 `#25` — the failure posture, chosen rather than emergent

The credit hold no longer blocks the turn when the billing service call fails; the turn is served
without a hold. Read it beside your own decision in the last run: you chose **fail-closed** on the
crisis guard facing an unreadable image, and argued it. This one is **fail-open**, and nobody chose
it.

1. Decide, and write the decision where a reader will find it — not in a `catch` block whose
   behaviour is emergent. Both answers are defensible: fail-closed makes a billing outage a service
   outage; fail-open makes a billing outage free inference for everyone.
2. **Whichever you choose, the event must be accounted.** A turn served without a hold must leave a
   record that can be reconciled afterwards. Silent free inference and reconcilable free inference are
   different products.
3. State the posture of every other control that can fail this way, and whether they agree. Two
   opposite postures on two controls is fine if both were chosen; it is a defect if one was not.

## §5 `#26` — logs are a channel, and the data class applies to channels

The engine logs every prompt and every response at INFO. `SENSITIVE` mandates shortened retention and
an append-only audit trail; a log file has neither. So a lease analysed under `SENSITIVE` leaves by a
channel with no retention policy at all.

**This is a data-class bypass, not a hygiene issue** — the same family as door 1, and wider, because
it applies to correctly governed runs too.

1. The simplest correct answer is that prompts and response bodies are never logged. If you land
   something else — redaction, a data-class-aware appender — it must satisfy the retention and audit
   obligations the class already carries, and you must say how.
2. A rule here probably *does* have an honest anchor: no logging call takes a prompt or a response
   body as an argument. Anchor it on the types and fields, not on the word "prompt". Plant, redden,
   revert.
3. Check the same question for anything else that leaves the process: metrics labels, exception
   messages, HTTP error bodies. One of them will carry content.

## §6 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | 100% local. No CI, no cloud. |
| AGENTS.md §12 | Engine holds the mechanism, never the subject. |
| ERR-103 | One top-level type per file **+ one mirroring test file**. |
| **Namespace, do not reorder** | §2.2. A fix that depends on statement order is not a fix. |
| **Every new rule seen failing** | Plant, paste the output, revert. Every run in this series has been about controls that claimed to work. |
| **Reachability is a change** | §3.1. Tests that have never run have never passed. Expect at least one to fail and report it as a finding, not as a nuisance. |
| **No repairs in passing** | Not #22, not M2, not M2.5, not M3. |

## §7 Before declaring done

1. `./mvnw -o clean install` green with all `*IT`; Python, CLI and web suites green; `spotless:check`
   still bound.
2. `[CFG-001]`, `GOV-006`, and both divergence contracts still active, still green, unchanged. No
   control from a previous run may have been loosened to make this one pass.
3. The §2.3 table: every `putAll` site with its verdict.
4. §3.1: what the five resurrected tests assert, and whether any failed on first execution.
5. §4: the posture chosen, where it is written, and the agreement table for the other controls.
6. Every planted violation pasted and reverted.
7. Anything new found: recorded for **M2's report**. If something is live and 🔴, surface it as a
   decision — do not schedule an M1.8 yourself.
8. **Commit if green. Never push.**

## §8 Next — M2, and the queue is empty

M2: the `orazaka-media` bundle and its six single-step blueprints. It opens with the marketplace band
keyed on `kind` **and** the entitlement snapshot, and it absorbs **#22** (audio never billed) together
with the audio half of the divergence contract. It also owes the deferred fps decision — duration
measured in `ConsumptionReport` rather than the composer forcing `-r 30`, because changing the artefact
so the meter works is backwards even when the new artefact is better.

Then M2.5 harden the run path (outbox on dispatch, lanes not priorities, per-lane ceiling), then M3
close door 1.
