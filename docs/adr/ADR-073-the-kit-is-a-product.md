---
title: "ADR-073 — The kit is a product: cross-cutting code moves to com.krizaka, and the governance rules count authors of one"
description: "ADR-058 refused a service kit because a shared module would be a permanent coupling created to save ten lines. The premise changed: the shared code is now published, versioned open-source software that any application can take, so the coupling is a dependency on a product. krizaka-security and krizaka-messaging take the four families with one invariant and several authors; the families ADR-058 found legitimately local stay local; KIT-001…004 now fail on a seventh author instead of checking six."
category: ADR
order: 73
---

# ADR-073 — The kit is a product

- **Status**: Accepted
- **Date**: 2026-10-08
- **Supersedes in part**: [ADR-058](ADR-058-no-service-kit.md) §1 and §4 (the conclusion "no kit"); its inventory, its
  three bugs and its verdicts on `DataSourceConfig`, `AmqpConstants` and `AmqpConfiguration` stand.
- **Scope**: new repositories [`krizaka-build`](https://github.com/krizaka/krizaka-build) and
  [`krizaka-platform-kit`](https://github.com/krizaka/krizaka-platform-kit); `orazaka-parent`; every service's
  `SecurityConfig`, dedup and outbox relay; `GovernanceRules` `[KIT-001]`…`[KIT-004]`; Maven `groupId` `com.orazaka` →
  `com.krizaka.orazaka`.

## 1. What changed since ADR-058

ADR-058 asked the right question — *how many authors does this invariant have?* — and answered it with rules, because
the alternative was "a new Tier-2 artifact, five new dependency declarations and a permanent coupling, to hold ten
lines". That cost was real **for a module that only Orazaka would ever import**.

The premise is no longer true. Krizaka publishes its building blocks as open source: npm `@krizaka/*` already, Maven
Central `com.krizaka` now, so that any application — Orochia, a customer, a stranger — can take the users, notifications
or billing service and the code they stand on. A shared module stops being an internal coupling and becomes a
**dependency on a released, versioned, documented product**, with its own tests, its own changelog and one place where a
security fix lands. ADR-057 §4 had already said the argument for consolidation was "the same shape and stronger"; the
blocker was the cost of the module, and publishing it is what pays that cost.

## 2. What moved, and what did not

The test stays ADR-058's: one invariant, several authors, copies that drift. Only those families move.

| Family | Authors before | Now | Why |
|:---|:--:|:---|:---|
| Security baseline (`SecurityConfig` rules) | 6 | `SecurityBaseline.apply` (krizaka-security) | two of six had drifted; identity answered a preflight with 401 |
| `SessionJwtProperties` + decoder + roles converter | 5 | `SessionJwtAutoConfiguration` | byte-identical; carries the 256-bit minimum |
| `ServiceTokenProvider` | 7 | `com.krizaka.security.token.ServiceTokenProvider` | ADR-035 named this exact successor |
| `MessageDedupService` (×5 + a contract + a JPA impl) | 7 | `MessageDedup`, `JdbcMessageDedup`, `InMemoryMessageDedup` | none of the copies held both halves |
| `OutboxRelay` | 4 | `OutboxRelay` + `OutboxStore` SPI (krizaka-messaging) | one of four published without claiming |
| `DataSourceConfig` | 5 | **stays local** | each context owns its database (ADR-058 §4) |
| `AmqpConfiguration`, queue names | 5 | **stays local** | each service's queues are its own |
| `RestErrorResolver` | 2 | **stays local** | the two copies map different domain exceptions — no shared invariant |

The outbox split is deliberate: the **relay** (claim → publish → mark → back off → purge) is the invariant and has one
author; the **store** — table, payload format, back-off curve — is the context's, implemented over its own schema. The
claim lives in the store, so `[KIT-003]` keeps checking it there.

## 3. Bugs the extraction found

Moving code into a library with its own tests is a review; this one found three things.

- **A stateless service could not start with the kit.** `notification-service` has no JDBC on its classpath; a `@Bean`
  method whose signature named `JdbcTemplate` could not be introspected, so `store=memory` crashed at startup. The JDBC
  store now lives in a nested configuration guarded by `@ConditionalOnClass`, and a `FilteredClassLoader` test proves the
  memory store starts without JDBC.
- **Studio's relay claimed outside a transaction.** Its `drain()` was not `@Transactional`; the `FOR UPDATE SKIP LOCKED`
  it gained in ADR-058 locked rows for the duration of an auto-committed `SELECT`. The kit runs every batch in a
  `TransactionTemplate`.
- **`ServiceTokens` (test-support) had no caller.** It was written for an `InternalSurfaceAuthIT` that was never written.
  Deleted rather than published.

## 4. The rules now count authors of one

`[KIT-001]`…`[KIT-004]` checked that six copies agreed. They now fail on a seventh author:

- **`[KIT-001]`** every `SecurityConfig` calls `SecurityBaseline.apply`.
- **`[KIT-002]`** no production code claims `processed_messages` or declares a `*Dedup*` type of its own.
- **`[KIT-003]`** every select of pending outbox rows says `SKIP LOCKED`, and no context writes an `OutboxRelay`.
- **`[KIT-004]`** no copy of `SessionJwtProperties` or `ServiceTokenProvider` exists.

The docs generator learned the same thing: a `SecurityConfig` that calls `SecurityBaseline.apply` is credited with the
baseline's rules, in Spring Security's evaluation order, so the API reference does not report `⚠ no rule` on
`/actuator/health` or `/internal/v1/**`.

## 5. Coordinates

- Krizaka artifacts: `com.krizaka:*`, one version for all (`krizaka-bom`), starting at `0.1.0`.
- Orazaka artifacts: `com.krizaka.orazaka:*` (`com.orazaka` is not a namespace Krizaka can publish under on Maven
  Central). Java packages are unchanged — a package is not a coordinate.
- `orazaka-parent` inherits `krizaka-parent`: the Maven Central metadata, the toolchain enforcement and the `release`
  profile are Krizaka's; Spring AI, the Orazaka BOM, the `.env` profiles and SonarCloud stay Orazaka's.
- Configuration keys: `orazaka.identity.jwt.secret` → `krizaka.security.jwt.secret` (same `IDENTITY_JWT_SECRET`);
  `krizaka.messaging.dedup.store` is declared by every consumer (`jdbc`, or `memory` for notifications).

## 6. Consequences

- A security fix to the baseline, the token or the dedup lands **once**, in a release every service takes.
- Orazaka's per-repository `component.yml` still builds the Krizaka repositories from source inside the workspace, so
  nothing waits for a Central release during development; Central is for everyone else.
- AGENTS.md §0 changes: publishing to Maven Central needs secrets beyond `GITHUB_TOKEN` (a Central Portal token and a
  signing key), held as organisation secrets.
