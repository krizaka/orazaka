---
description: PACKS — PHASED IMPLEMENTATION (phase 1 = the catalogue split, structure before content)
---

# Workflow: Implement the Pack catalogue (categories, packs, pack↔studio)

Design intent: [`docs/PACK_CATALOGUE_ARCHITECTURE.md`](../../docs/PACK_CATALOGUE_ARCHITECTURE.md).
**That design document is normative for *what* and *why*. This workflow is normative for *how* and
*in what order*. Where they disagree, the design document wins and this file is corrected.**

> **Read this before anything else.** ~70% of the Pack feature already exists and runs:
> `billing_pack` (with `category`), `billing_pack_entitlement`, `billing_pack_subscription`,
> `PackController`, `PackSubscriptionController`, `PacksScreen.tsx`, `PackEditor.tsx`,
> `/packs` + `PackMarketplace.tsx`. **This is not a greenfield build. It is a refactor of a live
> feature plus three packs of content.** Every instinct to create a parallel structure is wrong;
> find the existing one and move it.

## §0 Init

1. Load `AGENTS.md` — §0, §2 (tiers), §3 (naming), §4 (config vs data), §5 (own DB, no cross-context
   FK), §8 (frontend), §9 (testing) all bind this work.
2. Load `.agent/rules/naming_conventions.md`, `configuration_standards.md`, `testing_standards.md`,
   `ui_standards.md`.
3. Read `docs/PACK_CATALOGUE_ARCHITECTURE.md` §1 (the four layers), §2 (what exists), §3 (the
   decision), §4 (target model + invariants), §7 (plan), §8 (manifest).
4. Read `docs/STUDIO_ARCHITECTURE.md` §5 and `infra/initdb/80-studio.sql` — the new tables live
   **beside** `studio`/`studio_i18n` and must match their shape exactly.
5. **Inventory before you edit.** Run a search for every reader of the three columns you are about
   to delete (`billing_pack.label`, `.category`, `.profession`) across Java, TypeScript and SQL, and
   write the list into your plan. A missed reader is a compile error at best and a blank marketplace
   card at worst.

## §1 Scope of THIS run — phases 1 + 2 only

Phases 1 and 2 are **the catalogue split and the invariants that make it safe**. They ship together
because phase 2 is the guard on phase 1: moving presentation data out of billing without the
coherence fitness function leaves the door open to a pack that a user pays for and cannot use.

**In scope** — exactly the file manifest of §3: schema, Tier-1 contract, studio-service catalogue
read path, billing narrowing, the four invariants, the fitness functions, and the **minimum** UI
change to keep `/packs` and the admin editor working.

**Out of scope, do NOT start** — the `prospection`, `document-validation` and `wellbeing` packs
(phases 3, 5, 7); the enriched admin console (phase 4); the `RULESET` step kind and
`orazaka.core.document.validate` (phase 5); `regulatory_class` **enforcement** — the column is added
now, the seven controls behind it are phase 6. If phases 1–2 are green and you have budget left,
**stop and report**.

> `regulatory_class` is added in phase 1 as a column with a `CHECK`, defaulting to `STANDARD`, and
> nothing reads it yet. That is deliberate: adding a column later to a table with three packs of
> content is a migration; adding it now is a line. Do **not** implement its behaviour.

## §2 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | 100% local. No CI, no cloud, no new network dependency. |
| AGENTS.md §5 — no cross-context FK | `pack.pack_key` (studio DB) and `billing_pack.pack_key` (billing DB) are **the same string in two databases with no FK between them**. `SqlBoundaryRules` [SEAM-001] fails the build on any `REFERENCES` crossing a file. |
| AGENTS.md §5 — same-file references only | Inside `80-studio.sql`, `pack_studio` may reference `pack` and `studio` because all three live in that file. That is legal and required. |
| AGENTS.md §4 — config vs data | Categories, packs, labels, taglines are **rows**. Not one of them appears in an `application.yml` or a TypeScript constant. |
| AGENTS.md §2 — tier purity | `Pack`, `PackCategory`, `RegulatoryClass` go in Tier-1 `orazaka-studio-api`: pure JDK + JUnit, no Spring, no Jackson, no JPA. |
| AGENTS.md §3 [ERR-128] | `PackCatalogController` — a resource controller. Not `MarketplaceController`, not `CatalogueFacade`. |
| AGENTS.md §3 [ERR-129] | `PackCatalogService` in `application/service`. No `*Manager`, `*Orchestrator`, `*Handler`. |
| AGENTS.md §8 | UI changes stay under `orazaka-apps/ui/`, BFF-only, types from `orazaka-shared`, ≤250 lines per `.tsx`, design-system components, no inline hex. |
| ERR-103 | One top-level type per `.java` file **+ one mirroring test file**. |
| ERR-106/116 | Records validate in the **compact constructor**. The §4 invariants live in the type, not in a service guard. |
| **Behaviour preservation** | At the end of this run, `/packs` and the admin editor must do exactly what they do today — with richer data behind them. If a user-visible behaviour changes, you have gone too far. |

## §3 File manifest — phases 1 + 2

```
# ── schema ─────────────────────────────────────────────────────────────────
MODIFY  infra/initdb/80-studio.sql     (+ pack_category, pack_category_i18n, pack, pack_i18n,
                                          pack_studio, indexes, seeds; see §4)
MODIFY  infra/initdb/70-billing.sql    (− label, category, profession from billing_pack;
                                          − ck_pack_category; − idx_pack_browse;
                                          rewrite the category comment block, see §4.3)
MODIFY  infra/initdb/00-reset.sql      (nothing to add — verify the studio drop block still covers
                                          the new tables, they are in the same database)

# ── Tier-1 contract ────────────────────────────────────────────────────────
CREATE  orazaka-apps/services/orazaka-studio/orazaka-studio-api/.../domain/model/PackCategory.java
CREATE  .../domain/model/Pack.java
CREATE  .../domain/model/PackSummary.java          (the browse projection: pack + category + studios + price)
CREATE  .../domain/model/RegulatoryClass.java      (enum STANDARD | SENSITIVE | REGULATED)
CREATE  .../domain/model/PackStatus.java           (enum DRAFT | PUBLISHED | WITHDRAWN)
CREATE  .../domain/port/PackCatalogClient.java
CREATE  .../src/test/java/.../{Pack,PackCategory,PackSummary}Test.java

# ── studio-service: the catalogue read path ────────────────────────────────
CREATE  orazaka-apps/services/orazaka-studio/orazaka-studio-service/.../application/service/PackCatalogService.java
CREATE  .../infrastructure/adapter/rest/PackCatalogController.java        (/api/v1/studios/packs)
CREATE  .../infrastructure/adapter/rest/dto/{PackSummaryResponse,PackDetailResponse,PackCategoryResponse}.java
CREATE  .../infrastructure/adapter/persistence/JdbcPackRepositoryAdapter.java
CREATE  .../domain/port/PackRepository.java

# ── price, read across the context boundary ────────────────────────────────
CREATE  orazaka-apps/services/orazaka-billing/orazaka-billing-client/.../HttpPackPricingClient.java
CREATE  orazaka-apps/services/orazaka-billing/orazaka-billing-client/.../NoOpPackPricingClient.java
CREATE  orazaka-apps/services/orazaka-billing/orazaka-billing-api/.../domain/port/PackPricingClient.java
CREATE  orazaka-apps/services/orazaka-billing/orazaka-billing-api/.../domain/model/PackPrice.java
MODIFY  orazaka-apps/services/orazaka-billing/orazaka-billing-client/.../BillingClientAutoConfiguration.java

# ── billing: narrow ────────────────────────────────────────────────────────
MODIFY  orazaka-apps/services/orazaka-billing/orazaka-billing-service/.../domain/model/CatalogPack.java
MODIFY  .../application/service/PackCatalogService.java                   (rename → PackPricingService)
MODIFY  .../infrastructure/adapter/rest/PackController.java
MODIFY  .../infrastructure/adapter/rest/dto/*                             (whatever carries label/category)
DELETE  .../domain/model/PackCategory.java                                (if the enum exists — §4.3)

# ── fitness functions (phase 2) ────────────────────────────────────────────
MODIFY  orazaka-libs/orazaka-build/orazaka-test-support/.../architecture/SqlBoundaryRules.java
CREATE  orazaka-libs/orazaka-build/orazaka-test-support/.../architecture/PackCoherenceRules.java
MODIFY  orazaka-libs/orazaka-ai-engine/orazaka-persistence-app/src/test/.../SqlBoundaryTest.java
CREATE  orazaka-apps/services/orazaka-studio/orazaka-studio-service/src/test/.../PackCatalogIT.java

# ── UI: the minimum to keep today's behaviour ──────────────────────────────
MODIFY  orazaka-apps/ui/orazaka-ui-kit/orazaka-shared/src/schemas/pack.ts  (+ index.ts)
MODIFY  orazaka-apps/ui/orazaka-web-client/src/features/billing/components/PackMarketplace.tsx
MODIFY  orazaka-apps/ui/orazaka-web-admin/src/features/billing/components/{PacksScreen,PackEditor}.tsx
MODIFY  orazaka-apps/ui/orazaka-web-client/src/services/*.api.ts           (the pack calls)
MODIFY  orazaka-apps/services/orazaka-edge/src/main/resources/application.yml  (verify /api/v1/studios covers the new path)

# ── decision record ────────────────────────────────────────────────────────
CREATE  docs/adr/ADR-036-pack-catalogue-and-regulatory-class.md
```

## §4 The schema work, specified

### §4.1 `80-studio.sql` — the new tables

Write them **exactly as `docs/PACK_CATALOGUE_ARCHITECTURE.md` §4 specifies**, placed immediately
before the `studio` table (a pack is browsed before a studio is installed; keep the file readable
top-down). Match the house style of the surrounding tables: a comment block above each explaining
*why* it exists, opaque-id notes where a column crosses a context.

Indexes: `idx_pack_browse ON pack(category_key, sort_weight DESC) WHERE status = 'PUBLISHED'` and
`idx_pack_studio_studio ON pack_studio(studio_key)` — the second one matters because "which packs
grant this Studio?" is the query the lock-notice UI runs.

### §4.2 Seeds — one pack, two categories, nothing more

Idempotent, `ON CONFLICT … DO NOTHING`:

1. **`pack_category`** — `business` (icon `briefcase`, weight 100) and `lifestyle` (icon `heart`,
   weight 90). Both active.
2. **`pack_category_i18n`** — `fr` + `en` for both. `business` → *"Business"* / *"Business"*;
   `lifestyle` → *"Life Style"* / *"Life Style"*, each with a one-line description.
3. **`pack`** — migrate the single existing pack: `realestate-studio`, `category_key = 'business'`,
   `icon_key = 'studio'`, `regulatory_class = 'STANDARD'`, `status = 'PUBLISHED'`.
4. **`pack_i18n`** — `fr` + `en` for `realestate-studio`, taking the label from the row you are
   deleting in `70-billing.sql` so nothing is lost.
5. **`pack_studio`** — `('realestate-studio', 'realestate-reels', 100)`. This is the row that makes
   invariant #3 checkable, and today it is the only one.

**Do not seed the three new packs.** They are phases 3, 5 and 7.

### §4.3 `70-billing.sql` — narrow, and fix the comment that now lies

Drop `label`, `category`, `profession`, the `ck_pack_category` constraint and `idx_pack_browse` from
`billing_pack`. Update the seed insert accordingly. `billing_pack` becomes:
`pack_key · price_cents · included_credits · external_plan_code · is_active`.

The comment block above the table currently argues that the category is a `CHECK` rather than a
catalogue table, on the grounds that *"a shelf nobody can name in the front-end is a shelf nobody
browses."* **That reasoning was right and its conclusion is now wrong** — the shelf gained a French
label, an icon and a sort order, which is exactly what makes it nameable. Rewrite the block to say
where the category went and why. Do not delete it silently: a future reader will otherwise re-derive
the same wrong conclusion.

If `PackCategory` exists as a Java enum in the billing service, delete it there and create it in
`orazaka-studio-api`. Two enums for one concept is the drift this whole exercise removes.

### §4.4 Price across the boundary

The browse page needs `price_cents`, which lives in billing. **Do not duplicate the price into the
studio database** — a stale price is a billing dispute.

Use the pattern the codebase already established for entitlements: a Tier-1 port
(`PackPricingClient`) in `orazaka-billing-api`, an HTTP adapter and a `NoOp` fallback in
`orazaka-billing-client`, wired by `BillingClientAutoConfiguration`. Copy `HttpEntitlementProvider`
and `NoOpEntitlementProvider` — same timeouts, same caching discipline, same degraded behaviour.

**Degrade, never fail.** One call for the whole catalogue (`prices(Set<String> packKeys)`), not one
per pack — `StudioAccessService.evaluateAll` already sets that precedent and says why in its javadoc.
If billing is unreachable, return the catalogue with prices absent and let the UI render "—". A
marketing page that 500s because the billing service is restarting is a self-inflicted outage.

## §5 The four invariants and how each is enforced

From design §4. Each needs a *mechanism*, not a comment.

| # | Invariant | Enforced by |
|:--:|:---|:---|
| 1 | A `PUBLISHED` pack has ≥1 `pack_studio` row | `Pack` compact constructor (when the studio list is loaded) **+** `PackCoherenceRules` over the seed files |
| 2 | Every Studio in a `PUBLISHED` pack is itself `PUBLISHED` | `PackCoherenceRules` (static, over `80-studio.sql`) **+** `PackCatalogIT` |
| 3 | Every `pack_studio` row implies a `billing_pack_entitlement` row granting that Studio's `entitlement_key` | **`PackCoherenceRules`** — see the note below |
| 4 | `regulatory_class` is one of three values | SQL `CHECK` **+** the `RegulatoryClass` enum |

> **Invariant #3 is cross-context and that is exactly why it needs a static check.** No ArchUnit rule
> can see it — it is a relation between rows in two *different databases*, joined only by an opaque
> string. An integration test cannot see it either without connecting to both. So enforce it where
> both facts are visible at build time: **the seed files**. `PackCoherenceRules` parses
> `pack_studio` + `studio` from `80-studio.sql` and `billing_pack_entitlement` from `70-billing.sql`,
> and fails when a `(pack, studio)` pair has no matching entitlement row.
>
> Model it on `SqlBoundaryRules`, which already parses these files for [SEAM-001] — reuse its
> `SourceFileScanner`, do not write a second SQL reader.
>
> This is the single most likely production defect in the whole feature: **a user pays for a pack and
> stays locked out**, because the entitlement row was forgotten. It is silent, it looks like a
> billing bug, and it burns the exact customer who just gave you money.

## §6 Acceptance gate — run these, in order

```bash
# 1. Contract + service compile, all tests pass, including the new IT and coherence rules
./mvnw -q verify

# 2. Every governance suite, including the new PackCoherenceRules wiring
./mvnw -q test -Dtest='*GovernanceTest'
./mvnw -q -pl orazaka-libs/orazaka-ai-engine/orazaka-persistence-app -Dtest=SqlBoundaryTest test

# 3. The stack comes up on the migrated schema
orazaka stop --purge && orazaka start && orazaka dev

# 4. The catalogue reads, in French, with a category and an icon
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8088/api/v1/studios/packs?locale=fr" | jq
# expect: realestate-studio, categoryKey=business, label FR, iconKey, studios[realestate-reels], priceCents

# 5. Billing still prices it, and no longer pretends to describe it
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8088/api/v1/billing/packs | jq
# expect: pack_key + price + entitlements. NO label, NO category, NO profession.

# 6. The two user-visible surfaces still behave exactly as before
#    /packs renders the pack, "Add to my space" still works, admin editor still saves
npm --workspace orazaka-web-client run test
npm --workspace orazaka-web-admin run test

# 7. Invariant #3 actually bites. Temporarily delete the
#    ('realestate-studio','studio.realestate-reels') row from 70-billing.sql and re-run:
./mvnw -q -pl orazaka-libs/orazaka-ai-engine/orazaka-persistence-app -Dtest=SqlBoundaryTest test
#    MUST FAIL with a message naming the pack and the studio. Restore the row afterwards.

# 8. Nothing regressed end to end
orazaka test e2e
```

Phases 1–2 are done when **all eight** pass. Step 7 failing is the **success** condition — if it
passes with the entitlement row deleted, the fitness function is decorative and invariant #3 is
unguarded.

## §7 Do NOT

- **Do not** create a parallel pack structure. Every piece listed in the design §2 table as ✅
  exists — find it, move it, narrow it.
- **Do not** start the prospection, validation or wellbeing packs, the `RULESET` step kind, the
  document-validation capability, or the enriched admin console.
- **Do not** implement any `regulatory_class` behaviour. The column exists; nothing reads it.
- **Do not** copy `price_cents` into the studio database.
- **Do not** call billing once per pack. One call for the catalogue.
- **Do not** let the catalogue endpoint fail when billing is down — degrade.
- **Do not** add a foreign key between `pack` and `billing_pack`. Different databases.
- **Do not** leave the `70-billing.sql` category comment contradicting the new design.
- **Do not** change what `/packs` or the admin editor *do*. Only what feeds them.
- **Do not** touch the user's uncommitted working-tree changes.
- **Do not** commit or push — the user reviews the diff and commits.
- **Do not** modify `docs/_generated/*` by hand.

## §8 Before declaring done

1. Run the `.agent/workflows/review_architect.md` gate.
2. `initdb` and interfaces changed ⇒ run `.agent/workflows/sync_documentation.md`.
3. Write **`docs/adr/ADR-036-pack-catalogue-and-regulatory-class.md`**: the split (billing = price and
   grant, catalogue = identity and content), why the category became a table after the original
   comment argued for a `CHECK`, why invariant #3 is a static seed-file rule rather than a runtime
   one, and why `regulatory_class` is introduced now with no behaviour attached. Name the rejected
   options — enriching billing, and a third "catalogue" context — with the reason each was rejected.
4. Update `docs/PACK_CATALOGUE_ARCHITECTURE.md` §2: move the two structural gaps to ✅ with the
   commit ref. Do not delete the rows.
5. Report: files created/modified, the eight gate results verbatim, the **inventory from §0.5** of
   every reader of the deleted columns and how each was handled, and **any place where the design
   turned out to be wrong**. A wrong design is a document bug to fix, not a detail to absorb silently.

## §9 Next phases (do not start without an explicit go)

Per design §7.

- **Phase 3 — Prospection pack.** `prospection` pack row, two new blueprints (`lead-research`,
  `followup-sequences`) over **existing** capabilities, `pack_studio` rows, entitlements, i18n.
  Ship this first among the content phases precisely because it needs no new capability.
- **Phase 4 — Admin console.** Category picker, i18n editor, Studio multi-select, live entitlement
  preview, publish gate. Target: an admin creates a pack end-to-end with zero SQL.
- **Phase 5 — Validation pack.** `orazaka.core.document.validate` capability + strategy, the
  `RULESET` step kind, `validation_ruleset`/`validation_rule`, three blueprints. Findings are
  structured `(rule_id, severity, verdict, evidence_span, explanation)` — never prose.
- **Phase 6 — `regulatory_class` enforcement.** The seven controls of design §6.2: consent gate,
  non-bypassable `SafetyInterceptor`, scope guard, sensitive data class, shortened retention,
  append-only audit trail, publish gate.
- **Phase 7 — Wellbeing pack.** Three blueprints, `REGULATED`, regional crisis resources, safety
  review recorded. **Gated on phase 6 and on audit finding #13 (encryption at rest)** — for this pack
  that finding is a blocker, not a hardening item.
