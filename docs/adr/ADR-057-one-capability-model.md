---
title: "ADR-057 — One capability model: the duplication that cost was an invariant, not a record"
description: "Six representations of 'capability', four legitimate. CapabilityDto was CapabilityDeclaration minus its invariants. But collapsing it would have fixed none of the four sites where the endpoint rule had drifted — which is the finding."
category: ADR
order: 57
---

# ADR-057 — One capability model

- **Status**: Accepted
- **Date**: 2026-09-11
- **Scope**: `CapabilityDto` (removed), `CapabilityDeclaration`, `PackCapability`,
  `CapabilityEntity`, `GovernanceRules` — rules `[CAP-001]` and `[CAP-002]`
- **Closes**: the capability half of audit findings #9–#11

## 1. The inventory, before any refactor

Six types model "capability". Field lists, compared exactly:

| Type | Fields | Validates | Verdict |
|:---|:--:|:---|:---|
| `CapabilityDeclaration` (jobs-api, Tier-1) | 11 | featureKey pattern, routingKey pattern, handlerKey | **the source** |
| `CapabilityDto` (persistence-app-api, Tier-1) | 11 — *identical names, identical types* | **nothing** | **redundant** |
| `CapabilityEntity` (JPA) | 11 | — | legitimate: an `@Entity` cannot be a record |
| `PackCapability` (studio-api, Tier-1) | 10, differently named | key pattern, routingKey, handlerKey | legitimate: a manifest grammar a third party writes, versioned by `apiVersion` |
| `CapabilityRoute` (jobs-api) | 4 | — | legitimate: the dispatcher's projection |
| `CapabilityDescriptor` (core) | 6 | label, icon | legitimate: the engine's projection, deliberately without routing or billing |

**Four of the six are legitimately distinct**, and the reasons are different in each case: an ORM
mapping, a versioned wire grammar a third party writes, and two narrow projections that withhold on
purpose — the cognitive engine has no business knowing a routing key, and the dispatcher has no
business knowing a label.

**One is a duplicate, and it is the worst possible one.** `CapabilityDto` was
`CapabilityDeclaration` again — eleven components, the same names in the same order — with **no
invariants at all**. The job service converted between them field by field in two mirror methods,
and the copy that continued to the database was the one that had dropped every check on the way.

Evidence that this was not theoretical: collapsing the two broke four persistence tests that had
been passing `"k"` and `"a.b"` as feature keys. The unvalidated copy accepted shapes the real
contract forbids, and the tests had been written against it.

## 2. But the duplication that cost money was an invariant, not a record

`CapabilityDto` never cost a production failure. What did was the rule **"both halves of an
endpoint, or neither"**, which was written four times:

| Where | What it said | Found |
|:---|:---|:---|
| `PackCapability` | default `httpMethod` to `POST` | ADR-054 — the whole conversation service failed on every request |
| `CapabilityDeclaration` | default `httpMethod` to `POST` | ADR-056 — pack install refused |
| `CapabilityEntity` | `nullable = false` | ADR-056 — Hibernate refused the insert |
| the table's CHECK | both or neither | added by ADR-054 |

Three of the four were wrong, each was found separately across three phases, and **each was found
only when something tried to register a broker-routed capability through it.**

**Collapsing `CapabilityDto` would have fixed none of them** — it held no opinion about endpoints
at all. The merge and the invariant are two different repairs, and only the second one was ever
costing anything. That is the reason this ADR leads with the invariant rather than with a count of
duplicated lines: the line count pointed at the wrong thing.

`CapabilityDeclaration.requireWholeEndpoint` and `defaultHttpMethod` are now the only authors of
that rule. `PackCapability` calls them. `CapabilityEntity` calls them from `@PrePersist` /
`@PreUpdate`, because a managed instance can reach the database without passing through any record
at all — which is precisely how its mapping came to disagree.

**The database's CHECK stays.** It is the same rule in a different system, and it is what catches a
writer that never passed through Java. Two guards for one rule is not duplication when they fail
independently; four opinions in one language was.

## 3. The rules

**`[CAP-001]`** fires on a new type that carries the capability's *whole shape* — six or more of
its ten fields — outside the five permitted. It reads a **declaration**: a record's component list,
or a class's own `private` fields. A mapper names every field because copying them is its job, and
flagging it would fire the rule on exactly the code that keeps the permitted models in step. The
rule is about a sixth **copy**, not a fifth **view**.

**`[CAP-002]`** fires on a type that restates the endpoint rule — a `"POST"` default of its own
beside a `uriPath`, or a `nullable = false` on `http_method`.

Both were confirmed to bite: planting an eight-field `CapabilitySummary` fails `[CAP-001]` by name,
and restoring `PackCapability`'s own `"POST"` default fails `[CAP-002]` by name.

## 4. What this does not do

The service-kit — `SecurityConfig` ×5, `MessageDedupService` ×5, `DataSourceConfig` ×5,
`AmqpConstants` ×4, `OutboxRelay` ×4 — is a separate question and is not addressed here. The
argument for it is the same shape as §2's and stronger: a security fix has to land once rather than
five times, which `/internal/v1` demonstrated when it did not. It deserves its own run and its own
inventory, done the same way — by asking which copies are the same thing and which are legitimately
different, before counting anything.
