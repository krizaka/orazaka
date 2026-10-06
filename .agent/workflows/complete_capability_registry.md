---
description: UNIFIED SURFACE — M4 (the governance contract made true, the registry's missing half, and only then the columns dropped)
---

# Workflow: M4 — the registry gets the other half of its contract

Design intent: [`docs/UNIFIED_PACK_SURFACE.md`](../../docs/UNIFIED_PACK_SURFACE.md) §5 (M4 row) and
§5.2. Prior runs: ADR-061…068.

> **The order in the original plan is wrong and this workflow corrects it.** M4 was written as "drop
> the UI-manifest columns, then tidy". But `payload_template` is the *input* half of the capability
> contract, and `BlueprintFitnessTest` reads it. Dropping it before something replaces it turns a
> working rule inert — the tenth instance of this project's one defect, created by the run meant to
> complete the registry. **So the contract is declared first (§4) and the columns are dropped as a
> consequence (§5).**

## §0 Prerequisites — two, before any other work

**1. Run the e2e suites once, against a live stack.** They compile and have never executed on the run
path. M3 rewrote them; nothing ran them. Closing door 1 is the most irreversible change in this project
and its end-to-end verification is the only one not performed. Raise the stack, run the two suites,
report. If they pass it is thirty minutes; if they do not, now is when to know.

**2. Close the web arithmetic per module**, the way M2.5 closed the Java one. Web went 500 → 489. It is
very probably the tests of `MediaApi.analyzeVideo`, the deleted DTOs, `useBootstrapFeatures` and
`executeFeature` — code that left with its code. Say it with the numbers rather than leaving it
plausible.

## §1 Scope — five items, in this order

§2 `AGENTS.md` §6 · §3 `#44` the two lying names · §4 the capability contract · §5 drop the columns ·
§6 `#43`.

**Out of scope, do NOT start** — the bypass surface rule (M5, which M3 proved necessary); `#19`, `#29`,
`#33`, `#34`, `#36`–`#42`, `#47`; the seam-input audit. Relist the open findings and close none in
passing.

## §2 `AGENTS.md` §6 is stale about the plane these runs rebuilt

§6 still names the router as the producer of async jobs. After M3 the only producer is the studio
outbox. **This is the governance contract, and it is the first file every run loads** — so every
future run reads a description of the job plane that no longer matches the job plane.

Fifth instance of a text asserting something false about a control, after `CreditReservationService`'s
javadoc, `studio_run_audit.detail`'s "never user content", `BlueprintFitnessTest`'s transcribed output
table, and §7 on the kill-switch. This one is the normative document.

Correct it, and while you are in there: **check §6's other claims against the code as it now is** —
exchanges, routing-key grammar, the lanes added in M2.5, which producers exist. Do not correct only the
sentence I named; I found one by reading a report, which is not a survey.

## §3 `#44` — two capability names that lie

`orazaka.core.chat.speech` is named `chat.*`, is AUDIO, and routed to `job.text.process`;
`orazaka.core.media.audio` is analysis and routed to `job.media.generate`. M2.5 already moved image
analysis to its own key because a key cannot feed two lanes, so the grammar tolerates this.

Rename both. The feature key is referenced by blueprints, seeds, the pricebook, `latency_class`, the
lane bindings and any pack manifest — **enumerate the references before renaming, do not grep-replace**.
Nothing is deployed, so there is no migration; there is only a set of files that must agree.

## §4 The registry declares inputs and not outputs — this is the run's substance

A blueprint chains steps by `{{steps.<out>.<field>}}`. **Nothing declares what a capability produces**,
so every link in every DAG references a field no contract mentions and no rule can check. That is why
`BlueprintFitnessTest`'s output table was hand-written, and why it said
`orazaka.core.media.audio` publishes `url` — transcribed when the row was still called "Audio
Generation".

So the capability contract becomes two halves:

- **inputs** — what `payload_template` carried, as a real schema (types, required, defaults, and the
  `format: prose | asset-id` M3 introduced for fillability)
- **outputs** — the fields a successful execution publishes, with their types

Declared in the pack manifest's `requires.capabilities` entry, written to the row by the installer,
exactly like `routingKey`, `billableUnit` and `latencyClass` before them. Manifest declares, installer
writes, platform reads — do not invent a fourth mechanism.

Then a blueprint step is checkable **in both directions**: its inputs against the declared inputs, and
its `{{steps.x.field}}` references against the declared outputs. `BlueprintFitnessTest` stops reading a
transcription and reads data on both sides.

**One question to answer before writing anything:** M3's report says the five UI-manifest columns have
no consumer left. Is `BlueprintFitnessTest` still reading `payload_template`? If it is, "no consumer"
is an overstatement, and §5 depends on §4 landing first rather than being independent of it.

## §5 Drop the columns — as a consequence, not as the goal

`uri_path`, `http_method`, `payload_template`, `icon`, `label`. M3 removed their runtime consumers;
§4 replaces the one that carried contract meaning.

Also: **re-document `is_enabled`.** It survives, and after M3 it no longer means "a button appears in
the composer". Say what it now means — and if the honest answer is that two different intentions have
been sharing one column, say that instead of writing a sentence that covers both.

The dispatch table should end this run carrying dispatch and contract, and nothing about how a screen
is drawn.

## §6 `#43` — an executor that implements two of its seven declared inputs

`compose` declares seven inputs; captions and brand overlay are promised by the label and do not
exist. With §4 landed, the declaration is a schema rather than a label, so the gap becomes expressible.

It is not statically checkable — the executor is Python, the contract is a row. **So it is a contract
test per worker: the worker asserts it handles every input its capability declares.** That is the same
judgement you have made correctly three times now (the metering quantity rule, the trust-boundary rule,
the divergence contracts): when no honest static anchor exists, a contract through the real thing beats
a rule that flags the wrong scope.

Fix the declaration or fix the executor — **and say which you chose and why.** A capability that
declares an input nobody implements and a capability that implements an input nobody declared are the
same defect from two ends, and `BlueprintFitnessTest` currently sees only one end.

## §7 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | 100% local. No CI, no cloud. |
| AGENTS.md §4 | The contract is **rows**, declared in manifests. Not a Java map, not a resource file. |
| **Nothing goes inert to make room** | §4 before §5. A column dropped out from under a working rule is the defect this project keeps finding. |
| **Enumerate, do not grep-replace** | §3. |
| **Contract, not a bad rule** | §6. |
| **Build-breaking defects fixed on sight** | The M1.8 amendment. |
| **Every new rule or contract seen failing** | Plant, paste, revert — including a blueprint referencing an output field no capability declares. |
| **No repairs in passing** | Relist the open findings. |

## §8 Before declaring done

1. §0.1: the e2e suites **executed**, with their result.
2. §0.2: the web count closed per module.
3. `./mvnw -o clean install` green with all `*IT`; Python, CLI, web green; `spotless:check` and
   `docs-check` bound. State the Java count and its delta against **2 962**.
4. Every prior control active and green, diff empty unless deliberately extended.
5. §2: what else in §6 of `AGENTS.md` was wrong besides the sentence I named.
6. §4: the answer on `BlueprintFitnessTest` and `payload_template`, and the planted blueprint
   referencing an undeclared output, seen red.
7. §5: what `is_enabled` now means.
8. §6: declaration or executor, and why.
9. Open findings relisted in full.
10. **Commit if green. Never push.**

## §9 Next — M5, whose necessity M3 proved

A rule that reddens if any capability becomes reachable other than through a run. M3's
`DoorOneControlsIT` could not detect a restored direct controller — **a test of what the correct path
does cannot detect an additional incorrect path**, and absence is not assertable by sampling presence.
`DoorOneClosedTest` is that rule in embryo, scoped to one service; M5 is the repository-wide version,
and planting a direct controller must fail the build rather than a review.
