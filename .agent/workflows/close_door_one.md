---
description: UNIFIED SURFACE — M3 (close door 1; the composer keeps its buttons and they launch runs). The irreversible phase.
---

# Workflow: M3 — one door

Design intent: [`docs/UNIFIED_PACK_SURFACE.md`](../../docs/UNIFIED_PACK_SURFACE.md) §2 (the bypass),
§3, §5. Prior runs: ADR-061…067.

> **This is the irreversible phase and the one that delivers the value.** Until door 1 is closed the
> governance bypass exists and two metering paths exist. Everything before it was preparation.
>
> **Product decision, taken and not to be relitigated:** the chat composer **keeps its button row**.
> The buttons launch a single-step run instead of a direct POST. Governance applies, the UX does not
> regress, and `useBootstrapFeatures` is *replaced* rather than deleted. Deleting the affordance and
> sending users to `/studios` was rejected: it charges the user for our refactor.

## §0 Init

1. Load `AGENTS.md` — §0, §2, §3, §4, §6, §9, §11, §12.
2. Read `UNIFIED_PACK_SURFACE.md` §2, §3, §5 and ADR-066/067.
3. Read, **before writing anything**:
   - `useBootstrapFeatures()` → `/api/v1/features` → `executeFeatureWithPrompt` — the whole chain
   - `MediaGenerationController`, `MediaAnalysisController`, and the `POST /api/v1/jobs` endpoint
   - `StudioRunController` — `POST /studios/{studioKey}/runs` (added in M1 for TOOLKIT) and the run
     status read
   - the six `orazaka-media` blueprints and their JSON Schemas

## §1 Order — five commits

1. §2 `#45` — the shipped packs are installed by bootstrap, not by hand
2. §3 — the composer's button row, served from studios
3. §4 — the composer launches runs; CLI and any other client follow
4. §5 — delete door 1
5. §6 — the proof

**Out of scope, do NOT start** — dropping `uri_path`/`http_method`/`payload_template`, the two lying
capability names `#44`, or the capability **output** contract (all M4); the bypass governance rule
(M5); `#33`, `#34`, `#43` and the rest of the open list; the seam-input audit. Relist the open
findings; close none of them in passing.

## §2 `#45` — a pack that only exists in the repository is not installed

`orazaka-media` is written and absent from any database. **Closing door 1 while the pack is not
installed deletes media generation**, so this is step zero — and the fix is not "run the install
command".

The real finding is that **a shipped pack has no bootstrap path**: a fresh environment gets the pack
files and no Studios. That is the seed-file defect one layer up — `infra/initdb` had no test until M2
wrote one, and the bundles have no installation until this run gives them one.

A fresh `orazaka start` must end with the shipped packs installed, and a test must assert it from
empty. Otherwise M3 ships a system whose fresh install has no media capability at all.

## §3 The button row, served from studios

`/api/v1/features` returns `orazaka_capabilities` rows with `icon`, `label`, `uri_path`,
`http_method`, `payload_template`. After this run the composer is served from the studios the actor
has — which for a TOOLKIT means **derived installation**: entitlement alone, no `studio_installation`
row (ADR-061).

**Which studios belong in a composer?** Not all of them: a multi-step prospection Studio has no place
in a chat box. Answer it with a predicate over **structure**, not over spelling:

> a Studio the actor can run in one step, whose schema needs nothing but a prompt (everything else
> defaulted).

Deriving from the blueprint's structure is legitimate; `key.contains("image")` is the defect phase A
removed. If you conclude a declared flag is better, argue it — but a flag drifts and a structure
cannot, and *declared, not inferred* exists for facts that cannot be derived correctly, which this one
can.

Icon and label now come from the studio/pack i18n. **That removes the last consumer of the UI-manifest
columns**, which is precisely what makes M4 a deletion rather than a migration — say so in the ADR.

## §4 The composer launches a run

`executeFeatureWithPrompt` POSTs to the `uri_path` the row declares. It becomes
`POST /api/v1/studios/{studioKey}/runs` with the prompt as the single input.

Three things that will be discovered late if not decided now:

1. **Run states.** A job had two outcomes; a run has `PENDING`, `RUNNING`, `AWAITING_INPUT`,
   `SUCCEEDED`, `FAILED`, `CANCELLED`. A single-step media Studio should never reach
   `AWAITING_INPUT` — say what the composer renders if it does, rather than leaving an unhandled state
   in the UI.
2. **Latency is now known, and acceptable.** Saga p95 19.2 ms plus up to 500 ms of relay poll, against
   an image at p50 67 s. Say it in the ADR so nobody re-opens the question, **and note that the relay
   wait is per dispatch** — invisible here at one step, 2.5 s on a ten-step blueprint, and the remedy
   if it ever matters is notify-on-append, never a shorter poll.
3. **Enumerate the callers.** `grep` for every consumer of `/api/v1/media/**` — CLI, web, any mobile
   client, e2e suites, docs, examples. Move them all. **Do not assume the list**; the last three runs
   each found a caller nobody had counted.

## §5 Delete door 1

`MediaGenerationController`, `MediaAnalysisController`'s generation paths, `useBootstrapFeatures`,
`executeFeature`, and the composer's direct POST path.

**`POST /api/v1/jobs` is part of door 1 and must go with it** — it is the rawest direct invocation,
it carries the `orazaka.*` key hole M1.7 found, and `#32`'s remainder (a `filePath` the listener never
scoped) lives on it. If some service-to-service caller genuinely needs it, restrict it to `SERVICE`
authority and say which caller; do not leave it open to a user token.

**`/api/v1/media/analyze/upload` stays.** Uploading an asset is not a capability invocation, and the
authenticated asset endpoint from wave 1 is its right owner.

## §6 The proof

1. `grep` finds no caller of `/api/v1/media/generation/**` anywhere — source, tests, docs, CLI, e2e.
2. A test asserts that invoking a media capability produces a `studio_run` row and that **no path
   produces an `orazaka_jobs` row without one.**
3. The six capabilities each run from the composer, are metered exactly once, and a SENSITIVE input
   now receives the data class, the retention, the audit row and the scope guard it never received
   through door 1. **Assert the controls, not just the success** — the whole reason for this phase is
   the controls, and a test that only checks the image comes back would have passed before M3 too.
4. Plant: restore one direct controller, watch §6.2 redden, revert.

## §7 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | 100% local. No CI, no cloud. |
| AGENTS.md §6 | `orazaka.core.chat.completion` **stays synchronous and off the broker.** Interactive streaming is not a run, was never door 1, and is not in scope. |
| AGENTS.md §4 | No capability acquires a Java branch. The composer reads data. |
| **Structure, not spelling** | §3. Deriving from a blueprint's shape is not the `contains()` heuristic. |
| **Enumerate, do not assume** | §4.3. |
| **Assert the controls** | §6.3. Success is not the property under test. |
| **Build-breaking defects fixed on sight** | The M1.8 amendment. |
| **No repairs in passing** | Relist the open findings; close none. |

## §8 Before declaring done

1. `./mvnw -o clean install` green with all `*IT`; Python, CLI, web green; `spotless:check` bound.
   State the Java test count and its delta against **2 951**.
2. Every control from every previous run: active, green, **diff empty** unless deliberately extended.
3. §2: a fresh bootstrap ends with the shipped packs installed, asserted from empty.
4. §4.3: the full caller list, and what each became.
5. §6.3: the controls asserted individually — data class, retention, audit row, scope guard, single
   metering.
6. §6.4: the planted controller, seen red, reverted.
7. What `POST /api/v1/jobs` became, and if it survives, which caller justified it.
8. Open findings relisted in full.
9. **Commit if green. Never push.**

## §9 Next

**M4** — drop `uri_path`, `http_method`, `payload_template` (their last consumer left in §3);
re-document `is_enabled`; rename the two capabilities whose names lie (`#44`); and give the registry
the half of its contract it has never had — **capabilities declare inputs and not outputs**, so every
`{{steps.<out>.<field>}}` link in every DAG references a field nothing declares, and `#43` is the same
gap from the other end.

**M5** — the rule that reddens if any capability becomes reachable other than through a run, so the
bypass cannot grow back. Planting a direct controller must fail the build, not a review.
