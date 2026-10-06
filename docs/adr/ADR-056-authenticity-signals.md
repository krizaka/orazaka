---
title: "ADR-056 — Authenticity: signals with no inference step, no score, and no verdict"
description: "The authenticity Studio has no model call at all. Every signal is a fact read off the PDF bytes, on a three-level qualitative scale defined in writing, and the report states what it did not examine."
category: ADR
order: 56
---

# ADR-056 — Authenticity signals

- **Status**: Accepted
- **Date**: 2026-09-11
- **Scope**: `orazaka-packs/document-validation/**` (a pack), `CapabilityDeclaration`,
  `CapabilityEntity`
- **Bound by**: [ADR-052 §7](ADR-052-document-validation-pack.md), which set the rules before the
  code existed
- **Class**: `SENSITIVE` — it inherits the four controls of [ADR-051](ADR-051-sensitive-controls.md)
  from the pack it ships in

## 1. There is no inference step, and I was not tempted to add one

**The Studio has no model call.** Not a constrained one, not a reformulating one. One deterministic
step, and the sentences a reader sees were written by hand, once, per signal type.

You asked me to stop and argue if I concluded a judgement step was needed. I did not, and the
reason is worth stating because the temptation has a specific shape: the deterministic layer
produces facts like *"two `%%EOF` markers"*, and a model would turn those into fluent prose a
landlord could read. That is the whole of what it would add — and it is exactly where the failure
lives. A model asked to explain a signal will explain signals it did not receive, because fluent
prose about document forgery is a well-worn groove and the truthful version is dull. The output
would be indistinguishable from the honest one until the day it invented an inconsistency.

The alternative costs one sentence per signal type, written once. There are seven. Writing them by
hand is not a compromise forced by caution; it is cheaper than the prompt that would replace them.

**The asymmetry that decides it.** A false *"authentic"* on a forged lease is an exposure. A false
*"forged"* on an honest tenant is worse — it accuses a person — and confabulation produces the
second one most readily, because inventing a reason is what a model does when it has none.

## 2. No new worker, and the stated reason for that was wrong

The brief said the phase-H worker already reads PDFs, which would make this Tier C. **It does
not.** I built that worker to take text, and said so in
[ADR-052](ADR-052-document-validation-pack.md) when I did. Nothing in this repository read a PDF
before today.

The conclusion holds anyway, for a different reason: `document-validation` is already
`tier: WORKER` and ships its own worker process. The authenticity capability is drained by **that
process**, with one more routing key — `job.validation.signals`. No new worker, no new deployment,
no platform change. What the wrong premise did change is the work: a PDF library had to be added to
the pack's worker, which is a pack-local dependency and not a platform one.

## 3. The signals

Seven, all read off the file, all in `worker/authenticity.py` — a pure function of
`(bytes, expected_issuer)`, testable without a broker, like the compliance rules beside it.

| id | Reads | Level |
|:---|:---|:---|
| `PDF-META-001` | the declared `/Producer` and `/Creator` | `observé`, or `inhabituel` when absent |
| `PDF-META-002` | producer vs the issuer the reader says they expect | `incohérent` |
| `PDF-META-003` | `/ModDate` later than `/CreationDate` | `inhabituel` |
| `PDF-REV-001` | stacked writings — `%%EOF` count above one | `inhabituel`, `incohérent` above two |
| `PDF-TEXT-001` | an OCR text layer over an image (render mode 3, or an OCR producer) | `observé` |
| `PDF-FONT-001` | a font used on exactly one page of several | `inhabituel` |
| `PDF-OBJ-001` | objects defined and referenced by nothing | `inhabituel` |

`PDF-META-002` is the only one that needs the reader: without a stated expected issuer there is one
fact and no contradiction, so the producer is reported as `observé` and nothing more. **A
contradiction needs two facts, and the second one is the reader's.**

`PDF-TEXT-001` is `observé` on purpose and the tests pin it. A scanned, OCR'd document is the
ordinary case; treating it as a tampering signal would make every photocopied lease a finding, and
a tool that flags everything is a tool that gets ignored.

## 4. Three levels, defined in writing. No score

- **`observé`** — a fact present in quantities of perfectly ordinary documents. Reported so the
  reader knows it was looked at, not because it suggests anything.
- **`inhabituel`** — uncommon for this kind of document, with ordinary explanations. Worth one
  question, not a conclusion.
- **`incohérent`** — two facts in the file contradict each other. Still not proof: a contradiction
  has explanations too. It is the kind of point to resolve before relying on the document.

Each definition ships in `LEVELS` and a test fails if one is shorter than a sentence, because a
level with no definition is a number in disguise and the reader will supply their own meaning.

**No percentage.** *"87 % probability of forgery"* is a lie until it derives from a measured base
rate, and this has none. A number also gets quoted in a dispute as though it were evidence. A test
asserts no digit-percent appears in any report — and it had to learn the difference between a score
and `%%EOF`, which is a locatable structural fact and exactly what this report is made of.

## 5. Three prohibitions, in code

**No verdict.** A verdict word may appear only inside the disclaimer blocks whose job is to deny
it. Anywhere a signal is produced the words are simply absent, so the rule needs no judgement about
whether a sentence was a denial. Two tests enforce it — one over the produced signals, one over
every blueprint, manifest and worker source in the pack — and both were confirmed to go red by
planting *"Ce document est authentique."* in a signal and watching them fail.

The pack-wide grep, run as asked:

```
$ grep -rniE "authentique|falsifi|faux document|contrefa|fraude|frauduleux" orazaka-packs/document-validation
worker/authenticity.py:79:  "…Il ne dit pas si le document est authentique ni s'il ne l'est pas…"
```

One occurrence, inside the sentence that refuses the conclusion.

**No accusation of a person.** Signals are about the **document**. A test scans every produced
signal for words naming a party — `locataire`, `bailleur`, *"la personne qui"* — and fails on any.
`PDF-META-002` says a producer does not match an expected issuer; it does not say who changed it,
and the explanations it offers are ordinary ones — an intermediary reprinting to PDF, a mail client
converting an attachment.

**The report states what it did not examine**, in its own section, on every report including the
clean one. Six items: the truth of what the document says, signatures of any kind, the issuer's
existence, pixel-level image analysis, the paper original, and comparison against a reference copy
that was not supplied. A report that hides its limits is worse than no report, because it is read
as covering what it never touched.

## 6. Positioning, in the pack and here

**The value of this Studio is triage, not a verdict.** It tells a landlord *"these three points
deserve a question"* or *"nothing stands out"*. It is not an examination, and the report says so **in
full, once, at the top** — not in a footer. It then names what a real examination would involve: a
court-appointed expert working on the original rather than a file, a direct confirmation request to
the supposed issuer, laboratory image analysis if the document is a scan and the stakes justify it.

That last section is the point of the product. The honest thing this can be is the tool that helps
someone decide whether to pay for the real thing.

## 7. The gate

| Document | How it was built | Result |
|:---|:---|:---|
| `clean.pdf` | written once by reportlab, never reopened | one `observé` fact, *"Aucun point ne ressort"* |
| `modified.pdf` | `clean.pdf` reopened, given a `/ModDate` two days later and a different producer, then **appended** to the original bytes as an incremental update — what an editor does when it saves into an existing file | `PDF-META-002` incohérent, `PDF-META-003` and `PDF-REV-001` inhabituel, each with its location |
| `scanned.pdf` | a page-sized image with invisible text (render mode 3) over it and an OCR producer | `PDF-TEXT-001` **observé**, and absent from the native-text document |

`worker/fixtures/make_fixtures.py` rebuilds all three and prints their byte counts and `%%EOF`
counts. A fixture nobody can rebuild is a fixture nobody can check.

## 8. Found on the way: the same assumption, in a fourth place

[ADR-054 §8](ADR-054-asset-encryption-at-rest.md) recorded that a capability routed only by the
broker has no HTTP surface, and fixed the schema and `PackCapability`. Registering this pack's new
capability found the assumption written **twice more**: in `CapabilityDeclaration` — the jobs-side
Tier-1 twin of `PackCapability`, defaulting `httpMethod` to `POST` — and in `CapabilityEntity`,
whose JPA mapping still said `nullable = false`.

Four places, and each was found only when something tried to register a broker-routed capability
through it. The schema's CHECK constraint is what turned the last two from silent bad rows into
loud failures, which is the argument for having put the invariant in the database as well as in the
record.
