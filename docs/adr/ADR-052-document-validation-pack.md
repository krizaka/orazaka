---
title: "ADR-052 — The validation pack: verdicts that cite their rule, and no verdict on authenticity"
description: "Phase H. A SENSITIVE Tier-W pack receives all five controls with no engine code naming it; compliance produces (rule, severity, verdict, evidence span, explanation) with the model asked only where judgement is required; rulesets are versioned like blueprints and jurisdiction is an input, not a hint."
category: ADR
order: 52
---

# ADR-052 — The validation pack

- **Status**: Accepted
- **Date**: 2026-09-06
- **Scope**: `orazaka-packs/document-validation/**` (a pack, not engine code),
  `JdbcPackInstallRepositoryAdapter`, `orazaka-packs/echo-toolkit/worker/echo_worker.py`
- **Builds on**: [ADR-051](ADR-051-sensitive-controls.md) (the five controls),
  [ADR-049](ADR-049-open-core-split.md) (Tier-W)
- **Delivers**: compliance. **Defers**: authenticity (§7)

## 1. The split, and why it is not a matter of taste

Two things a document product could do, and they must never share a shape.

**Compliance produces verdicts.** A ruleset says what a document must contain; the document either
contains it or does not. The answer is checkable by anyone holding the same ruleset, which is what
makes it forwardable: the user sends this output to their counterparty, and a counterparty can
argue with `FR-LEASE-005 · FAIL · «Depot de garantie : 2 550 EUR» · Loi 89-462 art. 22` in a way
they cannot argue with a paragraph.

**Authenticity produces signals, never a verdict.** It is deferred here (§7), and the reason it is
deferred rather than half-built is that the two error costs are asymmetric and both are severe: a
false *"authentic"* on a forged lease is a legal exposure the platform created, and a false
*"forged"* on an honest tenant is worse — it accuses a person. Signals with confidence let a human
carry that decision. A verdict takes it from them.

## 2. Deterministic first — enforced by where the code sits, not by intent

A rule declares its `method`:

- `DETERMINISTIC` — a check the pack's worker evaluates **in code**: a required pattern, a
  forbidden clause, a numeric ratio. An auditor reads the regex. Nine of the ten FR rules are
  these, and none of them costs an inference.
- `JUDGMENT` — a question only a model can weigh (*is this penalty clause disproportionate?*).

**The model call is a blueprint step, not something the worker does.** The blueprint is
`screen → judge → report`: the pack's worker runs the deterministic pass and hands back the
*questions*; an ordinary `orazaka.core.chat.completion` step asks them; the worker folds the answer
in. A worker calling a model directly would bill nothing and nobody would notice — [BILL-001] in
the one place it would be easiest to reintroduce.

The fold refuses everything that is not a verdict. Unparseable output, a verdict outside the enum,
or an answer about a rule nobody asked about all degrade to `INSUFFICIENT_EVIDENCE` for that rule.
`INSUFFICIENT_EVIDENCE` is not a failure mode of the product: it is the fourth verdict, and it is
what stops "we could not tell" from being reported as "compliant".

## 3. A finding is a record

```json
{
  "ruleId": "FR-LEASE-005",
  "title": "Dépôt de garantie plafonné à un mois de loyer hors charges",
  "severity": "BLOCKING",
  "verdict": "FAIL",
  "evidenceSpan": { "start": 421, "end": 452, "quote": "Depot de garantie : 2 550 EUR" },
  "explanation": "Le dépôt de garantie excède un mois de loyer hors charges. …Constaté : 3.00 mois.",
  "method": "DETERMINISTIC",
  "citation": "Loi 89-462, art. 22"
}
```

`evidenceSpan` is `null` when the finding **is** an absence — a required clause that is not there
has no passage to quote, and saying so is information rather than a gap. Every other finding's span
points into the document by offset, and the suite asserts it: a span that does not resolve to the
text it claims is decoration.

The report carries no conclusion. `summary` counts verdicts and blocking failures; it does not say
whether the document is acceptable. That is the reader's call, and a product that made it for them
would be giving the advice its own scope guard refuses to give.

## 4. Rulesets are versioned like blueprints, and jurisdiction is an input

```
rulesets/fr-residential-lease/2024-07-01.json   effectiveFrom 2024-07-01, effectiveTo 2026-06-30
rulesets/fr-residential-lease/2026-07-01.json   effectiveFrom 2026-07-01
rulesets/be-residential-lease/2025-01-01.json
```

`resolve(rulesetId, asOf)` returns the version whose window contains `asOf` — **never the newest**.
A lease signed in 2025 is judged against the rules of 2025, and a run replayed next year reaches
the same verdicts. A date no version covers is an error, not an invitation to use the closest one.

Observed, on one document at two dates:

| `asOf` | Ruleset | New finding |
|:---|:---|:---|
| 2025-03-01 | `2024-07-01` | — |
| 2026-09-01 | `2026-07-01` | `FR-LEASE-009 · FAIL` — letting a class-G home, banned since 2025 |

And `FR-LEASE-008` (energy certificate) is `MAJOR` under the older ruleset and `BLOCKING` under the
newer. Same document, same tool, two correct answers.

**Jurisdiction is a required input with an enum**, not a sentence in a prompt. The same lease with
a two-month deposit fails `FR-LEASE-005` in France and passes `BE-WAL-002` in Wallonia — measured,
not asserted. A pack asked for a jurisdiction it does not carry **refuses by name** and lists what
it has; falling back to another country's law would produce a confident report against rules that
do not apply.

### `version` is the law changing; `revision` is the pack correcting itself

Phase H's first live run produced a **false `FAIL`**: the deterministic rules matched `€` and
`euros` but not `EUR`, which is how a French lease is routinely written, so a lease that stated its
rent was reported as stating no rent. A compliance tool that accuses an honest party is the failure
this product exists to avoid, and it was found by running it, not by reading it.

Fixing it changed the answer for a fixed `asOf`, which is exactly what versioning promised would
not happen. So a ruleset now carries **both**: `version` — the date the *law* takes effect — and
`revision` — how many times this pack has corrected its own reading of it, with a `revisionNote`.
Every report states both. A customer asking why last month's report differs can be told which of
the two moved, and those are very different conversations.

## 5. The criterion

> A pack declaring `regulatory_class: SENSITIVE` receives its controls with **no engine code naming
> that pack**.

`document-validation` declares `SENSITIVE` and a `scopeGuard`. Measured over its ten runs:

| Control | Evidence |
|:---|:---|
| 1 — data class | 10 runs, all `data_class = SENSITIVE` |
| 1 — analytics | **0** of them visible to `StudioAnalyticsService` |
| 3 — audit | 20 rows (two per run); `UPDATE` → *"studio_run_audit is append-only (ADR-051)"* |
| 4 — scope guard | *"quelle action en justice ? Donne-moi un conseil juridique"* → `FAILED`, answered with the pack's own sentence; the same Studio drafts a compliance report normally |
| 5 — asset store | satisfied here by `assets.deployment: LOCAL`; the same bundle is refused on a hosted deployment (ADR-051 §8) |

And the negative half:

```bash
grep -rniE '"document-validation"|"compliance-check"|fr-residential-lease|conseil juridique|89-462' \
  --include=*.java --include=*.py --include=*.sql --include=*.ts orazaka-libs orazaka-apps infra scripts
# (no matches)
```

The engine names neither the pack, its Studio, its ruleset, nor the law it applies.

## 6. What phase H found by running it

Four obstacles a third-party pack author hits, none of them visible from reading the code.

**The broker password has three names.** Java services and `infra/docker-compose.yml` read
`RABBITMQ_PASS`; the CLI's `init` writes `RABBITMQ_PASSWORD` into the compose it generates; the
CLI's own compose uses `SPRING_RABBITMQ_PASSWORD`. A worker that picks one gets
`ACCESS_REFUSED (403)` and no diagnosis. Both reference workers now read all three and say why in a
comment. **Settling on one name is not done here** — renaming an environment variable across every
service, the compose files and the CLI is the deferred cosmetic churn AGENTS.md §3 warns about, and
it should be one change, not a side effect of a pack.

**Re-installing a pack silently keeps the old blueprint.** `ON CONFLICT DO NOTHING` on
`studio_blueprint` is correct — a `PUBLISHED` version is immutable and shipping a change means
shipping a new version — but it reported *"Installed"* while running the previous definition, with
nothing anywhere saying so. It now logs what it kept and why. The behaviour is unchanged; only the
silence is.

**A step's whole output is not addressable as data.** `{{steps.out.field}}` resolves; `{{steps.out}}`
interpolates the value's `toString`, which for a map is a Java rendering no JSON parser accepts. That
is right for a prompt, which is what the syntax was built for, and wrong for structured data crossing
a model call. The pack carries its own structure as an explicit JSON field — one line, and the
engine keeps a behaviour every shipped blueprint depends on.

**The typed failure cause bites a fourth time.** With `judge` set to `onError: SKIP`, a scope-guard
**refusal** was swallowed exactly like a model outage: the run continued and produced a report with
the judgment rule marked `INSUFFICIENT_EVIDENCE`. The saga cannot tell "the model was down" from
"the guard refused", because [ADR-046 §2](ADR-046-asset-lists-and-failed-run-settlement.md) left the
typed cause open. Lacking it, the pack takes the blunt option — `onError: FAIL` — on the grounds
that a compliance report which silently omits a rule is the artefact this product must never emit.
**This is the fourth case where the missing typed cause forced a coarser decision than the facts
warranted**, and it is the argument for closing it.

## 7. Authenticity, and the rule it must be built under

> **Built, 2026-09-11 — [ADR-056](ADR-056-authenticity-signals.md).** Every rule below is
> implemented and tested. One addition this section did not anticipate: the Studio has **no
> inference step at all**, not even a constrained one. The sentences a reader sees are written by
> hand per signal type, which costs seven sentences and removes the only place confabulation could
> enter.

Not built. When it is, it is bound by this ADR:

- **It emits signals, never a verdict.** No `AUTHENTIQUE ✓`, no score presented as a conclusion.
  *"3 indices de modification possible : producteur PDF incohérent avec l'émetteur, couche de texte
  ajoutée après création, …"* — each with its confidence and what it was read from.
- **A signal names its observation, not its inference.** "The PDF producer string is
  `Microsoft Word` while the issuer's other documents carry `Adobe InDesign`" is a signal. "This
  document was altered" is a verdict wearing a signal's clothes.
- **The human decides.** The pack surfaces what it saw and stops. Nothing in the output may be
  phrased so that forwarding it reads as an accusation the tool has made.
- It is a **separate Studio**, not a section of the compliance report, so that a compliance verdict
  can never be read as carrying an authenticity claim.
