---
title: "ADR-061 — Pack kind, and the installation a TOOLKIT does not have"
description: "M1 of the unified pack surface. A third classification on pack, orthogonal to tier and regulatory class; a TOOLKIT's installation derived from entitlement and never stored; resolve-once, which turned out to be a property the run table already had; and the third question the plan did not ask."
category: ADR
order: 61
---

# ADR-061 — Pack kind and derived installation

- **Status**: Accepted
- **Date**: 2026-09-14
- **Scope**: `pack.kind`, `studio_run.installation_id`, `StudioAccessService`, `StudioRunService`,
  the run-by-Studio route, the manifest schema, the CLI, the marketplace
- **Implements**: M1 of [`UNIFIED_PACK_SURFACE.md`](../UNIFIED_PACK_SURFACE.md) §5
- **Follows**: [ADR-051](ADR-051-sensitive-controls.md) and
  [ADR-055](ADR-055-regulated-controls-and-the-wellbeing-pack.md) — the SENSITIVE and REGULATED
  controls this decision must not weaken

## 1. What `kind` is

`category` answers *for whom*. `kind` answers *what sort of thing*:

- **VERTICAL** — chosen and installed. The installation is a row: it pins a blueprint version,
  holds the actor's configuration, and records consent where the pack requires it.
- **TOOLKIT** — platform capability an entitled actor simply has. The installation is **derived**
  from the entitlement and never stored.

It earns its place twice. It removes `tool` from being a category it was never a peer of. And it
deletes a state with no correct behaviour — *the plan grants image generation, but the pack is not
installed* — because a TOOLKIT cannot be entitled and uninstalled.

`kind` is a **row**, like `regulatory_class` (AGENTS.md §4), declared by the manifest and written as
declared (AGENTS.md §12).

## 2. Three classifications, none derived from another

| | Values | Answers | Stored |
|:---|:---|:---|:---|
| `tier` | DATA · CAPABILITY · WORKER | what the pack contributes | `pack.yaml` only |
| `kind` | VERTICAL · TOOLKIT | how it reaches the user | `pack.kind` |
| `regulatory_class` | STANDARD · SENSITIVE · REGULATED | what controls it forces | `pack.regulatory_class` |

A future reader will assume TOOLKIT implies Tier-C, or implies STANDARD. **Both are wrong**, and the
DDL comment on `pack.kind` says so. A SENSITIVE toolkit keeps all four of its run controls — data
class, shortened retention, the append-only trail, the scope guard — because they hang off the pack
row and the run, never off the installation. Nor is `kind` read from the key: `echo-toolkit` is a
VERTICAL, the Tier-W reference pack, named for what it demonstrates.

## 3. VERTICAL pins, TOOLKIT floats — and resolve-once was already true

A derived installation has no `pinned_version`. A TOOLKIT run therefore resolves the latest
published version — the same `StudioCatalogService.latestPublished` a fresh install pins — **once,
at run start**, and writes it to `studio_run.blueprint_version`.

The hard requirement was *never re-resolve per step*. It needed **no new code in the saga**, and
that is worth stating rather than implementing twice: `studio_run.blueprint_version` already existed,
and `RunSagaService.advance` already loads its blueprint from that column and nothing else. The DAG
has always pinned per run; what pinned per *installation* was only the choice of value written at
start. So the only new resolution site is `StudioRunService.start(studioKey, …)`, and
`RunSagaService` is not in this change.

**Proven, not asserted.** `ToolkitDerivedInstallationIT.publishingMidRunDoesNotChangeWhatTheRunExecutes`
starts a two-step run on v1, publishes v2 through `BlueprintPublishService` between the first step's
dispatch and its outcome, and checks that the second step dispatched is v1's while the *next* run
takes v2. To show the test can fail, the saga was planted with a per-advance re-resolution
(`SELECT latest_version FROM studio`); the test failed with
`expected: <v1 second> but was: <v2 second>`, and only that test. Reverted.

## 4. Which classes may be TOOLKIT

Consent is recorded on `studio_installation` (`consent_version`, `consent_recorded_at`,
`age_attested_at`, `region`). A derived installation has no row to record it on.

- **STANDARD** — allowed.
- **SENSITIVE** — allowed; none of its controls needs an installation.
- **REGULATED** — **forbidden**, in the database: `ck_pack_toolkit_not_regulated`. A consent gate
  with nowhere to record what was agreed to is not a consent gate.

**One step further than the brief, with the evidence.** Below REGULATED, `consent` and `safety` are
optional — and both are still answered from an installation row. `StepDeclarationService.crisisResponse`
chooses its reply by the installation's `region`; with no row it returns `Optional.empty()`,
silently. A SENSITIVE toolkit declaring `safety` would answer a crisis with nothing. So
`ck_pack_toolkit_no_installation_controls` forbids either declaration on a TOOLKIT at any class.

The invariant is held at four layers, each for its own reason:

| Layer | Where | Why it exists |
|:---|:---|:---|
| Schema | `pack.schema.json` `allOf`, checked by the CLI | the author hears it before the network |
| Type | `PackBundle` and `Pack` compact constructors | a value that cannot be built cannot be installed |
| **Database** | `ck_pack_toolkit_*` | **the guard** — one `INSERT` cannot route around it |
| Build | [PACK-001], over seeds **and** `orazaka-packs/*/pack.yaml` | a committed manifest the database would refuse fails before anyone installs it |

## 5. The third question the plan did not ask

`studio_run.installation_id` was `UUID NOT NULL REFERENCES studio_installation(id)`, and the only
route that started a run was `POST /installations/{installationId}/runs`. A TOOLKIT has neither an
id to put in the URL nor one to store. The workflow's manifest did not name either change.

- **`installation_id` is nullable.** Every reader of the installation during a run already degraded
  to "no row": `effectiveConfig` falls back to the blueprint's defaults, the retention sweeper's
  `COALESCE` falls back to the class window, the uninstall `DELETE` cascades nothing it should not.
- **But nullable alone is a consent bypass one `INSERT` wide**, so the pack CHECK is restated where
  it can be checked without a join: `ck_run_uninstalled_not_regulated CHECK (installation_id IS NOT
  NULL OR data_class <> 'REGULATED')`. The pack CHECK guards the catalogue; this one guards the runs.
- **`POST /api/v1/studios/{studioKey}/runs`** runs a Studio by key. A TOOLKIT is run through its
  derived installation; a VERTICAL through the actor's installation, delegating to exactly the
  checks the installation route applies.

## 6. Installing a TOOLKIT is an error

`POST /studios/{studioKey}/installations` on a TOOLKIT answers `409 studio_included`, after the
entitlement check (so an actor who cannot have it hears that first, as for any Studio).

Not a no-op, because an install's contract is an **addressable** installation — id, pin, config —
that configure, upgrade, uninstall and run then consume. A TOOLKIT's installation has none of them.
A successful no-op must invent that address, and the caller's next call fails far from the
assumption that caused it. Writing a row to make the address real deletes the one property a TOOLKIT
exists to have, and fails gate 5.1. The refusal states the truth at the call that made the wrong
assumption, and names the remedy: `run`.

## 7. One refusal shape

An unentitled TOOLKIT (`StudioNotEntitledException`) and an uninstalled VERTICAL
(`StudioNotInstalledException`) answer **the same status and the same body keys** — `status`,
`message`, `studioKey`, `entitlementKey`, `packKey`, `remedies` — and so does `studio_included`. One
private builder in `RestErrorResolver` produces all three, because a client with one branch for
these refusals is only correct while no handler grows a key the others lack. Only `status` and
`remedies` differ (`buy_package`/`upgrade_plan`, `install`, `run`), and they say what the pack page
the client opens will offer. `RestErrorResolverTest` pins the key sets as equal.

The existing VERTICAL refusals keep their exact bodies.

## 8. A Studio's kind is read through `studio.pack_key`

`pack_studio` lets a Studio sit in several packs; `studio.pack_key` names the one it is sold under.
Kind is read through the latter, for one reason: it is the same relation the entitlement refusal
already reads as *the pack to buy*. Reading kind through `pack_studio` would make it possible for a
card to say "included" for one pack while the refusal points at another. A Studio with no pack row
reads as VERTICAL — the kind that needs an installation **and** an entitlement, so no Studio is
granted anything by the default. `Studio` refuses to be constructed as a TOOLKIT with no `packKey`.

## 9. Behaviour preservation

- **The VERTICAL run path executes the same 37 SQL statements, same text, same order**, measured
  with M0's `CountingDataSource` before and after the refactor of `StudioRunService.start`.
- Every existing studio-service suite passed unmodified in its assertions; `StudioRunLifecycleIT`'s
  wiring gained the two constructor arguments and nothing else.

## 10. Found on the way

Fixed, because each was on M1's own path and M1 does not work without it:

- **The web client would have rejected every TOOLKIT run.** `RunSchema.installationId` was
  `z.string()`; a run with no installation fails `RunSchema.parse` in the client that started it.
- **The CLI would have dropped `kind`.** `pack.bundle.ts` copies the manifest field by field into
  the bundle it posts; a field it omits is not an error anywhere — the server defaults it, and a
  TOOLKIT installs as a VERTICAL in silence. Pinned by a test that was planted without the mapping
  and failed (`Received: undefined`).
- **`kind` could not have been written at all**: `pack.schema.json` is `additionalProperties: false`.

Recorded, not repaired:

- `pack.schema.json`'s first `allOf` description still says `PackCoherenceRules` fails the build when
  a `pack_studio` row has no matching grant. The rule's own javadoc says, correctly, that its seed
  checks have read nothing since phase D; the schema's does not.
- There is no Prettier configuration in the UI workspaces. `npm run format` would reformat to
  Prettier's 80-column default, away from the ~100-column style the code is written in: 11 of the 12
  UI files this change touched were already "unformatted" by that standard at `HEAD`. Nothing was
  reformatted here.
- `PackCatalogEntry`'s compact constructor assigns the `status` default twice.

## 11. What M1 leaves open

- **The marketplace band is not entitlement-aware.** It reads "Included" from `kind` alone. That is
  right if M2's media pack is granted by plan; if it is sold as a paid pack, the band offers no way to
  buy it. M2 must decide how the pack is granted before it ships.
- `GET /installations` does not list derived installations — it lists addressable ones. The
  catalogue carries `kind`, which is how a client knows a Studio is included.
- `StudioAnalyticsService` counts installation rows, so a TOOLKIT Studio reports zero installs.
- The CLI and the mobile client still start runs through installations. Moving them is M3.

## 12. Gates, with the failures that prove them

| Gate | Test | Seen failing by |
|:---|:---|:---|
| 5.1 zero installation rows | `entitledActorRunsAToolkitWithNoInstallationRow` | — (asserts a count of 0 on the real schema) |
| 5.2 one refusal shape | `unentitledToolkitAndUninstalledVerticalRefuseAlike`, `RestErrorResolverTest` | — |
| 5.3 publish mid-run | `publishingMidRunDoesNotChangeWhatTheRunExecutes` | planting per-advance re-resolution in the saga |
| 5.4 refused by the database | `theDatabaseRefusesARegulatedToolkit` (+2) | deleting `ck_pack_toolkit_not_regulated` from `80-studio.sql` |
| 5.5 preservation | every existing suite; the 37-statement diff | — |
| 5.6 [PACK-001] | `SqlBoundaryTest` | planting `kind: TOOLKIT` in `wellbeing/pack.yaml`, and a violating seed row |
| UI | `StudioInstallPanel.test.tsx` | deleting the TOOLKIT branch |
| CLI | `pack-bundle-kind.test.ts` | deleting the `kind` mapping |
