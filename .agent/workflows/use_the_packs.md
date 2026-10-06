---
description: Post-sequence — use the packs for what they do. An evaluation, not a repair: the output is a list of findings, and fixing one is how the list stops at one.
---

# Workflow: use the packs

Prior runs: ADR-061…071. Eleven runs of verification; zero runs of use.

> **This is an evaluation and its deliverable is a list.** The natural failure of "go use the pack" is
> that the first real defect gets fixed and the evaluation stops there. **Fix nothing in this run.**
> A list of fourteen findings is worth more than one repair, because the list is what nobody has ever
> had.
>
> **Why this and not another audit.** The best finding of the validation phase was its first real run
> producing a **false FAIL** — the rules accepted `€` and `euros` but not `EUR`. No rule found it, no
> test found it, no plant found it. Someone ran a document through. Eleven runs have closed every
> defect class a rule can see; this is the class that survives all of them, and it is the first one a
> user meets.
>
> It is also the strongest assertion-discrimination test available. The five remaining ways to produce
> a meaningless green (ADR-071 §6.7) are all about assertions that cannot fail. **You cannot write a
> vacuously-true assertion about whether a lease actually contains an indexation clause.** The oracle
> is a human reading the output and knowing whether it is right.

## §0 Init

1. Load `AGENTS.md` — §0, §9, §11, §12.
2. Read the three content packs' `pack.yaml` and blueprints, and `orazaka-media`'s six.
3. Bring up a working stack by the scripted path §3 of the previous run established.
4. **Have the six harness facts you recorded in memory written into the repository first** — a
   `README` beside the harness or an entry under `.agent/rules/`. Each cost a fifteen-minute pass to
   establish and none is visible from the code. Knowledge that lives only in a session's memory is one
   session away from costing those passes again; the repository is where someone debugging the harness
   looks.

## §1 Order — validation first, then media. Wellbeing is §4 and is different.

## §2 Validation on a real lease

The pack that exercises **all four SENSITIVE controls with real content** — data class, shortened
retention, append-only audit, scope guard — which is exactly what M3 was built to deliver and what has
never once been observed with a real document.

Use a genuine residential lease. Run it through `compliance-check`, then `document-authenticity`.

Record, per finding the pack emits:

| What to record | Why |
|:---|:---|
| The finding: `(ruleId, severity, verdict, evidenceSpan, explanation)` | It is a record, not prose — that was the design claim |
| Is the verdict **correct**? Read the clause yourself | This is the oracle and it is the whole point |
| If wrong: **false PASS or false FAIL** | A false PASS tells someone a contract is compliant when it is not. That is the worst failure this product can have |
| Does `evidenceSpan` point at the text the verdict is about? | A finding the user forwards to a counterparty must survive being checked |
| What the pack **did not look at** and does not say so | The authenticity report is supposed to state what it did not examine |

Then verify the four controls, from the database, on that run: the `data_class` on the run and its
jobs; the retention window applied; the audit row present and carrying **no user content**; the scope
guard resolved. And ask the pack something out of scope — legal advice — and check the refusal is the
pack's own wording.

## §3 A real estate reel with real photos

The request that began this whole sequence. Four or five real photographs of a real property, a short
clip or none.

The oracle here is not objective and that is the point: **would an agency post this?** No test can
assert that. Record the output, and record your own judgement of it plainly — if it looks like a
slideshow with music rather than a reel, say so.

Known gaps to confirm rather than rediscover: `compose` implements two of its seven declared inputs
(`#43`), so `captions`, `brandKit`, `clip`, `bRoll` and `aspect` do nothing. **Confirm what the user
actually gets** versus what the Studio's label promises. A Studio that promises captions and silently
omits them is a product defect with a code cause, and the user sees only the first.

Also record: total credits charged against the artefact produced, end to end, and the wall-clock time
from click to reel.

## §4 Wellbeing — verify the safety surface, do not improvise distress

**Do not simulate a person in crisis to test this pack.** That is not a test, and the pack's crisis
responses are fixed and human-reviewed precisely so that nothing generates them.

What to verify instead, all of it checkable:

1. The crisis resources are **correct and current**, per region, against their sources and dates. The
   Belgian line was nearly shipped in the wrong language for a francophone caller — 0800 32 123 is
   francophone, 1813 is Dutch-speaking. Re-verify every resource the same way.
2. The consent gate blocks installation when consent is absent, and records the **statement version**.
3. `region` has no default and an unstated region is an install that does not happen.
4. The scope guard refuses out-of-scope requests with the pack's own wording, and — the defect found
   once already — **does not refuse the pack's own template**, which legitimately contains the words
   it refuses.
5. The pack does not install outside the regions whose resources are sourced.

## §5 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | 100% local. |
| **Fix nothing** | The deliverable is the list. If something is build-breaking, that is the one exception (the M1.8 amendment). |
| **The oracle is you reading the output** | Not a passing test. Where you cannot judge, say you cannot judge. |
| **Real inputs** | A synthetic lease that the rules were written against proves the rules match themselves. Use a real one. |
| **No distress simulation** | §4. |
| **Record what you could not evaluate** | The honest gaps are part of the deliverable. |

## §6 The deliverable

`docs/evaluations/first-real-use.md`, and it is a report rather than an ADR because nothing was
decided:

1. One paragraph per finding, with severity, what the user saw, and what should have happened.
2. **Separated into two lists**: defects with a code cause, and defects with a *content* cause — a
   ruleset that reads a law too narrowly, a label that promises what the blueprint does not do, a
   prompt that produces the wrong register. Eleven runs have only ever found the first kind, and the
   second kind is the one a user notices.
3. The four SENSITIVE controls, each observed or not observed, on a real run.
4. What you could not evaluate and why.
5. No fixes. No commits beyond §0.4 and the report itself.

## §7 After this

The list decides. If the content-caused defects outnumber the code-caused ones — which I expect — then
the next work is in the packs and not in the engine, and that is a different kind of run from the
eleven before it.

Still waiting, each with its own trigger: the seam-input audit (**trigger not yours** — someone
installing a third-party pack, and the one seam examined carried a real defect); the five remaining
meaningless-green paths of ADR-071 §6.7, chief among them assertions that run and cannot fail;
`#33`, `#34` and the open list; the 🔴 GraphQL endpoint the CLI calls with no server behind it; and the
deployment block, the day deployment is decided.
