---
description: UNIFIED SURFACE — M5 (the repository-wide rule that stops door 1 growing back). The last phase of the sequence.
---

# Workflow: M5 — the bypass cannot reopen

Design intent: [`docs/UNIFIED_PACK_SURFACE.md`](../../docs/UNIFIED_PACK_SURFACE.md) §5 (M5 row).
Prior runs: ADR-061…069. Immediate predecessor: the entitlement grants commit.

> **Why this phase exists, proven rather than argued.** M3 planted a restored direct controller and
> `DoorOneControlsIT` stayed green: it asserts what the run path produces, and a second door does not
> disturb the first. **A test of what the correct path does cannot detect an additional incorrect
> path** — absence is not assertable by sampling presence. `DoorOneClosedTest` is the right shape,
> scoped to one service. M5 is the repository-wide version.

## §0 Init

1. Load `AGENTS.md` — §0, §2, §3, §6 (as corrected in M4), §9, §11, §12.
2. Read `DoorOneClosedTest` — **this is the rule you are generalising, not replacing.**
3. Read `orazaka-libs/orazaka-build/orazaka-test-support/.../architecture/{GovernanceRules,SourceFileScanner}.java`
   and one existing family (`[LANE-001]`, `[CFG-001]`, `[PACK-001]`) for the shape.
4. Read the M4 report's §0.1 findings on the e2e harness.

## §1 Scope

One rule family, repository-wide, plus its ADR. Nothing else.

**Out of scope, do NOT start** — `#19`, `#29`, `#33`, `#34`, `#36`–`#42`, `#47`, the twelve of
ADR-069 §6, the seam-input audit. Relist the open findings and close none in passing.

## §2 The rule

**Every capability invocation reaches the broker through a run.** Concretely, no class in an
`adapter.rest` (or equivalent inbound) package, in any module, may reach the job-dispatch path.

`DoorOneClosedTest` already names the two sinks — `JobService.createJob` and
`JobQueuePublisherService.publish`. Generalise **the property, not the list**: derive the sinks from
what actually publishes to `orazaka.jobs` rather than transcribing two names. A hand-written list of
sinks is the `BlueprintFitnessTest` output table again, and it will be wrong the first time someone
adds a third publisher.

Two exemptions exist today and both must be **declared in the rule with their reason**, never
suppressed:

- `JobController.approveJob` — approval is a gate in front of work already written, not an entry.
  M3 established this when the compiler refused the deletion.
- `orazaka.core.chat.completion` — synchronous, off the broker, never door 1, and AGENTS.md §6 keeps
  it that way.

An exemption that is a list entry with no reason is how the next one gets added silently.

## §3 The standard this rule is held to

M4 set it and it is not negotiable here: **a rule that needs a plant to go red is a rule about
hypotheticals.** `[CFG-001]` was corrected until it reddened on production code as it stood.

So:

1. **Run it against the repository as it is, first.** If it finds nothing, say so explicitly — that
   is a result, and it means door 1 is genuinely shut. If it finds something, that is the run.
2. **Then plant**, in a module `DoorOneClosedTest` does not cover, and watch it redden. One service
   passing is not repository-wide.
3. **Check the population.** `[CFG-001]` counted non-private constructors while the container counted
   all of them — precise about the wrong set. State, in one sentence in the ADR, **what population
   this rule examines and why it is the same one the property is about.** If inbound adapters live
   under a different package name in any module, the rule must find them there too.

## §4 The rule must not borrow the e2e harness

The harness just found five layers of defects and carries three of its own: no teardown on a red
build, not hermetic, and an assertion form that vanishes without reporting. **It is currently the
least-verified component in the project.** M5's proof is static and must stay static — no part of
this rule may depend on a running stack.

## §5 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | 100% local. No CI, no cloud. |
| ERR-103 | One top-level type per file **+ one mirroring test file**. |
| **Derive, do not transcribe** | §2. Sinks come from what publishes, not from a list. |
| **Exemptions carry reasons** | §2. |
| **Red on production code, not only on a plant** | §3.1. |
| **Static proof only** | §4. |
| **Build-breaking defects fixed on sight** | The M1.8 amendment. |
| **No repairs in passing** | Relist the open findings. |

## §6 Before declaring done

1. `./mvnw -o clean install` green with all `*IT`; Python, CLI, web green; `spotless:check` and
   `docs-check` bound. State the Java count and its delta against **2 956**.
2. Every prior control active and green, diff empty unless deliberately extended.
3. §3.1: what the rule found on the repository as it stands — including "nothing", if that is the
   answer.
4. §3.2: the plant, in a module the old rule did not cover, seen red, reverted.
5. §3.3: the population sentence.
6. The exemptions, each with its reason.
7. Open findings relisted in full.
8. **Commit if green. Never push.**

## §7 After M5 — the sequence is finished, and what is left is not

`UNIFIED_PACK_SURFACE.md` closes with this run. What remains is **not** a continuation of it and
should not be picked up without a decision:

- **The deployment block** — `#19` (the M2M JWT, where a caller declares its own scopes), Flyway
  before the first real data row, PITR with a restore drill actually performed, an edge read timeout
  and circuit breaker, rate limiting on identity/billing/studio.
- **The seam-input audit** — four seams were opened for open-core (executor SPI, worker registration
  and `worker.yaml`, pack manifests, admin-authored blueprints); one was examined and it had the
  defect (`consumption.putAll(reported)`, where an out-of-tree executor could overwrite a measurement
  the platform took). **Before any third-party pack is installed**, not before a phase.
- **The harness** — the three 🔴 of ADR-069 §6.
- **The open findings** — `#29`, `#33`, `#34`, `#36`–`#42`, `#47`, and the twelve of ADR-069 §6.

Whichever comes next is the owner's call, not the next workflow's.
