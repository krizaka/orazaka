---
description: Post-evaluation — unblock the packs, then give rulesets the property every governance rule in this repository already has: a pair of fixtures it must distinguish.
---

# Workflow: a ruleset is a test suite pointed at the user's document

Source: `docs/evaluations/first-real-use.md` — 18 findings, **12 of them content-caused**, a class
eleven runs of verification never found once.

> **The insight this run is built on.** `FR-LEASE-001` checks that the word *bailleur* appears, for a
> requirement that is the identity of the parties. Every lease contains that word. It is **an
> assertion that runs, over a real subject, and cannot fail** — rung 4 of the ladder these runs spent
> twelve phases climbing, except this one is in the product and its output tells someone their
> contract is compliant.
>
> Every property established for governance rules applies to rulesets, and none was ever applied to
> them, because they were treated as content rather than as assertions. **That is what this run
> changes.** Fixing `001` and `003` without it repairs two rules in a ruleset that has never been
> confronted.

## §0 Answer first, before any work

**Is the grants guard present, and is it passing on four unusable packs?** The grants commit was asked
for exactly this: *no `PUBLISHED` studio of an installed pack without a grant in at least one plan*.
The evaluation found four of six packs unusable on a fresh volume on the highest plan. Either the
guard was never added, or it is green on four packs it should redden on — **and the second case is a
thirteenth control that declares itself active.** Say which, in one paragraph, before anything else.

## §1 Order — two halves, and the second is the one that matters

§2 the code blockers (small, and they gate verification of everything else) · §3 the fixture pair ·
§4 `FR-LEASE-001` and `003` as its first application · §5 two decisions, not builds.

**Out of scope, do NOT start** — the eighteen findings not named here; `#19`, `#29`, `#33`, `#34`,
`#36`, `#38`–`#42`, `#47`; the five meaningless-green paths of ADR-071 §6.7; the seam-input audit; the
deployment block. Relist the open findings.

## §2 The code blockers

Four, and they are small. They come first because **you cannot evaluate a ruleset whose worker never
starts.**

1. **The validation worker is started by nothing** — a run stays `RUNNING` indefinitely and its
   message is discarded by the broker. A pack that ships a worker and no way to start it is a pack
   that cannot run; say where the gap is (compose file, bootstrap, `worker.yaml`) and close it.
2. **Four of six packs unusable on a fresh volume** — §0's answer decides whether this is a missing
   guard or a green one.
3. **No job row exists for any step** (`#37`). This is why one of the four SENSITIVE controls came
   back **not observable**: `data_class` on jobs cannot be checked when there are no jobs. A control
   built in M1.8 has never been verified because of it.
4. **`timeout: PT2M` declared and not applied** — twenty minutes observed. A declared control that
   does nothing, in a pack manifest, which is the one place this defect had not yet been found.

## §3 The fixture pair — the substance of this run

**Every ruleset rule ships with two fixtures it must distinguish**: a document fragment that must
PASS it, and one that must FAIL it. The pack does not install if any rule fails to distinguish its
own pair.

That single property catches both proven defects and the class behind them:

- a rule that **always passes** fails its negative fixture → `FR-LEASE-001`, `002`
- a rule that **always fails** fails its positive fixture → `FR-LEASE-003`

It is the same demand this repository has made of every governance rule for twelve phases — *plant,
see it red, revert* — moved to where it reaches a user. The difference is that here it is enforced at
install time rather than by discipline, because a ruleset is authored by someone who may be outside
this repository and cannot be asked to remember (AGENTS.md §12).

Mechanically: fixtures are declared beside the rule in the ruleset; the installer runs each rule
against its pair and refuses the pack on any rule that does not discriminate. Plant a rule that
matches everything, watch the install refuse it, revert.

**Then run it against the existing rulesets and report how many rules currently cannot distinguish
their own pair.** That number is the headline of this run, exactly as "how many of the 121 assertions
are silent" was the headline of the last.

## §4 `FR-LEASE-001` and `003` — the first application, not two repairs

Both are the same defect, and naming it correctly decides how much else is wrong:
**a lexical check where the law states a semantic fact.**

- `001`/`002` look for the word *bailleur* / *locataire*; loi 89-462 art. 3, 1° requires the parties to
  be **identified**.
- `003` looks for the presence of a duration clause; art. 10 requires a term of **at least three
  years** for an individual lessor. The evaluation's document said *"pour une durée de deux ans"*
  under an article titled *Durée* — so `003` returned a false FAIL **and** missed the real violation in
  the same pass.

Fix both. **Then read the rest of the ruleset with that distinction in hand** and report which
requirements are genuinely lexical (a mandatory mention must appear) and which are semantic. Do not
fix the others in this run — the count is what says whether this is two rules or a ruleset.

And `evidenceSpan: null` on a FAIL: a finding the user forwards to a counterparty must survive being
checked. Say whether a FAIL without a span should be emittable at all.

## §5 Two decisions — record them, do not build them

**1. All guards are input-side, and the wellbeing pack proved it costs.** Every gate passed — consent,
region, age, the four crisis resources verified at source, the scope guard refusing in the pack's own
words and not refusing its own template — and `guided-journaling` produced the second-person reassuring
adviser that ADR-055 excludes for regulatory reasons. The scope guard reads the subject; the crisis
guard reads the subject; **nothing reads the output**, and this pack's regulatory risk is in the
register of what it produces.

Fix the prompt. **Do not build an output guard in this run**, and here is why: the cheap version is a
lexical check for second-person pronouns and imperative verbs — which is precisely the defect §4 just
named, rebuilt one layer out. The expensive version is a second model pass, whose checker has the same
failure mode as the thing checked. Record the gap as an architectural decision with its trigger:
**before the wellbeing pack is offered to anyone outside this project.**

**2. A refused run has already billed the step that ran before the refusal.** The scope guard fires on
`judge`, so `screen` succeeded and was charged. Work was done, so it is defensible — but being billed
to be told *"I do not give legal advice"* is an experience worth choosing rather than inheriting.
Decide, write the decision where a reader finds it, and if the answer is "refund the run on a guard
refusal", that is a change for a later run.

## §6 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | 100% local. |
| AGENTS.md §12 | Fixtures are declared by the pack; the engine holds the mechanism and never the subject. |
| **Discrimination, not presence** | §3. A rule is a control only if some input makes it fail. |
| **No lexical guard on output** | §5.1. |
| **Every new rule seen failing** | Plant, paste, revert. |
| **No repairs in passing** | Twelve other findings stay open and get relisted. |

## §7 Before declaring done

1. §0 answered in its own paragraph, first.
2. `./mvnw -o clean install` green with all `*IT`; Python, CLI, web green; `spotless:check` and
   `docs-check` bound. Java count and delta.
3. §2.3: with job rows existing, **verify `data_class` on jobs for a SENSITIVE run** — the control
   that came back not observable.
4. §3: **how many existing rules cannot distinguish their own fixture pair.** The headline.
5. §4: the lexical-versus-semantic count across the whole ruleset.
6. §5: both decisions written, neither built.
7. Open findings relisted in full.
8. **Commit if green. Never push.**
