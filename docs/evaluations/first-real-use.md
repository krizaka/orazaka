# First real use — an evaluation

- **Date**: 2026-09-23
- **Stack**: local, from an empty volume by the scripted path (ADR-071 §4)
- **Nature**: evaluation, not repair. **Nothing in this report was fixed.**
- **Prior**: ADR-061…071 — eleven runs of verification, zero runs of use

> Eleven runs closed every defect class a rule can see. This run used the packs and found a
> different class. **Of the eighteen findings below, six have a code cause and twelve have a content
> cause** — a ruleset reading a law through one turn of phrase, a label promising what a blueprint
> does not do, a prompt producing the wrong register. The second kind is the one a user meets first,
> and it is the kind no rule, plant or test in this repository can see.

Two sections remain **pending real content**, not unevaluable: the clause-by-clause verdict oracle on
a genuine lease, and "would an agency post this reel". Everything mechanical was done (§6).

---

## A. Defects with a CONTENT cause

### A1 🔴 `FR-LEASE-001` and `FR-LEASE-002` are false PASSes on a BLOCKING requirement

The rules that check the parties are identified:

```json
{ "ruleId": "FR-LEASE-001", "severity": "BLOCKING",
  "check": { "type": "REQUIRED_PATTERN", "pattern": "(?i)\\b(bailleur|propri[ée]taire)\\b" },
  "onPass": "Le document nomme le bailleur." }
```

Art. 3, 1° of the loi 89-462 requires **the identity** of the parties — a name, a domicile. The check
requires the *word* `bailleur`, which appears in every lease ever written, including one that names
nobody at all. The document run here contains no party name whatsoever and both rules returned
**PASS**.

**This is the worst failure this product can have.** It tells a user that a blocking legal requirement
is satisfied when nothing verified it — and the `onPass` prose, *"Le document nomme le bailleur"*,
asserts a fact the check never established. A BLOCKING rule that every document passes is not a
control; it is a line in a report that makes the report look thorough.

### A2 🔴 `FR-LEASE-003` is a false FAIL — the `EUR` defect, one iteration later

```json
"pattern": "(?i)dur[ée]e\\s+(?:du\\s+)?(?:bail|contrat|location)"
```

The document says **« Le présent bail est consenti pour une durée de deux ans »**, under a heading
reading **« Article 2 — Durée »**. Neither matches: the rule demands *durée du bail*, *durée bail*,
*durée contrat* or *durée location*, and "durée **de deux ans**" is none of them.

Verdict returned: `FAIL`, `severity: BLOCKING`, `evidenceSpan: null`, explanation *"Aucune durée
n'est énoncée."* — which is factually false about the document in front of it.

This is exactly the defect the validation phase found on its first real run (the rules accepted `€`
and `euros` but not `EUR`), in a different rule, still present. **The ruleset reads the law through
one turn of phrase.** A real lease will phrase it a dozen ways.

*Aside, and it matters for how the rule should be rewritten:* the document states **two years**, which
for a bailleur personne physique would itself be a substantive non-compliance (art. 10 sets three).
The rule that should have caught a real violation instead reported the absence of a clause that is
there.

### A3 🟡 `evidenceSpan.quote` carries the model's prose, in English, in a French report

`FR-LEASE-020` (the one `JUDGMENT` rule) returned:

```
evidenceSpan.quote = "Insufficient evidence to determine whether there is a penalty or fixed
                      indemnity that is manifestly disproportionate to the damage it sanctions."
```

`evidenceSpan` is the field a user forwards to a counterparty as *the text the verdict is about*. Here
it holds the model's own sentence, not a quote from the document, and in a language the rest of the
report is not written in. A finding that cannot survive being checked is worse than no finding.

### A4 🟡 The evidence spans of the passing rules quote a word, not a clause

`FR-LEASE-001` → `quote: "bailleur"`. `FR-LEASE-002` → `quote: "locataire"`. Forwarded to a
counterparty, these are not evidence of anything. Contrast `FR-LEASE-005`, which is exemplary:
`quote: "dépôt de garantie de 1 560 EUR"`, with arithmetic in the explanation (*"Constaté : 2.00
mois"*) and the right citation. **The pack can do this well; two of its ten rules do not.**

### A5 🟡 `guided-journaling` produces the register its own manifest forbids

The prompt asks for: *"Écris trois à cinq paragraphes **à la première personne**, en reprenant ses
mots"*, and the pack's positioning is *"ce que la personne apporte à son ou sa thérapeute"*.

Entry submitted: *"Cette semaine j'ai eu du mal à me concentrer au travail et je dors mal. Je voudrais
en parler à ma thérapeute mardi."*

What came back:

> **Je suis désolé d'apprendre que** cette semaine **vous avez** rencontré des difficultés à vous
> concentrer au travail et que **vous n'avez pas** bien dormi. Ces changements peuvent être
> stressants… **n'hésitez pas** à préparer plus d'informations pour mieux vous éclairer.

Three things are wrong and all three are the prompt's fault, not the model's:

1. **Second person, not first.** The Studio's whole output contract is a journal entry in the user's
   voice. This is a letter written *to* the user.
2. **The assistant reassures.** *"Je suis désolé d'apprendre que…"*, *"Ces changements peuvent être
   stressants"*. The manifest says, as a regulatory posture, *"tu ne rassures pas à la place d'un
   professionnel"*. The output opens with reassurance in the assistant's own voice.
3. **It advises.** *"n'hésitez pas à préparer…"*, *"vous pourriez lui parler de…"* — the pack is
   positioned as not-care, and this is coaching.

The pack's entire regulatory argument (ADR-055: not "thérapie", no medical claim, defensible
positioning) rests on the product not adopting this register. **A one-paragraph prompt change would
fix it, and no test in this repository could ever have detected it.**

### A6 🟡 Five of the six shipped Studios show their raw key as their label

`studio_i18n` has rows for `realestate-reels` only (`fr: "Reels Immobilier"`, `en: "Real-Estate
Reels"`). `compliance-check`, `document-authenticity`, `guided-journaling`, `mood-tracking` and
`session-preparation` have **no i18n row at all**, so the install response returns
`"label": "compliance-check"` and the UI has nothing else to show.

A user installing the two most sensitive packs in the catalogue sees `compliance-check` and
`guided-journaling` as button labels.

### A7 🟡 The reel accepts a video clip and silently discards it

`realestate-reels` declares an input `clip`, titled **« Clip vidéo (optionnel) »**. The string
`inputs.clip` appears **nowhere** in the blueprint's definition. A user attaches a clip of the
property and nothing consumes it — no error, no mention in the output.

### A8 🟡 The platform choice changes the caption and not the video

`platform` (`instagram-reel` | `tiktok` | `youtube-short`) is referenced in exactly one place: the
`script` step's prompt (*"Écris le script d'un Reel immobilier pour {{inputs.platform}}"*). The
`assemble` step receives `{"photos": "{{inputs.photos}}"}` and nothing else, so the aspect ratio is
whatever the worker defaults to. **Choosing TikTok gets you a TikTok-flavoured caption on an
unchanged video.**

### A9 🟡 `{{steps.roomDescriptions}}` references a step, not a field

Every other reference in the blueprint names a field — `{{steps.script.content}}`,
`{{steps.reel.url}}`. This one does not, so the vision step's whole output object is interpolated
into the script prompt rather than its analysis text. **Suspected, not confirmed at runtime** — the
reel was not run to completion (§6).

### A10 🟡 The remedy offered for an unentitled wellbeing Studio is the wrong one

`compliance-check` unentitled → `{"remedies": ["buy_package"], "packKey": "document-validation"}` —
correct and actionable. `guided-journaling` unentitled → `{"remedies": ["upgrade_plan"], "packKey":
null}`. Both are VERTICAL packs bought the same way. Following the second remedy — upgrading the plan
— would not grant the Studio, and the response does not say which pack to buy.

### A11 🟡 The worker fixtures cannot exercise the rules they ship beside

`worker/fixtures/{clean,modified,scanned}.pdf` extract to three headings and nothing else:
`CONTRAT DE LOCATION - LOGEMENT VIDE` / `Article 2 - Duree et loyer` / `Signatures`. They are
structural stubs for the *authenticity* path and contain no clause any compliance rule can read. The
pack ships no document that exercises its own ruleset.

### A12 🟡 The FR crisis resource is sourced from a regional page for a national number

`3114` is correct, current and 24/7. Its `sourceUrl` is an ARS **Bourgogne-Franche-Comté** page. The
number is national; the provenance recorded for it is one region's health agency. The other three
resources are sourced canonically.

**Every crisis resource was re-verified against its source** (§5): `FR 3114` ✓, `BE-FR 0800 32 123`
(Centre de Prévention du Suicide, francophone) ✓, `BE-NL 1813` (Zelfmoordlijn, Dutch-speaking) ✓,
`CA 9-8-8` (call or text, FR/EN) ✓. All carry `verifiedOn: 2026-09-10`, thirteen days old. The
francophone/Dutch pairing that was nearly shipped inverted is correct.

---

## B. Defects with a CODE cause

### B1 🔴 Neither validation Studio can take an uploaded asset

| Studio | required input | form |
|:---|:---|:---|
| `compliance-check` | `document` | the document **text**, `maxLength` 60 000 |
| `document-authenticity` | `documentBase64` | the PDF **inlined as base64**, `maxLength` 1 400 000 |

`POST /api/v1/media/upload` returns an `assetId`, and **no input of either Studio can receive one** —
neither declares `format: asset-id`, and neither declares any `format` at all. The asset discipline
M1.8 built (assets referenced by id, resolved against their owner) is unreachable through the pack
that handles the most sensitive content in the product. The document travels inline, through the job
plane, as a run input.

*(`POST /api/v1/media/analyze/upload` returns 404 — it was one of the seven endpoints M3 deleted with
door 1. The surviving upload is `POST /api/v1/media/upload`.)*

### B2 🔴 Four of the six shipped packs cannot be used out of the box

On a fresh volume, `billing_pack_subscription` is **empty**. The installer writes what each pack
*grants* (`billing_pack_entitlement`), and the plan matrix grants only the media toolkit,
`trade-showcase` and the three prospection Studios. So a developer or first user on the **top plan**
gets `studio_not_entitled` for `document-validation`, `bien-etre`, `echo-toolkit` and
`realestate-studio`.

The path exists — `POST /api/v1/billing/pack-subscriptions/me/{packKey}` returns `201 ACTIVE` — but
nothing in the dev seed walks it, and a pack priced at 4 900 cents subscribes instantly with no
payment step (expected in the local phase; recorded, not a finding).

### B3 🔴 The validation pack's worker is not started by anything

`orazaka-packs/document-validation/worker/validation_worker.py` exists and its README documents
`cd worker && python3 validation_worker.py`. Neither `orazaka dev`, nor `orazaka start`, nor the e2e
harness references it. A user who installs the pack from the catalogue gets a run that **stays
`RUNNING` forever** with no error and no signal.

Worse, the message is **lost permanently**: the first run was dispatched before the worker's queue
existed, so the broker discarded it silently (the failure mode AGENTS.md §6 names). Starting the
worker afterwards did **not** recover that run — it is still `RUNNING`.

### B4 🔴 A declared step timeout is not enforced

`compliance-check`'s `screen` step declares `timeout: PT2M`. The stalled run above sat in `RUNNING`
for **over twenty minutes** on that step with no cancellation, no error and nothing shown to the user.
This is open finding `#34` observed on a real run, and its user-visible form is the worst one: a run
that never ends and never says why.

### B5 🟡 No job row exists for any step of a run

`orazaka_jobs` contained **0 rows** after three successful runs whose steps each carry a `job_id`.
Open finding `#37`, observed. The retention machinery that exists in the job plane
(`orazaka_job_purge`) therefore has nothing to act on for Studio work.

*This is narrower than it first looks and I checked before writing it down:* the user's content lives
in `studio_run.inputs`, and `RetentionSweeper` **does** purge that, with a separate shorter window for
any non-STANDARD class. Retention is implemented where the content actually is.

### B6 🟡 The typed failure cause is not exposed to the client

A scope-guard refusal writes `failure_cause = GUARD_REFUSAL` to both `studio_run` and
`studio_run_audit` — ADR-053 working exactly as designed. The run API response carries
`['blueprintVersion','errorMessage','finishedAt','id','installationId','outputs','startedAt',
'status','steps','studioKey']` and **no cause field at all**. A client cannot tell "we protected you"
from "we broke" without string-matching prose, which is the thing ADR-053 set out to end.

*Also observed:* a newly bought pack is unusable for a short window — six install attempts returned
`studio_not_entitled` before the entitlement snapshot refreshed and the same request succeeded. The
message during that window tells the user to upgrade their plan.

---

## C. The four SENSITIVE controls, observed on a real run

Run `8c07b67b-6ffc-4bb9-995d-6b92be6235aa`, `compliance-check`, three steps, **SUCCEEDED in 15.6 s**
click to result.

| Control | Observed | Evidence |
|:---|:---|:---|
| **Data class on the run** | ✅ | `studio_run.data_class = SENSITIVE`, derived from the pack |
| **Data class on its jobs** | ❌ **not observable** | `orazaka_jobs` has 0 rows (B5) |
| **Retention window applied** | ✅ *by configuration* | `retention.sensitive-run-days = 30` vs `retention.run-days = 90`; `RetentionSweeper` deletes `studio_run WHERE data_class <> 'STANDARD'` nightly, taking the **minimum** of the platform window and the installation's own. An actual deletion cannot be observed without waiting 30 days |
| **Audit row, no user content** | ✅ | `RUN_STARTED` and `RUN_SUCCEEDED`, both `class=SENSITIVE`. The table has **no free-text column** — `id, run_id, actor_id, pack_key, studio_key, data_class, event, step_id, failure_cause, recorded_at`. A search for a distinctive phrase from the document returned 0 rows |
| **Scope guard resolved** | ✅ | asked for legal advice → run `FAILED`, `errorMessage` **verbatim the pack's own refusal**, `failure_cause = GUARD_REFUSAL` on run and audit, 0 user words in the trail |

**One observation on the guard's placement.** It fires on the `judge` step, not at run start: `screen`
**SUCCEEDED first**. The deterministic rules ran, and were billed, on a request the platform then
refused. The user pays for the part that ran before the refusal.

---

## D. The wellbeing safety surface (§4) — verified live, no distress simulated

Every gate exercised through the install API, in order:

| Attempt | Result |
|:---|:---|
| no consent | **451** + the full statement and `consentVersion: "1.0"` |
| consent, **no region** | **400** — *"not available in region 'null'"* |
| region `US` (unsourced) | **400**, naming the four regions that are sourced |
| consent version `0.9` | **451** — a bumped version stops an existing install |
| `ageAttested: false` | **400** — *"not available to minors"* |
| valid, region `FR` | **201**, and the installation records `consent_version=1.0`, `region=FR`, both timestamps |

**The guard does not refuse the pack's own template** — the defect found once already. Confirmed two
ways: `StepDeclarationService.guardSubject()` declares the **run's inputs** as the subject, never the
resolved prompt; and a `guided-journaling` run on an ordinary entry **succeeded in 4.7 s**, where a
template-matching guard would have refused it (the template contains *"tu ne poses aucun
diagnostic"*).

`451 Unavailable For Legal Reasons` for the consent gate is the right status and worth keeping.

---

## E. Pending real content

- **The clause-by-clause verdict oracle on a genuine residential lease.** Twelve of the eighteen
  findings above did not need one, and A1/A2 are confirmed defects regardless of provenance — the
  document demonstrably contains *"durée de deux ans"* and names no party. What a real lease adds is
  **coverage**: ten rules against one synthetic document is not an evaluation of the ruleset, and the
  phrasings a real lease uses are exactly what A2 is about.
- **"Would an agency post this reel?"** Not run to completion. The blueprint's `approve` step parks
  the run awaiting input, and the subjective judgement needs real photographs of a real property.
  A7, A8 and A9 were established from the blueprint and hold whatever the photos are.

## F. What could not be evaluated, and why

- **`#43`'s five dead inputs, confirmed from the blueprint side rather than the output.** `assemble`
  passes `{"photos": …}` and nothing else to `orazaka.studio.media.compose`, which declares seven
  inputs. So `captions`, `brandKit`, `clip`, `bRoll` and `aspect` are not passed **by the blueprint
  either** — the gap is at both ends. What a user actually gets versus what the Studio promises is
  therefore established; what the reel *looks like* is not.
- **Credits charged against the artefact produced.** The compliance run took a hold
  (`hold_id = 1525f1f3…`) and `estimatedCredits` is 120 for compliance-check, 2 800 for the reel,
  30 for authenticity. The settled amount was not read back; the reel was not completed, so the
  credits-against-artefact comparison the brief asks for is pending with §E.
- **`document-authenticity` was not run.** Its input is 1.4 MB of base64 and its worker is the one
  nothing starts (B3); it was installed but not exercised.
- **An actual retention deletion**, which needs 30 days.
- **Payment.** Pack subscription is instant and free in the local phase.

## G. What this changes

Twelve content-caused findings against six code-caused ones. The content ones are cheaper to fix and
none of them is reachable by a rule, a plant or a test — they need someone to read a lease, read an
output, and know what it should have said. **A1 is the one to fix first**: a BLOCKING rule that every
document passes, reported as *"Le document nomme le bailleur"*, is the product telling a user their
contract is compliant when nothing checked it.
