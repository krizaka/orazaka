---
title: "ADR-039 — The pack bundle: a manifest, a schema, and a compensated three-context install"
description: "Why a pack becomes a directory with a manifest rather than rows in a seed file, why the install is a compensated sequence across three databases instead of one transaction, why the ordering capabilities → billing → catalogue is the design rather than an implementation detail, and why manifest validation is deliberately split between the CLI and the service."
category: ADR
order: 39
---

# ADR-039 — The pack bundle: a manifest, a schema, and a compensated three-context install

- **Status**: Accepted
- **Date**: 2026-08-31
- **Scope**: `products/orazaka` — `orazaka-packs/` (`pack.schema.json`, `README.md`, and the three
  migrated bundles); `PackBundle` and its records in `orazaka-studio-api`; `PackProvision`,
  `EntitlementGrant`, `PackProvisioningClient` in `orazaka-billing-api` with their
  `orazaka-billing-client` adapters; `CapabilityDeclaration` and `CapabilityRegistrationClient` in
  `orazaka-jobs-api`; `PackInstallerService`, `PackInstallRepository` and
  `JdbcPackInstallRepositoryAdapter`, `PackBundleController` in `orazaka-studio-service`;
  `CapabilityRegistryService` and the write half of `CapabilityController` in `orazaka-job-service`;
  `PackProvisioningController` in `orazaka-billing-service`; `orazaka pack` in the CLI; the removal
  of catalogue content from `infra/initdb/80-studio.sql` and `70-billing.sql`.
- **Extends**: [ADR-037](ADR-037-pack-spi-and-open-core.md) (S1, purity rules) and
  [ADR-038](ADR-038-worker-spi-and-registration.md) (S2, S3).
- **Implements**: `docs/PACK_EXTENSIBILITY_ARCHITECTURE.md` §3.2, §3.3 (S4) — phase D.

## Context

Phases A–C made a capability's routing, its executor and its worker all resolvable at runtime. What
remained hardcoded was the pack itself. A pack was rows in `infra/initdb/80-studio.sql`, a price in
`70-billing.sql`, and prompts in a resources directory — 288 lines of product content living in the
file that creates the schema.

That works for packs written by us, in this repository, forever. It fails three ways the moment it
must not be: a seed is applied **once**, by Postgres, at container creation, from **inside** this
repository. A pack ships outside the repo (phase G), is installed against a **running** platform
rather than an empty one, and is installed more than once — upgraded, re-applied, uninstalled. None
of those are things a seed file can do.

The design (§3.2) called for a manifest and said to build it *now even if the registry is a year
away*, because retrofitting one onto packs that already shipped is the expensive path. Phase E
authors the first pack that is not a migration; doing it before D means writing it twice.

## Decision

### 1. A pack is a directory with a manifest, validated against a published JSON Schema

`pack.yaml` (grammar `orazaka.dev/v1`) plus `i18n/<locale>.yaml` and
`studios/<key>/blueprint.json`. `orazaka-packs/pack.schema.json` is JSON Schema 2020-12 and is the
contract: a manifest that does not match it is refused before anything is sent.

**`catalog` is optional, and that is a requirement rather than laxity.** Two of the three Studios
shipping today belong to no pack: `trade-showcase` is FREE and `outbound-prospection` is INCLUDED,
neither has a `pack` row, a price or a grant to buy. A manifest format that could not express the
catalogue **as it already exists** would have failed its first test. A bundle without `catalog`
ships Studios only.

### 2. The install is a compensated sequence across three contexts, not a transaction

An install writes three databases owned by three services: `orazaka_db` holds
`orazaka_capabilities`, `orazaka_billing_db` holds the price and grants, `orazaka_studio_db` holds
the catalogue. SEAM-001 forbids the cross-context foreign keys that would make them one schema —
deliberately, because that separation is what lets a marketing copy change avoid deploying the
service that holds the credit ledger.

So "one operation or nothing" is honoured as **each context applies its own slice in its own local
transaction, sequenced, with backward compensation** — not as a distributed transaction. Two-phase
commit across three services would trade away the property SEAM-001 exists to buy, to gain atomicity
for an admin-speed operation that happens a handful of times per release.

Every write is an **upsert**, so a failed install is safe to retry rather than something to unpick.
The exception is a PUBLISHED blueprint, which the database itself refuses to rewrite: shipping a
change means shipping a new version (ADR-034 §5), and an installer may not route around that.

### 3. The order — capabilities → billing → catalogue — is the design

- **Capabilities first.** A blueprint naming a capability that does not resolve is a Studio that
  fails at dispatch; it must be impossible to publish one.
- **Billing second.** A `pack_studio` row whose matching `billing_pack_entitlement` is missing is
  ADR-036's invariant #3 violated: silent, indistinguishable from a billing bug, and it locks out
  exactly the customer who just paid. The grant exists *before* the row that promises it.
- **Catalogue last**, in one local transaction, because it is the slice a user can see and the one
  that must never be half-written.

Seeding both halves in two files applied in alphabetical order made that ordering a coincidence of
filenames. It is now a line of code.

### 4. The grants are derived from the Studios, never declared separately

`PackInstallerService.toProvision` builds one `EntitlementGrant` per Studio from that Studio's own
`entitlementKey`, and `PackStudio`'s constructor refuses any key that is not `studio.<key>`. A
manifest stating both the Studios and the grants would let them disagree, and the disagreement has
exactly one symptom: a customer who bought the pack and cannot open the Studio it advertises.

This is also **where ADR-036's invariant #3 now lives**. `PackCoherenceRules` checked it by reading
the seed files; the content left those files, so the rule now passes vacuously. Rather than delete
it, the rule records that it guards nothing today and why, and the invariant moved from *checked* to
*unrepresentable* — a stronger position, pinned by `PackBundleTest`.

### 5. Validation is split between the CLI and the service, on purpose

The manifest's **shape** is checked in the CLI against `pack.schema.json`, with no platform running:
that is the loop a pack author lives in, and `--offline` makes it explicit. Whether **this platform
can run the bundle** — do the `featureKey`s its blueprints name resolve to enabled routes — is a
different question with a different answer per deployment, so `PackInstallerService.validate`
answers it server-side and `install` re-runs it before writing anything. A bundle that passes the
schema and fails the platform is not malformed; it is a pack this platform lacks a worker for.

### 6. The install surface is `ADMIN`, and the calls it makes downstream are `SERVICE`

Installing a pack adds Studios to a catalogue, opens a shelf and creates a sellable price — a
human's decision, taken by someone accountable for it. The service-to-service writes it performs
(`/internal/v1/capabilities`, `/internal/v1/billing/packs`) carry the `SERVICE` authority; the
decision to install does not.

## Consequences

- **A fresh database has an empty catalogue.** `orazaka start` no longer yields Studios; they appear
  after `orazaka pack install --all ./orazaka-packs`. The Studio end-to-end suite has the same
  precondition, because it names `trade-showcase` and `realestate-reels`. The extra step is not an
  oversight — a Studio is now *installed* rather than assumed, and a bootstrap that hid the
  difference would mean the install path is only exercised by the packs we happen to ship.
- **The migration is a transcription.** Every value in the three bundles came out of the rows
  deleted from the seeds, and the installer writes them back identically. What changed is where the
  content lives, never what it says.
- **`billing_pack` is now written by an installer, not a seed.** The admin console's `PUT
  /api/v1/billing/packs/{packKey}` is unchanged and shares `PackPricingService` with the new
  internal surface, so there is exactly one implementation of "write a pack's price and grants".
- **Capability contribution is implemented but unexercised.** All three migrated bundles are
  `tier: DATA` and contribute zero capabilities. The path — declaration, registration, compensation,
  the `evt.capability.changed` announcement — is written and unit-tested, and phase H's Tier-W pack
  is its first real consumer. That is stated rather than hidden: an install path whose only test is
  the empty case is a path that has not been proven.
- **Two npm dependencies were added to the CLI**: `yaml` and `ajv` (with `ajv-formats`). A manifest
  format needs a parser and a schema needs a validator; hand-rolling either would mean the published
  schema and the code that enforces it could drift, which is the failure the schema exists to
  prevent.

## Alternatives considered

- **One distributed transaction (XA / two-phase commit) across the three services.** Rejected: it
  buys atomicity for a rare admin operation at the cost of the context independence SEAM-001 exists
  to establish, and it would make every pack install a coordinated availability dependency between
  the catalogue, the ledger and the job plane.
- **The CLI writes the three databases directly.** Rejected outright: it would put schema knowledge
  of three bounded contexts into a terminal client and make the compensation logic live where no
  other caller could reuse it. The service owns its schema.
- **Server-side YAML parsing, with the CLI shipping the directory.** Rejected: `orazaka pack
  validate --offline` must work while authoring a pack, before any platform is running. Splitting
  shape (client) from semantics (server) gives the author fast feedback and still leaves the
  authoritative check on the side that will actually store the rows.
- **Keeping the seeds and adding bundles alongside.** Rejected: two sources of truth for the same
  three Studios, differing silently the first time one is edited — and the seed would remain the
  path that is actually exercised, leaving the installer unproven exactly where it matters.
- **`orazaka pack publish` flipping status on an installed pack.** Rejected: publication is declared
  in the manifest, so a `publish` that mutated rows would let the artefact on disk and the rows in
  the catalogue disagree about what was published. `publish` installs a bundle whose Studios already
  declare `PUBLISHED`, and refuses one that does not.
