---
title: "ADR-089 — Rules from the law: identify the document, retrieve the dated articles, derive the checks, verify with evidence, promote to dated rulesets"
description: "The compliance engine stops judging every document with the lease ruleset. A document is identified (kind, jurisdiction, date, language) and compared with what the user declared; the articles that apply are read from a dated, hashed law corpus through grounded research; the engine proposes rules from them; a proposal becomes a dated, versioned ruleset only after its fixtures, golden cases and a first review. Discovery is dynamic, execution is fixed and dated: a user's document is only ever judged by a promoted ruleset."
category: ADR
order: 89
---

# ADR-089 — Rules from the law

- **Status**: Accepted (2026-10-24), being implemented in the order of « The cut ». Amended 2026-10-24 in the cut-5 pull
  request (orazaka-studio#80): the points settled in orazaka-packs#129 (§1) and the keys corrected on
  [krizaka/orazaka#401](https://github.com/krizaka/orazaka/issues/401) (§2, §4). Each amendment says where it was decided.
  Amended 2026-10-25 for cut 8 (orazaka-ai-engine#82): where the derivation and `vet` run, see « Amendments ».
- **Date**: 2026-10-23
- **Issue**: [krizaka/orazaka#401](https://github.com/krizaka/orazaka/issues/401)
- **Builds on**: [ADR-087](ADR-087-grounded-research.md) (grounded research: sources as data, citations, the
  deterministic verifier, the cache), [krizaka/orazaka#400](https://github.com/krizaka/orazaka/issues/400) (the law
  watcher), [krizaka/orazaka#371](https://github.com/krizaka/orazaka/issues/371) (engine v2: the step output contract,
  orazaka-studio#59, and the exact result cache, orazaka-studio#61), ADR-088
  ([krizaka/orazaka#389](https://github.com/krizaka/orazaka/issues/389), PR #390: run budgets, approval gates),
  [ADR-052](ADR-052-document-validation-pack.md) (deterministic first; `version` is the law, `revision` is us),
  [ADR-072](ADR-072-a-ruleset-is-a-test-suite.md) (a ruleset is a test suite: every rule tells its own fixture pair
  apart), [ADR-085](ADR-085-operator-audit-trail.md) (operator audit), ADR-064 (no user content in logs)
- **Scope**: `orazaka-packs/document-validation` (kinds, rulesets, worker, Studios, golden cases),
  `orazaka-job-service` (the law tables, beside the research tables), `orazaka-ai-engine` (`orazaka-tools`: the corpus
  source, importers, proposals, admin API), `orazaka-studio` (contracts, result cache list), `orazaka-web-client`
  (review queue), the workspace (`infra`, dev migration), and the products that call the check (Yomizaka first,
  Akinaza next)

## Context

### What went wrong (2026-10-23)

A private run put four **blank** Québec landlord-association templates through Yomizaka on dev: a 24-hour visit notice
and a « constat de l'état des lieux », each in French and in English. All four were judged by the **lease** ruleset
(`qc-residential-lease/2024-02-21`, revision 3) and all four came back with the same result: 4 FAIL, 5 PASS,
3 INSUFFICIENT_EVIDENCE ([orazaka-packs#124](https://github.com/krizaka/orazaka-packs/issues/124)–[#126](https://github.com/krizaka/orazaka-packs/issues/126),
[yomizaka#301](https://github.com/krizaka/yomizaka/issues/301)).

- **Wrong FAILs.** Rent rules (art. 1855, 1896, 1903) failed on forms that have no rent to state.
- **Hollow PASS.** Five rules (art. 1904, 1899, 1936, 1942–1945) passed on documents that never address them.
- **Nothing that applies.** The notice's own rules (art. 1931–1933) and the language rule were never checked; the
  English-only templates were not flagged.

[orazaka-packs#127](https://github.com/krizaka/orazaka-packs/pull/127) (merged) fixed the hollow PASS: every forbidden
or judgment rule declares a `subject`, a PASS quotes the passage that addresses it, and without one the verdict is
`NOT_APPLICABLE` or `INSUFFICIENT_EVIDENCE`. A filled fictional lease now behaves correctly
([yomizaka#305](https://github.com/krizaka/yomizaka/pull/305)): the clean lease raises no FAIL, the lease with known
errors raises exactly QC-LEASE-004, 005, 006 and 020, each with its passage and article. That is the baseline this ADR
must not lose.

What #127 did not fix is the root cause, in Oussama's words: « Notre défaut, c'est de détecter ce que c'est. »
`compliance-check` 1.7.2 takes a `jurisdiction` and an optional `ruleset`; without a name, the jurisdiction's
**default** ruleset (the lease) judges everything. The kind of the document is never read, the declared kind
(Bail / Contrat / Autre in Yomizaka) never reaches the engine, and every ruleset is written by hand.

### What exists (read on `main`, 2026-10-23)

| Piece | Where | What it gives us |
|:---|:---|:---|
| Rulesets | `orazaka-packs/document-validation/rulesets/<id>/<effectiveFrom>.json` | Dated (`version` = the law's date, `revision` = our corrections), resolved by `asOf` (`worker/rules.py` `resolve`), with `reviewStatus`. Six rulesets: QC lease, QC invoice, QC service contract, FR lease ×2, BE-WAL lease. |
| The verdict rules | `worker/rules.py`, `merge_judgments` | Four verdicts. A PASS needs a passage found in the text (#127). A judgment quote the document lacks is dropped. |
| Fixtures and golden cases | ADR-072, `test_rules.py`, `test_golden.py`, `worker/fixtures/<ruleset>/` | Every deterministic rule distinguishes its pass/fail pair; golden documents with expected findings. |
| Document profiles | `worker/document_profiles/*.json` (orazaka-packs#116) | Profiles as data, for the authenticity Studio (bank statement, pay stub, employment letter). No kind detection for compliance. |
| Grounded research | ADR-087; tables `research_source`, `research_document`, `research_fetch`, `research_consent` and the `research.*` settings in `orazaka-job-service` `infra/initdb/30-jobs-config.sql` (merged, #396); `CitationVerifierInterceptor` row seeded OFF; the citation shape is the output contract of `orazaka.core.research.grounded` (orazaka-studio#79) | Sources as rows, the cache by source + URL + hash, the deterministic verifier, the audit. The seeded `legisquebec` source is disabled. |
| Output contract | orazaka-studio#59 | A step declares a JSON Schema subset; an output outside it fails the step (`EXECUTOR_FAULT`). |
| Exact result cache | orazaka-studio#61, `studio_run.input_fingerprint`, setting `run.result-cache.studios` | An identical run (actor, Studio version, inputs, configuration) answers from the recorded result. Off by default. |
| Settings with bounds | `studio_runtime_config` (`default_value`, `min_value`, `max_value`, audited, admin API of orazaka-studio#72/#74) | The pattern for every new setting. `orazaka_runtime_config` (job-service) has no bounds columns yet. |
| Run budgets and gates | ADR-088 (proposed, PR #390) | `run.budget.default-credit-cap`, approval gates, `AWAITING_APPROVAL`. |

### What we can read, and how (measured from this Mac, 2026-10-23, user agent `OrazakaResearch/0.1 (+https://www.orazaka.com)`)

| Source | Answer | What it means |
|:---|:---|:---|
| [Légis Québec](https://www.legisquebec.gouv.qc.ca/fr/document/lc/CCQ-1991), `…/fr/version/lc/CCQ-1991?code=se:1931`, `…/fr/document/lc/C-11` and even `/robots.txt` | **403** | Refused to an honest agent, as ADR-087 measured. We do not disguise the engine ([#393](https://github.com/krizaka/orazaka/issues/393)): no automated read of Légis Québec. |
| [CanLII](https://www.canlii.org/fr/qc/legis/lois/rlrq-c-ccq-1991/derniere/rlrq-c-ccq-1991.html) | **403** | Same. Its API gives metadata, not full text ([API documentation](https://github.com/canlii/API_documentation/blob/master/EN.md)). |
| **Données Québec, [« Lois et règlements codifiés du Québec »](https://www.donneesquebec.ca/recherche/dataset/c8433300-f752-4815-8ea2-69cad416dd80)** (dataset `c8433300-f752-4815-8ea2-69cad416dd80`, publisher listed: Ministère de l'Emploi et de la Solidarité sociale; [CKAN API](https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=c8433300-f752-4815-8ea2-69cad416dd80)) | **200** | The official consolidated statutes and regulations **in XML**, French and English, updated « lorsque la version la plus récente … est disponible ». Snapshot of 2026-10-21: `20261021_lois.zip` (44,614,906 bytes, SHA-256 `550c1b60…74fe`, 2,033 files) and `20261021_reglements.zip`. **Licence: CC BY-NC-ND 4.0** (« pas d'utilisation commerciale, pas d'œuvre dérivée », [licence page](https://www.donneesquebec.ca/licence/#cc-by-nc-nd)). |
| [Justice Laws XML index](https://laws-lois.justice.gc.ca/eng/XML/Legis.xml), [`/eng/XML/E-15.xml`](https://laws-lois.justice.gc.ca/eng/XML/E-15.xml), [SOR/91-45](https://laws-lois.justice.gc.ca/eng/regulations/SOR-91-45/) | **200** | Federal acts and regulations, readable. |
| [`justicecanada/laws-lois-xml`](https://github.com/justicecanada/laws-lois-xml) | **200** | The consolidated federal XML on GitHub, under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada) (its `LICENSE.md`), last push 2026-10-15. |

**This answers the first check of #400.** An official open-data export of Québec law exists and an honest agent may
download it. Each section is dated in the XML itself: `CCQ-1991_FR.xml` carries the consolidation date
(`<LegislativeDocument date-eev="20260611">`) and every article its own in-force date
(`<Section Code="se:1931" date-eev="19990401">`), its text in `Subsection/Text`, and its amendment history in
`HistoricalNote`. Federal XML carries `lims:inforce-start-date`, `lims:lastAmendedDate` and `hasPreviousVersion`
per element. Two cautions, both measured:

- the dataset's companion list (`liste_lois_regs_fr_2026-10-21.csv`) labels live texts « abrogée » or « revoquée »
  (T-0.1, T-15.01, T-0.1, r. 2) while their XML says `in-force="true"`: status is read from the XML, never from the list;
- the licence forbids commercial use. Our good-faith reading, under Oussama's rule on #393 (legal points do not block
  the build; a list for the final lawyer review): we may build, test and review on it; quoting a short passage of an
  article with its official URL in a report is citation of the law, not redistribution of the dataset; we never
  republish the dataset or full texts. Paid production use of the corpus is added to **#393 as TO VALIDATE**, with a
  written request to the publisher for commercial use.

Articles read from that XML on 2026-10-23, which this ADR relies on (the official URL is Légis Québec's, which an
honest agent cannot open; the text was read from the dataset):

| Article | Official URL | What it says (short) | Why it matters here |
|:---|:---|:---|:---|
| C.c.Q. art. 1897 | [se:1897](https://www.legisquebec.gouv.qc.ca/fr/version/lc/CCQ-1991?code=se:1897) | « Le bail, ainsi que le règlement de l'immeuble, doivent être rédigés en français. Ils peuvent cependant être rédigés dans une autre langue si telle est la volonté expresse des parties. » | The language rule (#126): an English lease is **not** a FAIL by itself. |
| Charte de la langue française, art. 55 | [C-11 se:55](https://www.legisquebec.gouv.qc.ca/fr/version/lc/C-11?code=se:55) | Contracts of adhesion and their documents are in French; another language binds only « après que sa version française a été remise à l'adhérent » and by express will. | The other half of the language rule. |
| C.c.Q. art. 1931–1933 | [se:1931](https://www.legisquebec.gouv.qc.ca/fr/version/lc/CCQ-1991?code=se:1931), [1932](https://www.legisquebec.gouv.qc.ca/fr/version/lc/CCQ-1991?code=se:1932), [1933](https://www.legisquebec.gouv.qc.ca/fr/version/lc/CCQ-1991?code=se:1933) | A 24-hour notice to check, work or show; visits refused before 9 h and after 21 h; works refused before 7 h and after 19 h, unless urgent. | The visit notice (#125). |
| C.c.Q. art. 1910–1913 | [se:1910](https://www.legisquebec.gouv.qc.ca/fr/version/lc/CCQ-1991?code=se:1910) … [1913](https://www.legisquebec.gouv.qc.ca/fr/version/lc/CCQ-1991?code=se:1913) | Habitability and cleanliness at delivery; « La stipulation par laquelle le locataire reconnaît que le logement est en bon état d'habitabilité est sans effet. » | The état des lieux (#125): no statute prescribes the form; the rules are about what a clause cannot do. |
| C.c.Q. art. 1942 | [se:1942](https://www.legisquebec.gouv.qc.ca/fr/version/lc/CCQ-1991?code=se:1942) | The notice of modification: 3 to 6 months before term (1 to 2 months under 12 months; 10 and 20 days for a room). | The pack's README says this text « could not be checked at the source ». Now it can. |
| C.c.Q. art. 1904 | [se:1904](https://www.legisquebec.gouv.qc.ca/fr/version/lc/CCQ-1991?code=se:1904) | No sum other than rent, as a deposit or otherwise; no post-dated cheque. | Unchanged; the corpus's hash now pins what QC-LEASE-004 cites. |
| Loi sur la taxe de vente du Québec, art. 16 and 201 | [T-0.1](https://www.legisquebec.gouv.qc.ca/fr/document/lc/T-0.1) | QST at 9,975 %; an input tax refund needs « une preuve suffisante … y compris tout renseignement prescrit ». | Akinaza's reuse of the same corpus. |

Federal texts relied on: the [Excise Tax Act](https://laws-lois.justice.gc.ca/eng/acts/E-15/) and the
[Input Tax Credit Information (GST/HST) Regulations, SOR/91-45](https://laws-lois.justice.gc.ca/eng/regulations/SOR-91-45/)
(already cited by `qc-invoice`). Loi 25 is consolidated into the
[Loi sur la protection des renseignements personnels dans le secteur privé (P-39.1)](https://www.legisquebec.gouv.qc.ca/fr/document/lc/P-39.1),
present in the dataset; ADR-087 §4 already applies it to research.

## Decision

### 0. The hybrid boundary: discovery is dynamic, execution is fixed and dated

One line, enforced by where the code sits:

> **A user's document is only ever judged by a promoted ruleset.** Models may find the law and propose rules; they never
> decide a verdict with a rule nobody promoted.

| | Dynamic (discovery) | Fixed and dated (execution) |
|:---|:---|:---|
| When | Per kind and per change of the law, started by an admin or by the watcher | Per document, on every run |
| What | Retrieve the articles (stage 2), derive proposed rules (stage 3) | Identify (stage 1) selects a ruleset; the check (stage 4) runs it |
| Models | Grounded research, rule proposals | Only what the promoted ruleset already declares (`JUDGMENT` rules, ADVISORY), as today |
| Output | `rule_proposal` rows, a pull request to orazaka-packs | Findings with article and passage, a ruleset `version` + `revision` |
| Gate between them | Stage 5: fixtures (ADR-072), golden cases, a first review, a merged PR | |

Identification is the only runtime step that may use a model, and its output is **one value from a closed list** of
the kinds the pack has promoted (plus `OTHER`), with a quote the worker checks. It selects; it never creates a rule.
Two runs of the same document with the same `asOf` therefore read the same ruleset; the deterministic findings are the
same by construction, and identical runs answer from the exact result cache (§4).

### 1. Identify: kind, jurisdiction, date, language

**Kinds are pack data.** `document-validation/kinds/<kindId>.json`, validated by `kinds/kind.schema.json`, beside the
document profiles of #116:

```json
{
  "kindId": "qc-visit-notice",
  "jurisdiction": "QC",
  "label": { "fr": "Avis de visite (24 heures)", "en": "Visit notice (24 hours)" },
  "family": "residential-lease",
  "declaredAs": ["NOTICE", "OTHER"],
  "signals": [
    { "id": "title", "weight": 2, "pattern": "(?i)avis\\s+(?:de\\s+)?(?:visite|d['’]acc[eè]s)|notice\\s+of\\s+(?:visit|entry)" },
    { "id": "24h",   "weight": 1, "pattern": "(?i)24\\s*h(?:eures)?|twenty-four\\s+hours" }
  ],
  "excludes": ["(?i)loyer\\s+mensuel[^.\\n]{0,40}\\d"],
  "dateSignals": [{ "id": "notice-date", "pattern": "(?i)(?:date\\s+de\\s+l['’]avis|fait\\s+le)\\s*:?\\s*(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+\\w+\\s+\\d{4})" }],
  "asOfFrom": "notice-date",
  "ruleset": "qc-visit-notice",
  "status": "PROMOTED"
}
```

`status` is `PROMOTED` (a ruleset exists), `KNOWN` (recognised, no ruleset: the run says so) or `RETIRED`. The first
kinds: `qc-residential-lease`, `qc-visit-notice`, `qc-condition-report` (état des lieux), `qc-lease-modification-notice`,
`qc-invoice`, `qc-service-contract`; FR and BE-WAL leases keep their rulesets as kinds. The jurisdiction is a kind
signal too (« Tribunal administratif du logement », « C.c.Q. », a Québec postal code `[A-Z]\d[A-Z] ?\d[A-Z]\d`).

**A new worker capability**, `orazaka.validation.document.identify` (routing key `job.validation.identify`, the
validation worker, no model): it scores each kind of the jurisdiction (or of every jurisdiction when none is declared)
by its signals, keeps the passage each signal matched, and returns:

```json
{
  "declaredKind": "LEASE", "detectedKind": "qc-visit-notice", "kindUsed": "qc-visit-notice",
  "kindEvidence": [{ "signal": "title", "quote": "AVIS DE VISITE DU LOGEMENT", "verified": true }],
  "kindSource": "DETECTED", "kindMismatch": true,
  "jurisdiction": "QC", "jurisdictionSource": "DECLARED",
  "documentDate": "2026-10-20", "asOf": "2026-10-20", "asOfSource": "DOCUMENT",
  "languages": ["en"], "outcome": "CHECK"
}
```

- **Which kind is used.** The detected kind wins when its signals reach `law.identify.min-signal-weight` and only one
  kind does. Otherwise the declared kind is used, if it maps to exactly one kind. Otherwise, and only if
  `law.identify.model-fallback` is on, a `classify` step asks the model to choose one kind id from the closed list with
  a quote (`orazaka.core.chat.completion`, contract: `{kindId: enum, quote: string}`), and the worker keeps the answer
  only if the quote is in the document (the normalisation of ADR-087 §3). Otherwise the outcome is `KIND_UNKNOWN`.
- **A mismatch is always surfaced**, never silently resolved: `kindMismatch: true`, both kinds, the evidence, and which
  one judged. The product shows it (yomizaka#301).
- **An unsupported kind says so.** A `KNOWN` kind gives `outcome: UNSUPPORTED_KIND` with its label; no ruleset runs,
  and never the lease's. Section 6 says what such a document may still get.
- **The date.** `asOf` given by the caller wins (`asOfSource: INPUT`); else the kind's date signal, kept only with its
  passage (`DOCUMENT`); else today (`TODAY`), said in the report.
- **The language** of the document (`fr`, `en`, both) is a fact for the language rules, never a verdict by itself.
- An explicit `ruleset` input still overrides everything (back-compatible with 1.x callers) and is reported as
  `kindSource: RULESET_INPUT`.

**Settled in packs#129** (CTO, 2026-10-24; implemented in orazaka-packs#131):

1. **Ties.** The candidate with the highest weight wins when it is alone at the top. A tie at the top is ambiguous: the
   declared kind breaks it only when it names exactly one of the **tied** kinds; otherwise `KIND_UNKNOWN` (or the
   `classify` step, §4). A real lease that mentions a visit stays a lease.
2. **Declared-kind vocabulary**: `LEASE`, `NOTICE`, `CONDITION_REPORT`, `INVOICE`, `SERVICE_CONTRACT`, `OTHER`, matched
   through each kind's `declaredAs`; `OTHER` agrees only with the kinds that list it. Yomizaka maps « Bail » → `LEASE`,
   « Contrat » → `SERVICE_CONTRACT`, « Autre » → `OTHER` on its side.
3. **`excludes`**: a match disqualifies the kind.
4. **Jurisdiction hints** add to a kind's weight and name the jurisdiction, but never make a kind a candidate on their
   own: its signals must reach `law.identify.min-signal-weight`.
5. **Status**: `qc-visit-notice` and `qc-condition-report` are `KNOWN` (`UNSUPPORTED_KIND`) until their rulesets land
   (packs#125), then `PROMOTED`. The example above shows the promoted state.
6. **Date and language**: date signals with one passage each (ISO, « 20 octobre 2026 », « October 20, 2026 »; an
   impossible date is no date); language by French/English function-word counts. A date taken from `TODAY` stays
   labelled as such in the report.

**Owner**: orazaka-packs (kinds, worker). **Tests**: `test_identify.py` — each kind's fictional filled example is
detected; the four blank templates' fictional equivalents (a visit notice and an état des lieux, FR and EN) are
detected as their kind, never as a lease; a declared « Bail » on a visit notice gives `kindMismatch: true` and judges
as a notice; a document matching two kinds equally is `KIND_UNKNOWN`, not a guess; a classify answer whose quote is
not in the document is discarded; a `KNOWN` kind gives `UNSUPPORTED_KIND` and no findings; every kind's signals have
their own pass/fail fixtures (ADR-072 applied to kinds).

### 2. Retrieve the law: the dated, hashed corpus, read through grounded research

**The corpus is the watcher's** (#400): every targeted article, per language, per version, with its in-force date and
its hash. ADR-089 fixes its shape so that stages 2 to 5 can rely on it.

Tables, in `orazaka-job-service` `infra/initdb/30-jobs-config.sql` beside the research tables, with a dev-deploy
migration (`2026-10-xx-law-corpus.sql`):

| Table | Columns (main) | Notes |
|:---|:---|:---|
| `law_instrument` | `id` UUID PK, `jurisdiction` (`CA`, `QC`, `FR`, `BE-WAL`), `code` (`CCQ-1991`, `C-11`, `T-0.1`, `T-15.01-r3`, `E-15`, `SOR-91-45`), `title_fr`, `title_en`, `official_url_template` (e.g. `https://www.legisquebec.gouv.qc.ca/fr/version/lc/CCQ-1991?code=se:{ref}`), `source_key` → `research_source.source_key`, `licence`, `access_note` | One row per act or regulation. UNIQUE (`jurisdiction`, `code`). |
| `law_article_version` | `instrument_id` FK, `ref` (`1931`, `169(4)`), `language` (`fr`, `en`), `in_force_from` DATE, `in_force_to` DATE NULL, `heading_path` TEXT, `text` TEXT, `content_hash` CHAR(64), `history_note` TEXT, `import_id` FK, `first_seen_at`, `last_seen_at` | PK (`instrument_id`, `ref`, `language`, `in_force_from`), with an index on (`instrument_id`, `ref`, `language`, `content_hash`) for lookups; `content_hash` NOT NULL. *Amended 2026-10-24 (krizaka/orazaka#401, orazaka-job-service#69): with the hash in the key, an amendment that is reverted (the text returns to an earlier version) collided with the earlier row; a revert is a new dated row (text A, B, A gives three rows, one open).* The hash is SHA-256 of the article's text (label and subsections; the historical note is stored, not hashed), normalised NFC with whitespace collapsed. A changed text is a new row; the previous row gets `in_force_to`. |
| `law_import` | `id`, `source_key`, `mode` (`AUTOMATED`, `MANUAL`), `dataset_url`, `dataset_etag`, `dataset_sha256`, `consolidated_to` DATE, `imported_by`, `started_at`, `finished_at`, `articles_new`, `articles_changed`, `articles_unchanged`, `status` | Every import is traceable, a manual one included (who, which file, its hash). |
| `law_retrieval` | `jurisdiction`, `kind_id`, `language`, `as_of_bucket` (the `in_force_from` of the newest article it used), `articles` JSONB (`[{instrument, ref, language, contentHash}]`), `claims` JSONB (ADR-087 shape), `run_id`, `created_at`, `stale` BOOLEAN | PK (`jurisdiction`, `kind_id`, `language`, `as_of_bucket`). The cache of stage 2 (§7). *Amended 2026-10-24 (krizaka/orazaka#401, orazaka-job-service#70): the key gains the language, because the claims are written in one language and a French retrieval is never served to an English request.* |

**How the corpus is filled** (owner: `orazaka-ai-engine`, `orazaka-tools`, package `law`; scheduled by the watcher):

- `JusticeLawsXmlImporter` reads `justicecanada/laws-lois-xml` (OGL-Canada) at a pinned commit, or
  `laws-lois.justice.gc.ca/eng/XML/<code>.xml`; dates from `lims:inforce-start-date`.
- `QuebecOpenDataImporter` downloads the Données Québec zips (honest user agent, conditional on ETag), checks their
  SHA-256 into `law_import`, and reads only the **targeted instruments** listed in
  `law.import.instruments` (CCQ-1991, C-11, T-15.01 and its r. 1.1 and r. 3, T-0.1 and r. 2, P-39.1). Dates from each
  section's `date-eev`.
- **Manual import** (`POST /api/v1/admin/law/imports`): the same XML uploaded by an admin, with the URL it came from;
  the same parser, `mode = MANUAL`. This is the traceable fallback #400 asks for.
- Two research sources are seeded **disabled**: `law-corpus` (`kind = OFFICIAL`, provider `law-corpus`, no network:
  it reads `law_article_version`) and `donnees-quebec` (provider `donnees-quebec`, allow pattern
  `www.donneesquebec.ca/recherche/dataset/c8433300-f752-4815-8ea2-69cad416dd80/**`). `legisquebec` stays disabled;
  its URL is still the one every citation shows.

**Point in time.** `asOf` selects, per article, the version with `in_force_from ≤ asOf < in_force_to`. A Québec
article whose oldest known version is in force after `asOf` (the dataset holds only the current consolidation; older
texts exist only from our own earlier imports) is `LAW_VERSION_UNKNOWN`: the retrieval says so and the stage-4 rule
built on it gives `INSUFFICIENT_EVIDENCE`, never a verdict read from a later text.

**Retrieval is grounded research, not a new mechanism.** A blueprint step calls `orazaka.core.research.grounded` with
`sources: ["law-corpus"]`, `jurisdiction`, `asOf` (a new input, **required**: no default is read from a clock — the
UTC-day bug of yomizaka#309; a caller that wants one passes the calendar day in the jurisdiction's zone, `America/Toronto`
for QC; amended 2026-10-24, krizaka/orazaka#401, orazaka-ai-engine#87) and a question built from the kind (« Quels
articles régissent un avis de visite d'un logement au Québec ? »). The `lookupStatute` tool of ADR-087 gains `asOf` and
reads the corpus: `lookupStatute {jurisdiction, instrument, reference, asOf, language}` →
`{text, contentHash, inForceFrom, officialUrl, importId}`. A corpus document is a `research_document` like any other
(its URL is the official URL, its hash the article's), so the ADR-087 verifier checks every claim (« art. 1931 requires
a 24-hour notice ») against the article text. Unverified claims stay `TO_VALIDATE` and are not used by stage 3.

**Tests**: importer tests on recorded XML (a slice of `CCQ-1991_FR.xml` and of `E-15.xml` committed as fixtures):
a changed article makes one new version and closes the old one, an unchanged one only moves `last_seen_at`; the hash
ignores whitespace and the historical note; `asOf` before the oldest version gives `LAW_VERSION_UNKNOWN`; the CSV list's
« abrogée » never sets a status; a manual import of the same file gives the same rows. Retrieval golden case: the visit
notice yields verified claims on 1931–1933 and nothing on rent articles.

### 3. Derive the checks: the engine proposes

A Studio of the pack, `document-validation/studios/rule-derivation`, run by an admin (§8) or by the watcher on a change:

| Step | Kind | What it does |
|:---|:---|:---|
| `retrieve` | `orazaka.core.research.grounded` (law-corpus) | Stage 2, or its cache. |
| `propose` | `orazaka.core.chat.completion`, output contract `proposed-ruleset.schema.json` | From the **verified** claims only: rules in the ruleset schema (`ruleId`, `title`, `severity`, `method`, `subject`, `check` or `question`, `citation`, `sourceUrl`), each with `law: {instrument, ref, language, contentHash, quote}` and a fixture pair written from the article's requirement. |
| `vet` | worker `orazaka.validation.rules.vet` (no model) | Rejects automatically: a regex that does not compile or that matches the empty string; a `quote` not found in the article text; a number, duration or time in the rule (24 heures, 9 h, 21 h, trois mois) absent from its quote (the support check of ADR-087); a rule whose fixture pair it cannot tell apart (ADR-072); a FORBIDDEN or JUDGMENT rule without `subject` (#127); a rule citing an article that is `LAW_VERSION_UNKNOWN`. |
| `record` | worker `orazaka.validation.rules.record` → engine | Writes the surviving rules as `rule_proposal` rows (`PROPOSED`) and the rejected ones as `REJECTED_AUTO` with the reason. |

`rule_proposal` (job-service, beside the corpus): `id`, `jurisdiction`, `kind_id`, `rule_id`, `proposal_revision`,
`rule` JSONB, `law` JSONB, `derivation_run_id`, `status` (`PROPOSED`, `REJECTED_AUTO`, `APPROVED`, `REJECTED`,
`PROMOTED`, `SUPERSEDED`), `vet_report` JSONB, `reviewed_by`, `reviewed_at`, `decision_note`, `packs_pr_url`,
`created_at`. A JUDGMENT proposal is always ADVISORY. A proposal never leaves this table except through stage 5.

The language rule is the worked example of why a proposal must quote its article: art. 1897 allows another language
« si telle est la volonté expresse des parties », and C-11 art. 55 binds by the other version only after the French
version was given. So the honest rule for an English-only lease is ADVISORY, `INSUFFICIENT_EVIDENCE` unless the
document states the parties' express will and the remittance of the French version — never « English lease: FAIL ».
The vet step's support check catches a proposal that drops that condition only partly (it has no number to check), which
is why the review of stage 5 exists.

**Owner**: orazaka-packs (Studio, vet, record), orazaka-ai-engine (`RuleProposalService`, the table's writes).
**Tests**: `test_vet.py` — each rejection reason has a planted proposal that triggers it and a sound one that passes;
the derivation golden case on the visit notice proposes rules citing 1931–1933 whose fixtures discriminate, and none
citing rent articles; a recorded model answer citing an article the corpus does not hold is `REJECTED_AUTO`.

### 4. Check with evidence: the fixed run

`compliance-check` **2.0.0**: `identify` → `classify` (with `condition`, only when the identify step asks) → `resolve`
→ `screen` → `judge` → `report`. Inputs: `document`, `jurisdiction` (now optional), `declaredKind`
(`LEASE | NOTICE | CONDITION_REPORT | INVOICE | SERVICE_CONTRACT | OTHER`, settled in packs#129, point 2), `asOf`,
`ruleset` (override), `lecture` (§6).

- **Every finding cites the article and the passage.** The promoted ruleset carries, per rule, the `law` block
  (instrument, ref, language, `inForceFrom`, `contentHash`, official URL, and the article's quote, ≤ 300 characters).
  A finding is `{ruleId, verdict, severity, evidenceSpan, explanation, method, citation: {instrument, ref, officialUrl,
  inForceFrom, contentHash, quote}}`.
- **The deterministic verifier checks both quotes** in the `report` step: the evidence passage is in the document (as
  #127 does today), and the citation's quote is in the article text that the ruleset pins (its `contentHash`). A
  finding whose citation fails becomes `INSUFFICIENT_EVIDENCE`.
- **No passage, no PASS**: `NOT_APPLICABLE` when the subject is absent, `INSUFFICIENT_EVIDENCE` otherwise (#127, kept).
- **The report's contract** (orazaka-studio#59) gains `identification` (the object of §1), `outcome`
  (`CHECKED | UNSUPPORTED_KIND | KIND_UNKNOWN | LECTURE`), and `ruleset: {id, version, revision, reviewStatus}`; a
  report outside it fails the step.
- **Two runs agree.** The ruleset is resolved from `(kindUsed, asOf)`, never from today's newest. `compliance-check`
  joins `run.result-cache.studios`, so an identical run (same document, inputs, Studio version and installation) answers
  from the recorded result, judgment rules included. A new ruleset revision is a new pack version, which changes the
  fingerprint.

**Owner**: orazaka-packs (blueprint, worker), orazaka-studio (contract enforcement, the cache list row).
**Tests**: the yomizaka#305 recordings stay green (clean lease: no FAIL; errors lease: exactly 004, 005, 006, 020);
the four blank templates' equivalents give no PASS at all; a ruleset whose pinned quote is not in its article fails
`test_rules.py`; a citation quote altered by one word gives `INSUFFICIENT_EVIDENCE`; two identical runs give the same
report (the second is `cached_from` the first); a 1.x call with `jurisdiction: QC` and no kind gives the lease, as
before.

*Decided by the CTO on orazaka-studio#80 (2026-10-24), cut 5:*
- *A rule with no `law` block keeps its verdict for now, and the finding says so (« citation non épinglée »,
  `citation.pinned: false`), never silently. Pinning the shipped rules is packs#125/#126.*
- *The pinned article texts the pack holds (`law/`) are a snapshot for offline verification, not a second corpus.
  Each file's hash is checked against its text, and when `lookupStatute` is reachable, against the corpus row (behind
  the corpus switch, off by default).*
- *`classify` chooses among the tied kinds plus `OTHER`.*
- *2.0 has no default kind: judging an unrecognised text by the jurisdiction's lease (`kindSource: DEFAULT`) is legacy
  behaviour, kept only for an explicit 1.x version (an installation pinned on a 1.x blueprint).*
- *A run whose day came from the clock (`asOfSource: TODAY`) is never cached; a 2.0 run is cached only when `asOf` is
  explicit or read from the document (`resultCacheable`, orazaka-studio#81). Yomizaka always sends `asOf` (`localDay`).*

### 5. Promote: a proposal becomes a dated, versioned ruleset

A rule reaches execution only through all of these, in order:

1. **Vetted** (stage 3, automatic).
2. **Golden cases** for the kind: at least `law.review.min-golden-cases` fictional filled documents, at least one clean
   and one with known errors, plus the kind's blank form (expected: no PASS). At least one golden case per kind comes
   from outside the derivation (a product's demo generator, as yomizaka#305's), so the rules are never only tested by
   examples the same model wrote (ADR-072: fixtures from the requirement, never from the pattern).
3. **A first review** in the console (§8): the reviewer reads the article quote beside the rule, its fixtures and the
   golden results, and approves or rejects each rule. `reviewStatus` becomes `REVIEWED_INTERNAL`; the
   `TO_REVIEW_BY_LAWYER` mark stays shown until a lawyer signs it off.
4. **A pull request to orazaka-packs**, opened by the engine with the GitHub App (`krizaka-agents`, contents and pull
   requests on `orazaka-packs` only): `rulesets/<kindId>/<effectiveFrom>.json` with `version` = the law's in-force date,
   `revision` and `revisionNote`, the `law` blocks, `provenance` (`derivationRunId`, `proposalIds`, `reviewedBy`,
   `reviewedAt`, `lawImportIds`), the golden fixtures and `kinds/<kindId>.json` set to `PROMOTED`. The pack's CI runs
   `test_rules.py`, `test_golden.py`, `test_identify.py`. The merge is the promotion; the pack's release makes it
   executable.

A law change found by the watcher marks the rulesets that pin the changed hash: the watcher's PR (#400) carries the
diff, the stage-3 re-derivation of that kind and a **new dated version** (`effectiveFrom` = the new text's in-force
date); the old version stays for documents dated before it. Our own correction is a new `revision` of the same version.
Rulesets written by hand (packs#125, #126 now) take the same path from step 2: they cite the corpus and pin its hashes.

**Tests**: packs CI refuses a ruleset without `law` blocks, with a hash the corpus fixtures do not hold, or with fewer
golden cases than the minimum; an engine test opens the PR on a recorded GitHub API and never pushes to `main`; a
proposal edited after approval returns to `PROPOSED`.

### 6. A document of a kind with no promoted ruleset

**Decision: a « lecture », off by default, never a verdict.** The run always returns `outcome: UNSUPPORTED_KIND` (or
`KIND_UNKNOWN`) and says it plainly. When the caller passes `lecture: true` and `law.lecture.enabled` is on, the run
adds a `lecture`: one grounded call over `law-corpus` with the document as data, returning ADR-087 claims that pair an
article with a passage of the document. Each claim is `VERIFIED` only if both quotes are found (the article in the
corpus, the passage in the document); there is **no verdict field**, no score, and the object carries
`audit: "UNAUDITED"`, which the product must show. Every unsupported or unknown kind increments `kind_demand`
(`jurisdiction`, `kind_id` or `UNKNOWN`, `count`, `first_seen`, `last_seen`; never document content, ADR-064), which
the review queue shows to decide what to derive next. Derivation is never started by demand alone: an admin starts it.

Rejected: « nothing » (the user learns nothing, and we learn nothing); « run the closest ruleset » (the defect of
2026-10-23).

### 7. Cost per document

| Stage | Paid when | Per document |
|:---|:---|:---|
| 1. Identify | every run | Deterministic: no model call. The `classify` fallback, only when signals are ambiguous: one short chat call (≤ `law.identify.classify-max-tokens` output). |
| 2. Retrieve | once per (jurisdiction, kind, `as_of_bucket`), again only when a cited article changes or after `law.retrieval.max-age-days` | 0: corpus reads are cache hits (`RESEARCH` cost 0, ADR-087 §5). |
| 3. Derive | per kind and per law change, started by an admin or the watcher, capped by `law.derive.max-credits` through the run budget of ADR-088 | 0 |
| 4. Check | every run | As today (`compliance-check` 1.7.2 estimates 120 credits: the worker plus one judge call). An identical run is a result-cache hit. |
| 6. Lecture | only on `lecture: true` for an unsupported kind | One grounded call, held at `law.lecture.max-credits`. |

The figures above are bounds, not measurements; slice 4 measures identify and the check on the golden cases and writes
them in its PR before any default changes. The watcher's imports are platform cost, billed to no product.

### 8. The admin review queue

In the console (admin.orazaka.com, `orazaka-web-client` `src/app/console`), screen **Law → Proposals**: by kind, the
proposals with their article quote and official URL side by side, the rule, its fixtures, the vet report, the golden
results, and actions **Approve**, **Reject (reason)**, **Edit** (a new `proposal_revision`, vetted again) and
**Promote** (opens the packs PR, shows its link). Two more tabs: **Corpus** (instruments, imports with their hashes and
counts, a manual import) and **Demand** (`kind_demand`). Only `@krizaka/ui`, FR/EN, dark and light.

Admin API (router, `ADMIN` only, every write in `operator_audit`, ADR-085; the edge already routes `/api/v1/admin/**`):

| Method and path | Purpose |
|:---|:---|
| `GET /api/v1/admin/law/instruments` · `GET /api/v1/admin/law/articles?instrument=&ref=&asOf=&language=` | The corpus, by point in time. |
| `GET /api/v1/admin/law/imports` · `POST /api/v1/admin/law/imports` (multipart: XML, `datasetUrl`) | Imports; the manual import. |
| `POST /api/v1/admin/law/derivations` `{jurisdiction, kindId, asOf}` → `{runId}` | Starts `rule-derivation` (a Studio run, so ADR-088 budgets, events and resume apply). |
| `GET /api/v1/admin/law/proposals?status=&kindId=` · `GET …/{id}` · `PUT …/{id}` · `POST …/{id}/approve {note}` · `POST …/{id}/reject {reason}` | The queue. |
| `POST /api/v1/admin/law/kinds/{kindId}/promote` `{proposalIds, effectiveFrom}` → `{prUrl}` | Opens the packs PR. Refused (409) if a proposal is not `APPROVED` or the golden minimum is not met. |
| `GET /api/v1/admin/law/demand` | Unsupported and unknown kinds, counted. |

**Tests**: API tests (a non-admin gets 403; every write leaves an `operator_audit` row; promote refuses an unapproved
proposal); console component tests with the API mocked, in both themes and both languages.

### 9. One corpus for every product

The corpus is public law: `GLOBAL`, product-agnostic, imported once. A product never copies it and never fetches the
law itself.

- **Yomizaka** reads it through `compliance-check` (lease, notices, état des lieux, language).
- **Akinaza** (prepares tax returns, never files them) reuses it for GST/QST: instruments `E-15`, `SOR-91-45`, `T-0.1`
  and `T-0.1-r2` are in `law.import.instruments` from slice 2; `qc-invoice` gets its `law` blocks (it cites SOR/91-45
  s. 3 today without a hash); its QST gap (the Québec regulation « could not be read at the source », pack README) is
  closed by a derivation, through the same review. Akinaza's questions (« quel taux de TVQ ? ») go through
  `lookupStatute` with `asOf`, so the answer cites art. 16 at its in-force date.
- A future product adds kinds and instruments as data; no engine change.

### 10. Settings

New rows in `orazaka_runtime_config` (job-service), which gains `default_value`, `min_value` and `max_value` in slice 2,
like `studio_runtime_config`; edited through the admin settings API and audited.

| Key | Default | Bounds | Description |
|:---|:---|:---|:---|
| `law.corpus.enabled` | `false` | bool | Master switch of the law corpus (imports, `law-corpus` source, `lookupStatute` on the corpus). |
| `law.import.instruments` | `QC:CCQ-1991,QC:C-11,QC:T-15.01,QC:T-15.01-r1.1,QC:T-15.01-r3,QC:T-0.1,QC:T-0.1-r2,QC:P-39.1,CA:E-15,CA:SOR-91-45` | list, ≤ 200 | The targeted instruments; nothing else is stored. |
| `law.import.max-article-chars` | `20000` | 1000..200000 | Longest article text stored; a longer one fails the import loudly. |
| `law.identify.min-signal-weight` | `2` | 1..10 | Signal weight a detected kind needs to win over the declared one. |
| `law.identify.model-fallback` | `true` | bool | Ask the model to choose among the kinds when signals are ambiguous (quote checked). |
| `law.identify.classify-max-tokens` | `200` | 50..1000 | Output cap of the classify call. |
| `law.retrieval.max-articles` | `40` | 1..200 | Articles one retrieval may keep for a kind. |
| `law.retrieval.max-age-days` | `90` | 7..365 | A cached retrieval is redone after this even if no cited article changed (new articles may apply). |
| `law.derive.max-rules-per-kind` | `30` | 1..100 | Rules one derivation may propose. |
| `law.derive.max-credits` | `2000` | 0..100000 | Credit cap of one derivation run, declared into the ADR-088 run budget; 0 = derivation off. |
| `law.review.min-golden-cases` | `3` | 2..50 | Golden documents a kind needs before promotion (one clean, one with errors, the blank form). |
| `law.lecture.enabled` | `false` | bool | Allow the unaudited « lecture » for unsupported kinds. |
| `law.lecture.max-credits` | `60` | 0..1000 | Hold of one lecture. |

## Alternatives weighed

| Option | Why not |
|:---|:---|
| Fully dynamic: retrieve and derive per document, judge at once | Two runs disagree, every document pays a derivation, and an unreviewed rule decides a verdict the user forwards to a counterparty (ADR-052). Refused. |
| Fully fixed: hand-written rulesets, a kind selector only | What we have, minus the selector: every new kind waits for someone to read the law by hand, and the law changes unseen. Kept as the execution half only. |
| One « universal » housing ruleset with `subject` guards | #127's `subject` stops hollow PASS, not wrong FAILs on rules a form never has to satisfy (rent on a notice). The kind decides what applies. |
| A model classifier as the only identification | Not checkable. Signals as data are readable and tested; the model only breaks ties, from a closed list, with a checked quote. |
| Read Légis Québec or CanLII with a browser user agent | Disguising the agent is refused (#393). The open-data XML is the honest path. |
| Store full Québec texts in the public packs repository | The dataset is CC BY-NC-ND; rulesets pin a hash and a short quote, the corpus stays in our database. |
| Proposals as draft PRs only, no table | The queue needs vet reports, demand and per-rule decisions before a PR is worth opening; the PR stays the promotion. |

## Consequences

- A notice or an état des lieux is never judged as a lease again; a mismatch is shown; an unsupported kind says so.
- Every finding cites a dated, hashed article and a passage, and both quotes are checked.
- The law becomes data with a date and a hash; a change is seen by the watcher and lands as a new dated version.
- The pack README's gaps (art. 1942, section F, the QST regulation) can be closed through the review instead of from
  memory.
- New tables (`law_*`, `rule_proposal`, `kind_demand`) and settings, a new Studio, a new worker capability, one console
  screen. No new step kind and no second research mechanism.
- **TO VALIDATE, added to #393**: commercial use of the Données Québec dataset (CC BY-NC-ND 4.0), a written request
  to its publisher; until then, our good-faith reading above, and the lawyer list. Légis Québec and CanLII stay
  unread by the engine.

## Amendments

### 2026-10-25 — cut 8: the derivation runs in the engine, `vet` is Java (orazaka-ai-engine#82)

Accepted by the CTO on [orazaka-ai-engine#82](https://github.com/krizaka/orazaka-ai-engine/issues/82)
(implemented by orazaka-ai-engine#94, data in orazaka-packs#144). Two departures from §3 and §7:

1. **The paid `propose` step runs in the engine, under a per-run cap.** ADR-088 is still a proposal: a Studio run has
   no credit cap to declare `law.derive.max-credits` into. Until it has one, `RuleDerivationService`
   (`orazaka-tools`) runs the derivation itself: before each model call, what was spent plus the call's ceiling must
   fit in `law.derive.max-credits`, or the run stops (`BUDGET_EXHAUSTED`) and lists the articles it did not reach;
   `0` keeps derivation off. When ADR-088 ships its Studio credit cap, the derivation becomes the `rule-derivation`
   Studio run with `studio_run.credit_cap = law.derive.max-credits`, the saga makes the same comparison, and the engine
   path is deleted: [orazaka-ai-engine#96](https://github.com/krizaka/orazaka-ai-engine/issues/96).
2. **`vet` is `RuleProposalVet`, in Java, pure and failing closed.** It is deterministic (no model, no clock, no I/O
   beyond the corpus at `asOf`), it is the one gate of the write path (only it builds a `VettedProposal`, the only
   thing `rule_proposal` accepts; `[LAW-003]`, `[LAW-004]`), and anything it cannot prove is rejected
   (`REJECTED_AUTO` with its `vet_report`). The review queue's Edit (cut 9) goes through the same gate. The pack's
   Python worker `orazaka.validation.rules.vet` stays and proves the same verdicts on the same planted data
   (`document-validation/derivation/`), so the two cannot drift apart unseen.

## The cut — issues in order

Each is test-first, one PR per repository, with its README and generated docs.

1. **orazaka-packs — kinds as data and `identify`** (stage 1, deterministic). *Accepted when*: `kinds/*.json` with
   schema and fixtures; `test_identify.py` green on the fictional visit notice, état des lieux, lease, invoice and
   service contract, the blank forms, a declared-kind mismatch and an ambiguous document (`KIND_UNKNOWN`).
2. **orazaka-job-service + workspace — the law tables and settings** (stage 2). *Accepted when*: `law_instrument`,
   `law_article_version`, `law_import`, `law_retrieval`, `rule_proposal`, `kind_demand`, the bounds columns on
   `orazaka_runtime_config`, the `law.*` rows, sources `law-corpus` and `donnees-quebec` seeded disabled; the dev-deploy
   migration is idempotent and its test pins « off ».
3. **orazaka-ai-engine — importers, manual import and `lookupStatute` with `asOf`** (stage 2; the watcher #400 schedules
   them). *Accepted when*: the importer tests of §2 pass on recorded XML; `lookupStatute` returns the version in force
   on `asOf` or `LAW_VERSION_UNKNOWN`; every import is a `law_import` row.
4. **orazaka-packs — the first rulesets on the corpus**: packs#125 (visit notice, état des lieux) and packs#126
   (language, ADVISORY as §3 explains), written by hand, with `law` blocks and golden cases. *Accepted when*: the
   blank forms give no PASS; the language rule never FAILs an English lease on language alone; cost of identify and
   check measured and written in the PR.
5. **orazaka-packs + orazaka-studio — `compliance-check` 2.0.0** (stage 4). *Accepted when*: the report contract with
   `identification`, `outcome` and both quotes checked; yomizaka#305's recordings green; identical runs answer from the
   result cache; a 1.x call behaves as before.
6. **yomizaka — the declared kind enters the check** (yomizaka#301). *Accepted when*: the declared kind is sent, the
   mismatch and `UNSUPPORTED_KIND` are shown, one test per kind.
7. **orazaka-ai-engine + orazaka-packs — retrieval through grounded research and its cache** (stage 2). *Accepted
   when*: the retrieval golden case (visit notice → 1931–1933, no rent articles); a cached retrieval makes no model
   call; a changed cited article marks it stale.
8. **orazaka-packs + orazaka-ai-engine — `rule-derivation`, `vet`, `rule_proposal`** (stage 3). *Accepted when*: each
   rejection reason has its planted case; the visit-notice derivation's proposals pass `vet`; the run stops at
   `law.derive.max-credits`.
9. **orazaka-ai-engine + orazaka-web-client — the review queue and promotion** (stages 5 and 8). *Accepted when*: the
   API tests of §8; promotion opens a packs PR on a recorded GitHub API and refuses an unapproved proposal; console
   tests in both themes and languages.
10. **orazaka-packs — the lecture for unsupported kinds** (§6, off by default). *Accepted when*: no verdict field can
    appear in a lecture (contract); `audit: UNAUDITED` always; a claim whose document passage is absent is never
    `VERIFIED`; `kind_demand` counts without content.
11. **akinaza + orazaka-packs — GST/QST on the same corpus** (§9). *Accepted when*: `qc-invoice` pins its `law` blocks;
    Akinaza's QST rate question cites art. 16 at its in-force date through `lookupStatute`.
12. **krizaka/orazaka#393 — add the Données Québec licence point** and the request to its publisher.
