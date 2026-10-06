---
description: UNIFIED SURFACE — M1.8 (governed data surviving retention in the job plane, asset scope by id not path, the matched term in guard logs). The last remediation run.
---

# Workflow: M1.8 — the disclosure surface, closed

Prior runs: ADR-062 (inert controls), ADR-063 (media turn), ADR-064 (trust boundaries).
Findings being closed: `PRODUCTION_READINESS_AUDIT.md` **#27**, **#28**, and the open point left by
`#26` — guards still log the matched term.

> **This is the last remediation run, and unlike the previous commitment this one has a stated rule
> rather than a hope: any live finding that appears during M1.8 goes into M2's report, whatever its
> colour.** Remediation has to end somewhere, M2 will surface its own findings, and the mechanisms
> built over the last three runs are now the thing that catches them.
>
> #27 and #28 were not found by re-reading code. They were found **by the controls M1.7 built** — the
> resurrected tests produced #28, the log sweep produced #27's real carrier. That is the system
> working, and it is why the discovery rate should now fall.

## §0 Init

1. Load `AGENTS.md` — §0, §2, §6, §9, §11, §12.
2. Read audit findings #26 (open point), #27, #28, and ADR-064.
3. Read, **before writing anything**:
   - `RetentionSweeper` and everything it deletes today
   - `orazaka_jobs` DDL and the encrypted job-file layout (envelope encryption, `ORZAENC1`)
   - `JobCommand` in `orazaka-libs/orazaka-contracts/orazaka-jobs-api` — **does `data_class` travel on it?**
   - the append-only audit row written on a guard refusal — **what does it contain?**
   - the compose input path and the resurrected test that asserts the current behaviour

## §1 Scope — three items

§2 `#27` · §3 `#28` · §4 the matched term. Nothing else.

**Out of scope, do NOT start** — `#22` (M2), the `orazaka-media` bundle or any blueprint (M2), the
marketplace entitlement band (M2), the outbox / lanes / per-lane ceiling / `JobSettlementListener`'s
unreleased claim (M2.5), deleting any controller or the `orazaka.*` key hole in `POST /api/v1/jobs`
(M3), the seam-input audit (§8). If the three are green and you have budget left, **stop and report**.

## §2 `#27` — retention is per-context, and the class travels with the work

**Decision: option (b), with (c) as the *value* SENSITIVE takes — not as a separate mechanism.**

Option (a) was rejected on a specific ground worth recording in the ADR: a run purge that deletes its
jobs crosses two contexts. Either the studio service reads the job context's tables — SEAM-001 forbids
it — or it goes by message, and then **retention depends on a delivery**. One lost event and the data
survives with nothing to signal it. A guarantee with a silent failure mode is not a guarantee, and
that is the exact defect class these runs have been closing.

Option (c) alone was rejected because the payload is needed *during* execution — retry, DLQ, diagnosis
— and removing persistence for sensitive steps makes the sensitive path structurally different from
the normal one, therefore less exercised.

So: **`data_class` travels with the job; job-service purges its own rows and its own files; the class
parameterises the retention window, and SENSITIVE's window is "at terminal state".** One mechanism,
class-driven. Each context owns retention for the data it owns.

### §2.1 Things that will go wrong if not stated

- **`data_class` on `JobCommand`.** If it does not travel today, this is a Tier-1 contract addition.
  A job whose class is absent must not default to STANDARD silently — an unknown class is a
  configuration error, and phase A's "fail loudly, no default branch" applies.
- **A job dispatched outside a run has no class.** That is door 1, and M3 closes it. Say what the
  class is in the meantime and why that is acceptable **now** rather than assuming.
- **Order of deletion.** Delete the file, then the row. The reverse loses the pointer and the
  encrypted file becomes immortal. Add a reconciliation for orphans, because the window between the
  two exists whatever the order.
- **The key material.** A purged file whose envelope key survives is a purge that a key-holder can
  undo. State what happens to it.

### §2.2 The question underneath, which must be answered not silently resolved

The append-only audit trail and shortened retention point in **opposite directions**. If the audit row
records *that a crisis response was returned*, or carries a refusal reason naming what was matched,
then **the audit is the disclosure** — a permanent record of a sensitive inference about a person —
and `orazaka_jobs` was never the worst carrier.

Read what the audit row contains today. The rule to land: **the audit records that a run happened and
what its outcome class was, never what it matched and never the subject.** If that conflicts with
something the audit is currently relied on for, say so rather than choosing quietly.

### §2.3 Proof

A test that runs a SENSITIVE step to terminal and asserts **the row is gone and the file is gone** —
both, separately. Not "the sweeper executed". Then plant: disable the class-driven window, watch it
redden, revert.

## §3 `#28` — reference an asset, do not validate a path

**This is not a decision, it is a fix, and the fix is to stop accepting paths.**

Adding an owner check to a path parameter validates an expressiveness that should not exist. It is the
same reasoning as *namespace, do not reorder*: remove the possibility rather than guard it.

1. **A run input references an asset by id.** Resolution happens server-side against the owner.
2. **404, never 403** — the established rule from the security wave; enumeration is the attack.
3. **Defence in depth at the worker.** The compose worker must refuse an absolute path outright and
   accept only what resolves under the root it derives for the job's actor. This does not fix the
   `orazaka.*` key hole in `POST /api/v1/jobs` — that is M3 — but it means the worker is not relying
   on the run path being the only producer.
4. **The resurrected test that asserts the current behaviour as expected is rewritten to assert the
   refusal.** Say in the report what it used to assert. A test written to match what the code did is
   the strongest evidence that nobody ever reasoned about it.
5. Check the three content packs: if any blueprint passes a path as an input today, this is a contract
   change for them too. Report it rather than discovering it in M2.

## §4 The matched term

Guards still log the term they matched, which is the user's own words, and on a crisis guard **the
presence of the match is itself the disclosure**. Same object as §2.2, one layer out.

Log that a match occurred and which rule fired. Never the term, never the surrounding text. Check the
refusal reason too — if it embeds the match, it travels further than the log does.

## §5 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | 100% local. No CI, no cloud. |
| AGENTS.md §12 | The engine holds the mechanism, never the subject. A retention window driven by a class is mechanism; the class is the pack's declaration. |
| SEAM-001 | No cross-context deletion, and no FK. Each context purges what it owns. |
| ERR-103 | One top-level type per file **+ one mirroring test file**. |
| **Fail loudly** | A job with no `data_class` is a configuration error, not a STANDARD job. |
| **Remove, do not validate** | §3. |
| **Every new rule seen failing** | Plant, paste, revert. |
| **No repairs in passing** | Anything new goes to M2's report. Do not open M2, M2.5, M3, or the seam audit. |

## §6 Before declaring done

1. `./mvnw -o clean install` green with all `*IT`; Python, CLI and web suites green; `spotless:check`
   still bound.
2. `[CFG-001]`, `GOV-006`, `LOG-001`, the Python collection guard and all divergence/trust contracts:
   still active, still green, **diff empty**. No control from a previous run loosened.
3. §2.3: row gone and file gone, asserted separately, with the planted regression seen red.
4. §2.2 answered: what the audit row contains now, and what it no longer contains.
5. §3.4: what the resurrected test used to assert.
6. §3.5: whether any existing blueprint passes a path.
7. Anything new: **M2's report**, whatever its colour. Do not schedule an M1.9.
8. **Commit if green. Never push.**

## §7 The finding this run deliberately does not act on

`consumption.putAll(reported)` showed that an out-of-tree executor (ADR-038) could overwrite a
measurement the platform took. It was filtered, and the general obligation it exposes was not:
**every seam opened for open-core is also an input to distrust** — executor SPI, worker registration
and `worker.yaml`, pack manifests, admin-authored blueprints. Four seams, one examined, and the one
examined had the defect.

That audit belongs **before any third-party pack is installed**, not before M2. It is recorded here so
it does not evaporate.

## §8 Next — M2, and the queue is empty

M2: the `orazaka-media` bundle and its six single-step blueprints. Opens with the marketplace band
keyed on `kind` **and** the entitlement snapshot. Absorbs **#22** (audio never billed) with the audio
half of the divergence contract, and owes the deferred fps decision — duration measured in
`ConsumptionReport` rather than the composer forcing `-r 30`, because changing the artefact so the
meter works is backwards even when the new artefact is better.

Then M2.5: harden the run path — outbox on dispatch, lanes not priorities, per-lane ceiling, and
`JobSettlementListener`'s dedup claim that is never released, which is the "claimed atomically, never
released" defect standing in the settlement path: a missed settlement is work done and never billed.

Then M3: close door 1, which also closes the `orazaka.*` key hole in `POST /api/v1/jobs`.
