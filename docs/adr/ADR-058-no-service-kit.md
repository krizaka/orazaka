---
title: "ADR-058 — No service kit: seven families, four rules, and three live bugs the inventory found"
description: "Asking each family what invariant it carries and how many authors it has, instead of counting copies. Two families had an invariant no author held. The conclusion is not a shared module."
category: ADR
order: 58
---

# ADR-058 — No service kit

- **Status**: Accepted
- **Date**: 2026-09-11
- **Scope**: `MessageDedupService` (×5 + contract), `OutboxRelay`, `SecurityConfig` ×2,
  `GovernanceRules` — rules `[KIT-001]`…`[KIT-004]`
- **Method from**: [ADR-057](ADR-057-one-capability-model.md) — count authors of an invariant, not
  copies of a type

## 1. The conclusion first: no kit

Seven families were named. **None of them should become a shared module**, and the deciding fact is
measurable: the only dependency all six services share today is `orazaka-test-support`, which is
test-scoped. **There is no shared production module.** Every consolidation of a *type* would
therefore create one — a permanent per-service dependency, forever — to hold invariants that are
each one or two lines.

What these families need is a single **author for the rule**. For five of the seven that author is
a governance rule, which costs nothing and catches the only failure that matters.

## 2. The inventory

| Family | The invariant, in one sentence | Authors | Diverging today | Outcome |
|:---|:---|:--:|:---|:---|
| `MessageDedupService` | a message seen twice is processed once, **and one whose processing failed is seen again** | 5 | **yes — none held it** | consolidate the author |
| `OutboxRelay` | an outbox row is published once | 4 | **yes — 1 of 4** | consolidate the author |
| `SecurityConfig` | which paths are open, which require SERVICE, which require a user | 6 | **yes — 2 of 6** | consolidate the author |
| `SessionJwtProperties` | the HS256 session secret is at least 32 characters | 5 | no (byte-identical) | rule, not a module |
| `DataSourceConfig` | a pool of 5, min idle 1, Postgres driver | 5 | no | legitimate: each context owns its database, and only the construction repeats |
| `AmqpConstants` | the three shared exchange names | 5 | no | mixed: exchanges shared, queue names legitimately local |
| `AmqpConfiguration` | every queue is durable and dead-letters to `orazaka.dlx` | 4 | no | legitimate: each declares its own queues |

## 3. The three live bugs

**`MessageDedupService` — four authors, and none of them held the invariant.**

Three services implemented it as `SELECT EXISTS` followed, later, by `INSERT`. Check-then-act: two
concurrent deliveries of one message both read *"not present"* and both proceed — under the exact
condition dedup exists for, because at-least-once redelivery *overlaps* a slow first attempt rather
than following it. The shared contract in `persistence-app-api` declared that racy shape, so it was
the contract teaching the mistake.

The fourth, studio-service, claimed atomically — and never released. A handler that threw left its
claim committed, the nack redelivered, and the redelivery was refused by the failed attempt's own
row. It traded a double-process for a **silent loss**.

So the invariant has two halves and the copies split them: three held neither, one held the first
and broke the second. The contract now declares both — `claim` by `INSERT`, letting the unique
constraint arbitrate, and `release` on failure — and all five implementations and nine listeners
follow it.

**`OutboxRelay` — studio-service published without claiming.** Three of four select with
`FOR UPDATE SKIP LOCKED`. Studio selected pending rows with no lock, published, and only then
marked. A second instance reading between the select and the mark publishes the same row again. It
had never bitten because there is one instance — which is the kind of correctness that expires the
day something is scaled.

**`SecurityConfig` — two of six diverged.** Measured, as asked:

| Rule | Applied by | Missing from |
|:---|:--:|:---|
| `OPTIONS /**` → permitAll (CORS preflight) | 5 of 6 | **identity-service** |
| `/error` → permitAll | 5 of 6 | **identity-service** |
| `/actuator/info` → permitAll | 5 of 6 | **conversation-service** |
| `/internal/v1/**` → `SERVICE` | 4 of 4 that expose it | — |

**The rule that had been fixed by hand five times is the one that is consistent.** The rules nobody
thought about are the ones that drifted. That is the same shape as the endpoint invariant of
ADR-057, and it is the argument for a rule rather than a review: attention does not scale, and it
does not persist.

An identity service that answers a CORS preflight with `401` breaks every browser call to it, and
one that requires authentication for `/error` turns every failure into a second, misleading one.

## 4. Why rules and not a module

`SessionJwtProperties` is the clearest case for a module — byte-identical five times, carrying a
real security minimum. It is also the clearest case against one: consolidating it means a new
Tier-2 artifact, five new dependency declarations and a permanent coupling, to hold **ten lines**.
The failure it would prevent is one copy relaxing the minimum while the others do not, and
`[KIT-004]` prevents exactly that for nothing.

The same reasoning acquits `DataSourceConfig`. Five copies, functionally identical — and the part
that differs is the part that matters: each context owns its own database, its own credentials and
its own properties type. It is `CapabilityEntity` again. Sharing the Hikari construction would
couple five services to save four lines each.

`AmqpConstants` and `AmqpConfiguration` are mixed and stay: the three shared exchange names are
already named in `MessagingContract`, and each service's own queues are legitimately its own.

## 5. The rules

- **`[KIT-001]`** — every `SecurityConfig` declares the CORS preflight exemption, `/error`,
  `/actuator/health`, and `SERVICE` on `/internal/v1`.
- **`[KIT-002]`** — dedup claims atomically and offers a release; no `SELECT EXISTS`, no
  `isDuplicate`.
- **`[KIT-003]`** — a relay that selects pending outbox rows claims them with `SKIP LOCKED`.
- **`[KIT-004]`** — every copy of `SessionJwtProperties` enforces the same 32-character minimum.

Each was confirmed to fire by name: removing identity-service's preflight fails `[KIT-001]`,
removing studio's `SKIP LOCKED` fails `[KIT-003]`, and relaxing billing's minimum to 8 characters
fails `[KIT-004]`.

`[KIT-002]` had to learn to read code rather than prose — it first fired on the javadoc explaining
the shape these classes used to have. Naming a defect in order to record it is not committing it,
which is the second time a source-scanning rule has needed that distinction.
