---
description: UNIFIED SURFACE — M2 (the orazaka-media TOOLKIT pack, its six single-step blueprints, and the four capabilities nobody bills)
---

# Workflow: M2 — media becomes a pack

Design intent: [`docs/UNIFIED_PACK_SURFACE.md`](../../docs/UNIFIED_PACK_SURFACE.md) §3, §5 (M2 row),
§5.1, §5.2. Prior runs: ADR-061 (`kind`), ADR-062, ADR-063, ADR-064, and M1.8.

> **M2 is done when every media capability is runnable as a Studio *and metered once*.** The metering
> half is not a follow-up: six Studios that are not billed is the state this whole sequence exists to
> leave. §4 comes before §6 for that reason — you cannot author a blueprint for a capability that has
> no billable unit.

## §0 Init

1. Load `AGENTS.md` — §0, §2, §3, §4, §6, §9, §11, §12.
2. Read `docs/UNIFIED_PACK_SURFACE.md` §3 and §5; `PACK_EXTENSIBILITY_ARCHITECTURE.md` §7 (manifest).
3. Read, **before writing anything**:
   - `orazaka-packs/document-validation/pack.yaml` and its two `studios/*/blueprint.json` —
     **this is the shape you copy.** It is the flagship and it is correct.
   - `orazaka-packs/pack.schema.json`
   - `infra/initdb/30-jobs-config.sql` — the seven `orazaka_capabilities` rows, in full
   - `StudioAccessService` (`kind`/TOOLKIT derivation from M1) and the marketplace band it feeds
   - `ConsumptionReport`, `BillableUnit`, the pricebook DDL, and both divergence contracts

## §1 Order of work — seven commits, in this order

1. §2 `#31` — the seed files, and the test that loads them
2. §3 `#32` — asset scope closed at the listener
3. §4 — the four capabilities with no billable unit
4. §5 — the marketplace band
5. §6 — the `orazaka-media` pack and its six blueprints
6. §7 — the audio/video divergence contracts, and the fps decision reversed
7. §8 `#35` — what a pack bills versus what it does

**Out of scope, do NOT start** — the outbox on step dispatch, lanes, the per-lane ceiling,
`JobSettlementListener`'s unreleased claim (all M2.5); deleting `MediaGenerationController`,
`useBootstrapFeatures`, the composer button row, or the `orazaka.*` key hole in `POST /api/v1/jobs`
(M3); dropping `uri_path`/`http_method`/`payload_template` (M4); the bypass rule (M5); the seam-input
audit (before third-party packs). **Do not close door 1 in this run** — the pack must work while both
doors are open, and M3 is where the deletion is reviewed on its own.

## §2 `#31` — the seed files have no test (the deliverable is the test)

`30-jobs-config.sql:155-157` has a missing comma and a trailing comma. The file has not parsed since
2026-09-09; a fresh bootstrap dies there, existing volumes never see it, and **nothing in the build
loads these files**. The constraint that fails to exist is the one whose comment explains that a
message published to no queue is discarded without an error.

1. Fix the syntax.
2. **Write the test that loads every file in `infra/initdb/` against a real Postgres**, in order, from
   empty. That is the deliverable; the comma is what it finds. Ninth inert control, and the heaviest:
   the seed files are the source of truth for capabilities, packs, pricing and routing, and
   `[PACK-001]` — the rule that *reads* them — was itself found checking zero packs. The same surface
   failed twice, by two ends, found separately.
3. Plant a syntax error, watch it redden, revert.

## §3 `#32` — close asset scope at the listener

M1.8 made the compose worker refuse absolute paths. `POST /api/v1/jobs` still passes the payload
through, `JobListener` scopes only `assetId`, and other executors read what `filePath` names. The
confinement is shut on one side and open on the other.

Close it where the payload is adopted: an asset is referenced by id and resolved against its owner,
**404 not 403**. This does not fix the `orazaka.*` key hole on the same endpoint — that is M3 — and
say so rather than implying the door is shut.

## §4 Four capabilities are unbilled, not one

`#22` was reported as "audio is never billed". The seed says more: **four of the six media
capabilities carry `billable_unit NULL`.**

| Capability | Unit today |
|:---|:---|
| `orazaka.core.media.image` (Image Generation) | `IMAGE_STEP` |
| `orazaka.core.media.video` (Video Generation) | `OUTPUT_SECOND` |
| `orazaka.core.media.audio` (Audio **Analysis**) | **NULL** |
| `orazaka.core.chat.speech` (Speech Synthesis) | **NULL** |
| `orazaka.core.media.vision` (Image **Analysis**) | **NULL** |
| `orazaka.core.media.video.analysis` (Video **Analysis**) | **NULL** |

The pattern is exact: **generation is billed, analysis and synthesis are not.** Four capabilities, one
of which — vision analysis — is the one a user points at a lease.

1. Choose a unit per capability **from the existing `BillableUnit` enum**, and choose it by what the
   executor can actually measure and report. A unit the executor cannot measure reintroduces the
   `IMAGE_STEP` defect: a quantity that comes from configuration or from the request rather than from
   the act.
2. **The rates are not yours.** Put a flagged placeholder in the pricebook and say clearly in the
   report that the numbers need the owner's decision. Do not invent commercial rates silently.
3. Two naming incoherences you will meet — report them, do not fix them here: `orazaka.core.chat.speech`
   is named `chat.*` but is AUDIO and routes to `job.text.process`; `orazaka.core.media.audio` is
   analysis but routes to `job.media.generate`. M4 is where the registry is cleaned.

## §5 The marketplace band

Keyed on `kind` **alone** it tells an unentitled actor that a pack is included — the mirror of the
state M1 deleted, and the same lie in the other direction. Key it on `kind` **and** the entitlement
snapshot, three states: **included** (TOOLKIT + entitled), **buyable** (not entitled, purchasable),
**unavailable**.

`StudioAccessService.evaluateAll` already resolves entitlement in one snapshot for a whole list,
precisely to avoid N service hops. The data is there; this is wiring.

## §6 The `orazaka-media` pack

`kind: TOOLKIT`, `regulatoryClass: STANDARD`, and — per M1's constraint — it declares **neither
`consent` nor `safety`**, because both are answered from an installation row a TOOLKIT does not have.

Six single-step blueprints, one per capability of §4. Copy `document-validation`'s structure; do not
invent a second one.

**The JSON Schemas carry what `payload_template` carried, and the defaults are the part that gets
lost.** `orazaka.core.media.vision` currently defaults its prompt to `Analyze this image`;
`orazaka.core.media.video` defaults `durationSeconds` to 5; image generation defaults `size` to
`1024x1024`. Every default in every template must land in a schema. Write them down from the seed
rows before you start, and check them off — M4 drops those columns, and a default that only ever lived
there disappears with them.

**Do not close door 1.** Both doors work at the end of this run. M3 reviews the deletion alone.

## §7 The divergence contracts, and the fps decision reversed

1. Extend the divergence contract to the audio path and the video-analysis path — the two media types
   the existing contracts do not cover. The image contract found its discrepancy the day it existed;
   the video one found `9.00 s` billed for `2.02 s`. Expect the audio one to find something.
2. **Reverse the fps decision.** M1.6 made the composer force `-r 30` and cap with `-t` so that the
   integer `fps` in the Tier-1 contract would work. Changing the artefact so the meter works is
   backwards even when the new artefact is better. Measure the duration in `ConsumptionReport`
   directly and let the composer stop deciding the frame rate for billing's sake. If the contract
   change is larger than it looks, **stop and report** rather than keeping the forcing quietly.

## §8 `#35` — what a pack bills versus what it does

`realestate-studio` bills 450 credits for a b-roll it never assembles. Seventh billing defect, and the
**first that lives in a pack's content rather than in the engine** — the three shipped packs have never
been confronted with what they charge.

Fix that blueprint, then answer the general question: **what checks that a blueprint's declared cost
corresponds to the steps it runs?** Nothing does today. If the honest answer is a contract per pack
rather than a rule, say so — you have made that call correctly twice.

## §9 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | 100% local. No CI, no cloud. |
| AGENTS.md §4 | Blueprints and capabilities are **data**. No media capability may acquire a Java branch. |
| AGENTS.md §12 | The engine holds the mechanism, never the subject. No pack namespace in engine code [PACK-002]. |
| ERR-103 | One top-level type per file **+ one mirroring test file**. |
| **Build-breaking defects are fixed immediately** | The amendment M1.8 earned: a defect that stops the project building or bootstrapping from scratch is repaired on sight, whatever the scope. |
| **Measured, not declared** | §4.1. A quantity the executor cannot measure is the `IMAGE_STEP` defect wearing a new unit. |
| **Every new rule or contract seen failing** | Plant, paste, revert. |
| **Both doors open at the end** | §6. M3 owns the deletion. |

## §10 Before declaring done

1. `./mvnw -o clean install` green with all `*IT`; Python, CLI, web green; `spotless:check` bound.
2. `[CFG-001]`, `GOV-006`, `[LOG-001]`, `[PACK-001]`, the Python collection guard and every divergence
   and trust contract: active, green, **diff empty** unless this run deliberately extended them.
3. §2: the seed-loading test exists, and the planted syntax error was seen red.
4. A `TOOLKIT` media pack is installed-by-derivation for an entitled actor, all six Studios run, and
   **each is metered exactly once** — asserted, not assumed.
5. §4.2: the placeholder rates are flagged as needing the owner's decision.
6. §6: the table of every `payload_template` default and the schema field it landed in.
7. §7.2: the fps forcing removed, or an explicit report saying why it stayed.
8. Findings: recorded for M2.5's report. The twelve from M1.8 that this run did not touch stay open
   and are listed again, so none is quietly lost.
9. **Commit if green. Never push.**

## §11 Next — do not start

**M2.5 — harden the run path**, prerequisite to M3: the transactional outbox on step dispatch; lanes
(separate queues and consumers, never AMQP priorities); a per-lane step ceiling, because one global
`run.step-timeout-seconds` measured from `started_at` cannot serve both a 200 ms text step and a 67 s
image job once the queue genuinely fills; and `JobSettlementListener`'s dedup claim that is never
released — "claimed atomically, never released", standing in the settlement path, where a missed
settlement is work done and never billed.

Then **M3** — close door 1, which also closes the `orazaka.*` key hole and `#32`'s remainder.
