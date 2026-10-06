---
title: "ADR-048 — Optional in the published schema means optional in the type"
description: "Four fields pack.schema.json calls optional could not be omitted, because the records receiving them used primitives; an external author following the published contract got a 400 with no message."
category: ADR
order: 48
---

# ADR-048 — Optional in the published schema means optional in the type

- **Status**: Accepted
- **Date**: 2026-09-03
- **Scope**: `products/orazaka` — `PackPricing`, `PackStudio`, `PackCatalogEntry`,
  `PackCategorySeed`, `PackCapability` (Tier-1 `orazaka-studio-api`), `CapabilityDeclaration`
  (Tier-1 `orazaka-jobs-api`), `CapabilityEntity`, `infra/initdb/30-jobs-config.sql`
- **Found by**: [ADR-049](ADR-049-open-core-split.md)'s acceptance criterion

## Context

`pack.schema.json` is the published contract an external pack author writes against. It declares
several fields optional, most with a stated default. The records that receive them declared those
same fields as **primitives**, which cannot express absence.

An author who omitted an optional field got:

```
HttpMessageNotReadableException: Cannot map `null` into type `boolean`
→ 400 Bad Request, no message
```

Five fields, found one at a time by installing a pack from outside the repository:

| field | schema | contract | result |
|:---|:---|:---|:---|
| `pricing.isActive` | optional, default `true` | `boolean` | 400, unparseable |
| `catalog.sortWeight` | optional, default `0` | `int` | 400 |
| `studio.sortWeight` | optional, default `0` | `int` | 400 |
| `capability.enabled` | optional, default `true` | `boolean` | 400 |
| `capability.httpMethod` | optional, default `POST` | non-null column | **500** |

And one that was not about primitives at all: `orazaka_capabilities.uri_path` was `NOT NULL` while
every contract describing it said *"the endpoint that submits it, `null` when it has none"*. A
Tier-W pack — whose work is submitted over AMQP and nothing else — is the first thing that ever had
to have none, and it got a 500.

## Decision

**The default lives in the compact constructor of the record that owns the field**, once.

```java
public PackPricing {
  isActive = isActive == null || isActive;   // schema says default true
  …
}
```

Boxed components where the schema says optional; `uri_path` made nullable in the entity, the DDL
and a migration. The schema's declared default and the type's default are now the same statement in
two places rather than two statements that disagree.

**Why not `FAIL_ON_NULL_FOR_PRIMITIVES=false`.** It is one line and it fixes all five at once — by
turning *every* missing primitive anywhere in the platform into a silent zero, including ones that
should be errors. The failure mode this ADR is about is a contract disagreeing with itself; the
repair must be in the contract, not in a global parser setting that hides the next disagreement.

## Consequences

- An external pack that omits an optional field installs. That is the whole point: the published
  schema is the contract, and a contract the receiver cannot honour is not published, it is
  advertised.
- **This was found by writing a pack as an outsider, not by reading the code.** Every one of the
  six is invisible from inside the repository, because every bundle in `orazaka-packs/` fills in
  every optional field. A reference pack that exercises only the happy path documents nothing.
- The nullable `uri_path` is a genuine widening: a capability with no synchronous surface is now
  representable, which is what Tier-C and Tier-W packs are made of.
