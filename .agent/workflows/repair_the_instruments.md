---
description: Post-sequence — repair the instruments. The e2e harness and the governance registry are the two things that tell you whether the controls work, and both are wrong.
---

# Workflow: repair the instruments

Prior runs: ADR-061…070. Findings: ADR-069 §6 (the harness) and M5's new 🟡 (the registry).

> **This run repairs nothing in the product, and that is not a shortcoming.** Its entire output is
> that future greens mean something. Do not measure it by defects fixed — measure it by the number of
> ways a meaningless green remains possible when it ends.
>
> **Why it comes first.** Ten runs established one property: *a green must be able to be red.* Two
> instruments now violate it. The e2e harness can drop an assertion without reporting it, can answer
> from a stale stack, and is not hermetic. The generated registry — the index of all eleven controls
> these runs built — reports `Enforced by none` for seven rules that are enforced. Every other
> remaining chantier (the seam-input audit, the deployment block, the open findings) will be verified
> *with* these two instruments. They go first.

## §0 Init

1. Load `AGENTS.md` — §0, §9, §10 (the registry's contract), §11.
2. Read ADR-069 §6 in full, and M5's ADR for the registry finding.
3. Read, **before writing anything**:
   - the e2e harness: start, health-wait, teardown, and the `docker compose` invocation
   - the httpyac suite — all 121 requests — and how results are counted
   - `GOV-006` (the empty-set guard) and the Python collection guard from M1.7. **These are the two
     prior solutions to this exact problem; §1 is the third application, not a new invention.**
   - `scripts/generate-docs.mjs` and whatever produces the governance registry table

## §1 The harness can delete an assertion without saying so

`["TEXT","ASSET"].includes(…)` produces neither ✓ nor ✖ — the line disappears. So **any** assertion in
the suite may not be running, and nothing says which.

The fix is not "avoid that form". It is the pattern this project has already applied twice: in Java,
`GOV-006` fails a rule that completes having examined zero subjects; in Python, the guard asserts that
tests defined equals tests collected. **Third medium, same property: assertions declared must equal
assertion results reported.**

1. Count the assertions the suite declares, count the results it reports, fail on any difference.
2. **Run it against the 121 requests as they stand and report the number that are currently silent.**
   That is the finding of this section, and it is the only way to know what the tier-1 pass of M4
   actually proved.
3. Plant an assertion in the vanishing form, watch the counter catch it, revert.

## §2 A stale stack is worse than a slow one

The harness does not tear down on a red build. Twenty-one minutes were lost to an `/actuator/health`
answered by the previous run's stack.

The lost time is the visible half. **The other half is that a stale stack answers on the right port
with the wrong code** — so a green can come from yesterday's build, and nothing in the harness can
tell the difference. That is a meaningless green by construction, and it is exactly what this run
exists to remove.

1. Teardown always — on red, on green, on interrupt.
2. **And make the harness prove it is talking to this build.** A commit sha or build id the service
   echoes and the harness checks before the first request. Teardown prevents the waste; the identity
   check prevents the wrong answer, and only one of those was noticed.
3. Plant: point the harness at a stale service, watch it refuse rather than proceed.

## §3 "Hermetic" is a claim, not a property

§9 calls the e2e hermetic and it is not. The harness runs `docker compose up` against a surviving
volume, so `infra/initdb` never replays — **which is precisely what hid the schema drift M4 spent four
of its eight passes discovering.**

Hermetic must mean: from an empty volume, seeds replayed, migrations applied, packs bootstrapped, a
working stack.

You will hit the open finding that **nothing applies `infra/migrations/*.sql`** — they have been
applied by hand, run after run. That is the point where this section could turn into Flyway adoption.
**It must not.** Scope: the harness reaches a working stack from empty by a documented, scripted path.
If no such path exists, *that* is the finding, and the minimum fix is the script — deciding whether
Flyway owns migrations is a separate decision with its own trigger, and it is the owner's.

Prove it by running twice from empty and getting the same result.

## §4 The registry says `none` about seven rules that are enforced

Attribution is by method name and does not distinguish two overloads. AGENTS.md §10 makes that column
a finding when it reads `none` — so seven false positives teach the reader to ignore it.

The eleven previous instances of this project's defect produced a **green that meant nothing**. This
one produces a **red that means nothing**: the mechanism works and the humans stop looking. It fails
socially rather than silently, and it is in the index of every other control.

1. Fix the attribution. Prefer deriving it from what the suites actually invoke over matching names.
2. **Then ask the M1.7 question again with a working instrument: after the fix, does any rule
   genuinely read `none`?** Six orphan rules were found that way once. Report the answer.
3. Plant a rule enforced only through an overload, watch it attribute correctly, revert.

## §5 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | 100% local. No CI, no cloud. |
| **Third application, not a new invention** | §1. `GOV-006` and the Python collection guard are the precedent; copy the property. |
| **No Flyway adoption** | §3. The harness needs a scripted path from empty, not a migration framework. |
| **Every instrument proven by being made to lie** | Each section ends with a plant that the repaired instrument catches. |
| **Build-breaking defects fixed on sight** | The M1.8 amendment. |
| **No repairs in passing** | The 🔴 GraphQL/CLI mismatch, `#33`, `#34` and the rest stay open and get relisted. |

## §6 Before declaring done

1. `./mvnw -o clean install` green with all `*IT`; Python, CLI, web green; `spotless:check` and
   `docs-check` bound. State the Java count and its delta against **2 969**.
2. Every prior control active and green, diff empty unless deliberately extended.
3. §1.2: **how many of the 121 assertions were silent.** This number is the headline of the run.
4. §2.3, §3, §4.3: each plant, its output, its revert.
5. §3: the harness run twice from empty, same result, and whether a scripted migration path existed.
6. §4.2: whether any rule genuinely reads `none` now.
7. **The closing statement: what ways of producing a meaningless green remain**, named. If the honest
   answer is "none that I know of", say that; if there are more, they are the next run.
8. Open findings relisted in full.
9. **Commit if green. Never push.**

## §7 What comes after, and why it is not another audit

**Use the thing.** Four packs exist — prospection, validation, wellbeing, media — and nobody has used
any of them for what it does. The best finding of the validation phase came from its first real run
producing a **false FAIL**, because the rules accepted `€` and `euros` but not `EUR`. No rule would
have found that. It was found by using it.

A real estate reel with real photos. A real lease through validation. The wellbeing pack on a
plausible conversation. That is the defect class that survives every audit, and it is the only one
that touches what a user will see.

Then: the seam-input audit — **its trigger is not yours**, it is someone installing a third-party
pack, and the one seam examined carried a real defect. Then the open findings, `#33` and `#34` first
because M2.5's lanes increased their rate, and the 🔴 GraphQL endpoint the CLI calls with no server
behind it. The deployment block last, the day deployment is decided.
