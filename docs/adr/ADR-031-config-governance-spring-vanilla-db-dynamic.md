# ADR-031 — Config governance: Spring-vanilla first · typed `orazaka.*` for gaps · DB for dynamic runtime config

- **Status**: Accepted (DB table added; Spring-first reader = local build loop)
- **Date**: 2026-06-16
- **Scope**: `products/orazaka` — `orazaka-router/.../application.yml`, `@ConfigurationProperties`, `orazaka_runtime_config`
- **Extends**: ADR-027 (single-source `application.yaml`; domain data lives in the DB)

## Context

Reviewing `application.yml` raised two recurring questions: (a) should app-specific config (`orazaka.*`)
be **merged into the standard Spring namespaces** to stay "vanilla" and ride Spring's maintained docs?
and (b) should more config be **DB-driven**? Both need a written line so the answer stops being ad-hoc.

Findings (verified): `spring.data.redis.*` and `spring.rabbitmq.*` (host/port/credentials/listener/retry)
are **standard Spring Boot** properties consumed by Spring autoconfiguration. `orazaka.messaging.broker.
queue.{max-length,overflow-strategy}` is bound by a typed `@ConfigurationProperties` (`BrokerProperties`)
and applied in `RabbitMQConfig` via `QueueBuilder` — because Spring Boot exposes **no** property for
per-queue `x-max-length` / `x-overflow` (those are queue-declaration arguments set in code). There is
**no duplication** between `spring.*` and `orazaka.*`.

## Decision — three tiers

1. **Spring-vanilla first.** For anything Spring Boot owns (datasource, Redis, RabbitMQ connection +
   listener + retry, web/async timeouts, multipart), use the **standard `spring.*` property**. You get
   Spring's autoconfiguration, validation, and team-maintained docs for free. **Do not** re-home these
   under `orazaka.*` (you'd lose autoconfiguration — the opposite of "vanilla"), and **do not** try to
   merge `orazaka.*` queue args into `spring.rabbitmq.*` (those properties don't exist).

2. **Typed `orazaka.*` only for genuine gaps.** App-specific config Spring doesn't expose (queue
   declaration args, job execution-timeout, etc.) lives under `orazaka.*` and **must** be bound via a
   typed `@ConfigurationProperties` record (never loose `@Value`) — AGENTS.md §4. This is the correct
   Spring-first extension, not a duplicate.

3. **DB for dynamic runtime config.** Config that is **read after startup** and that an admin changes
   **live** (toggles/tuning) is the DB's source of truth, in `orazaka_runtime_config`
   (`config_key, config_value, value_type, description`), read Spring-first via a typed
   `RuntimeConfigProvider` port + persistence adapter (mirroring `RateLimitProvider` /
   `CapabilityProvider`). Seeded keys: `rag.enabled`, `rag.top-k`, `rate-limit.enabled`.

### The bootstrap boundary (why not "everything in the DB")
Anything needed **before** the DB/broker/web layer exist **cannot** be DB-driven (you'd need the DB to
learn how to reach the DB). So **stays in yaml**: datasource, `spring.rabbitmq.*` / `spring.data.redis.*`,
broker queue tuning (`orazaka.messaging.broker.*`), timeouts (`jobs.execution-timeout`), HTTP cache
headers, and the vector-store **type** (`rag.store-type`). Only post-startup **behaviour** moves to the DB.

| Key | Tier | Home |
|-----|------|------|
| `spring.data.redis.*`, `spring.rabbitmq.*` (host/listener/retry) | Spring-vanilla infra | `application.yml` |
| `orazaka.messaging.broker.queue.{max-length,overflow}` | Typed `orazaka.*` gap (queue args) | `application.yml` + `BrokerProperties` |
| `jobs.execution-timeout`, uploads `cache-period`, `rag.store-type` | Bootstrap/infra | `application.yml` |
| `rag.enabled`, `rag.top-k`, `rate-limit.enabled` | **Dynamic runtime** | **`orazaka_runtime_config`** (DB) |

## Consequences
- **Positive**: a clear rule ends the "merge into spring.* ? / move to DB?" debate; max use of
  Spring-maintained config; admins control runtime behaviour from the DB with no redeploy; no drift.
- **Status**: `orazaka_runtime_config` table + seeds added (`infra/init.sql`). The Spring-first
  `RuntimeConfigProvider` + removing `rag.enabled`/`rag.top-k` + `rate-limit.enabled` from yaml is the
  remaining local-build-loop step (do the reader and the yaml removal together to avoid a silent revert
  to the hard-coded `RagConfig(true,"pgvector",3)` default).
