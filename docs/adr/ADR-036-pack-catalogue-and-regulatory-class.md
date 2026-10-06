---
title: "ADR-036 — Pack catalogue and regulatory class"
description: "Why the Pack catalogue moved out of billing into the studio context, why the category became a table after a comment argued for a CHECK, why the pack↔entitlement invariant is a seed-file rule rather than a runtime one, and why regulatory_class is introduced with no behaviour attached."
category: ADR
order: 36
---

# ADR-036 — Pack catalogue and regulatory class

- **Status**: Accepted
- **Date**: 2026-08-27
- **Scope**: `products/orazaka` — `infra/initdb/70-billing.sql` and `80-studio.sql`;
  `orazaka-studio-api` (`Pack`, `PackCategory`, `PackSummary`, `PackStatus`, `RegulatoryClass`,
  `PackCatalogClient`); `orazaka-billing-api` (`PackPrice`, `PackPricingClient`);
  `orazaka-billing-client`; the Pack read path in `orazaka-studio-service`; `PackController` and
  `PackPricingService` in `orazaka-billing-service`; `PackCoherenceRules` in `orazaka-test-support`;
  the `/packs` marketplace and the admin pack screen.
- **Supersedes**: the rationale recorded inline above `billing_pack` in `70-billing.sql` and in the
  javadoc of the deleted `com.orazaka.billingservice.domain.model.PackCategory`.
- **Implements**: `docs/PACK_CATALOGUE_ARCHITECTURE.md` §3, §4 — phases 1 and 2.

## Context

`billing_pack` carried `label`, `category` and `profession`: presentation data inside the money
context. The Studio context next door already had `studio_i18n`, `icon_key`, `tagline` and
`hero_asset_id`.

The consequence was visible with one pack seeded and would have become structural with four: a Pack
card in the marketplace is poorer than a Studio card. No icon, no description, no French label. The
reflex fix — add `icon_key`, `tagline`, `hero_asset_id` and a `billing_pack_i18n` table to the
billing database — produces **two divergent i18n tables** and a service that holds the credit ledger
and is also a CMS, in which every marketing copy change is a deploy of the ledger.

## Decision

**Split the Pack by the question each half answers.**

> Billing answers *what does it cost and what does it grant*.
> The catalogue answers *what is it and what does it do*.

- **Billing keeps** `pack_key`, `price_cents`, `included_credits`, `external_plan_code`,
  `is_active`, plus `billing_pack_entitlement` and `billing_pack_subscription`. Nothing a marketer
  edits.
- **The studio context gains** the catalogue: `pack`, `pack_i18n`, `pack_studio`, `pack_category`,
  `pack_category_i18n` — beside `studio_i18n`, so there is one i18n mechanism, one marketplace
  query and (from phase 4) one admin console.
- `pack_key` is an **opaque** string on both sides. No cross-context FK; [SEAM-001] holds.
- The **price is never copied** into the studio database. The catalogue reads it at render time
  through the Tier-1 `PackPricingClient`, one call for the whole page, and degrades to an absent
  price when billing is unreachable.

### Rejected alternatives

**Option A — enrich billing.** Faster this week and wrong by the third pack. The money service
accumulates marketing columns and a second i18n table, and every copy change deploys the ledger.
It also does not remove the drift it would create: two i18n tables mean two answers to "what is this
called".

**Option C — a third "catalogue" context.** Correct on paper, unjustifiable in practice: a service
whose only job is to join two tables. AGENTS.md §2 names a growing `orazaka-libs` as the primary
health gauge of this architecture; a growing service count is the same disease with a different
symptom. The catalogue belongs to whoever owns the thing being catalogued, and that is Studio.

Migration cost decided the timing rather than the choice: with one pack seeded the move is a
rewrite of five seed rows. It would not have been after three.

## Why the category became a table when a comment argued for a CHECK

The comment above `billing_pack` defended `CHECK (category IN ('BUSINESS','LIFESTYLE'))` explicitly:
a plan is a commercial offer an admin invents and must be a row, while *"a shelf nobody can name in
the front-end is a shelf nobody browses"*.

**That reasoning was right and it is what overturns the conclusion.** Naming the shelf is exactly
what a CHECK cannot do. The moment "Life Style" has to sit next to "Business" on a marketplace page,
the shelf needs a French label, an icon, a sort order and a description — four things a constraint
cannot carry. The old arrangement pushed all four into the client, where `PackCategorySchema` was a
closed TypeScript enum and `CATEGORY_LABELS` was a hardcoded French dictionary in a React component:
adding a shelf meant editing three files in two languages and inventing a translation nobody had
written.

`pack_category` + `pack_category_i18n` keeps the closed *spirit* — admin-only, ~5 rows ever, and
`PackCoherenceRules` fails the build if a `pack.category_key` resolves to nothing — and gains a
browsable, translatable shelf. The rewritten comment in `70-billing.sql` records this, rather than
deleting the old argument silently, because a future reader would otherwise re-derive it.

## Why invariant #3 is a seed-file rule, not a runtime one

The invariant: **every `pack_studio` row implies a `billing_pack_entitlement` row granting that
Studio's `entitlement_key`.**

It is the single most likely production defect in this feature. The user pays, the subscription row
is written, the entitlement union comes back without the Studio, and they stay locked out. It is
silent, it reads as a billing bug, and it burns the exact customer who just gave you money.

It also cannot be checked anywhere else:

- **Not by ArchUnit** — it is a relation between *rows*, not between classes.
- **Not by an integration test** — the two facts live in two different databases, and a test that
  connects to both re-creates the coupling AGENTS.md §5 exists to forbid.
- **Not by review** — a missing row is an absence, and absences are what review misses.

The one place both facts are visible at once is the pair of seed files, at build time, for free.
`PackCoherenceRules` [PACK-001] parses `pack`, `pack_studio`, `studio` and `pack_i18n` from
`80-studio.sql` and `billing_pack` / `billing_pack_entitlement` from `70-billing.sql`, and fails
naming the pack and the studio. It runs beside [SEAM-001] in `SqlBoundaryTest`, reusing the same SQL
reader rather than opening a second one.

Its limit is worth stating: it checks **seeded** data, not rows an admin creates at runtime. The
runtime half is the publish gate of phase 4, and the static rule is what keeps the shipped catalogue
correct until then.

The other three invariants are enforced where they are cheapest. #1 (a `PUBLISHED` pack bundles at
least one Studio) is a compact-constructor check in `Pack` **and** a seed-file rule, so neither a
constructed object nor a seeded row can violate it. #2 (every Studio in a published pack is itself
published) is a seed-file rule **and** a `PackCatalogIT` query against the real schema. #4 is a SQL
`CHECK` plus the `RegulatoryClass` enum.

## Why `regulatory_class` exists now with nothing reading it

`pack.regulatory_class` is added with a `CHECK`, defaults to `STANDARD`, and **no code branches on
it.** That is deliberate on three counts.

1. **Cost.** Adding the column to a table holding one row is a line. Adding it after three packs of
   content is a migration.
2. **Naming decides regulation.** A wellbeing pack is not architecturally harder than the others; it
   is legally harder, and the difference has to be expressed in the architecture rather than in a
   disclaimer. The seven controls it needs — consent gate, non-bypassable safety interceptor, scope
   guard, sensitive data class, shortened retention, append-only audit trail, publish gate — are
   phase 6, and they are switched by this column.
3. **Generalisation beats special-casing.** A legal-advice pack, a medical-summary pack and a
   financial-advice pack have the same shape. Building the classification once means the fourth such
   pack is a **row**, which is the promise the Studio architecture makes. Special-casing therapy
   means the fourth one is a rewrite under time pressure.

Introducing the value without its behaviour is the honest state to be in, and it is recorded here so
that "nothing reads it" is a decision rather than an omission someone later mistakes for a bug.

## Consequences

**Good.**

- Billing shrank to a price tag. `CatalogPack` has no `category()` to call — the split is enforced
  by the type system, not by convention.
- One i18n mechanism for Studios and Packs, in one context, with one admin console to come.
- A marketplace card now renders what a buyer actually buys — the Studios in the bundle — instead of
  raw entitlement keys, which were an implementation detail leaking onto a marketing page.
- Shelves are fetched and already localised. Adding one is a row plus its translations, with no
  deploy of the web client.
- The build fails on the defect that would otherwise reach a paying customer silently.

**Costs, accepted.**

- The marketplace now needs two services to render (catalogue + ownership) where it needed one. The
  price hop is one call per page, cached for a minute, and it **degrades**: an unreachable billing
  service costs the price, not the page. An absent price renders "—", never "free" — `null` and `0`
  are kept distinct end to end for exactly that reason.
- **The admin console lost the pack's name, category and métier fields**, because the data they
  edited moved to a context this console cannot yet write. The pack screen also stopped grouping by
  category. That is a real narrowing until phase 4 restores authoring against the catalogue; listing
  flat is the honest interim, since a grouping the screen cannot edit implies an authority it does
  not have. A pack's presentation is authored as a `pack` row until then.
- `pack` carries no base label — unlike `studio`, every string lives in `pack_i18n` — so "fall back
  to the base row" has no analogue. The read path falls back to the pack's lowest-sorting
  translation and, failing that, to the key itself. Rendering a raw key is ugly on purpose: an
  unlabelled pack must be visibly wrong rather than take a marketplace page down with a constructor
  failure. `PackCoherenceRules` makes it unreachable for seeded data.

## Related

- [Pack catalogue architecture](../PACK_CATALOGUE_ARCHITECTURE.md) — the design this implements
- [ADR-034](ADR-034-studio-marketplace.md) — the Studio catalogue whose shape this mirrors
- [ADR-033](ADR-033-credit-metering-and-billing.md) — the billing context this narrows
- [ADR-032](ADR-032-microservices-decomposition-strangler-fig.md) — the seam [SEAM-001] guards
