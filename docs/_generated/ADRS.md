---
title: ADR Ledger
description: Architecture Decision Records cited across the codebase.
category: Architecture
order: 9
generated: true
---

# ADR Ledger

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.

| ADR | Title | Source file |
|:---|:---|:---|
| ADR-003 | _(cited in code, no dedicated file)_ | — |
| ADR-005 | _(cited in code, no dedicated file)_ | — |
| ADR-007 | _(cited in code, no dedicated file)_ | — |
| ADR-008 | _(cited in code, no dedicated file)_ | — |
| ADR-009 | _(cited in code, no dedicated file)_ | — |
| ADR-011 | _(cited in code, no dedicated file)_ | — |
| ADR-012 | _(cited in code, no dedicated file)_ | — |
| ADR-017 | _(cited in code, no dedicated file)_ | — |
| ADR-027 | ADR-027 — Single-source `application.yaml`: domain config lives in the database | `adr/ADR-027-db-driven-configuration.md` |
| ADR-028 | ADR-028 — Transport selection: when an operation is REST vs GraphQL vs AMQP | `adr/ADR-028-transport-selection-rest-graphql-amqp.md` |
| ADR-029 | ADR-029 — AI providers are DB-driven; `application.yml` only bootstraps the framework default bean | `adr/ADR-029-db-driven-ai-providers.md` |
| ADR-030 | ADR-030 — Spring AI 2.0 / Boot 4 upgrade + Universal Proxy Client & Dynamic Model Router (DB-driven, no provider starters) | `adr/ADR-030-spring-ai-2-universal-proxy-dynamic-router.md` |
| ADR-031 | ADR-031 — Config governance: Spring-vanilla first · typed `orazaka.*` for gaps · DB for dynamic runtime config | `adr/ADR-031-config-governance-spring-vanilla-db-dynamic.md` |
| ADR-032 | ADR-032 — Microservices decomposition of the Orazaka monolith (Strangler Fig) | `adr/ADR-032-microservices-decomposition-strangler-fig.md` |
| ADR-033 | ADR-033 — Credit metering & billing: local append-only ledger, Lago for money | `adr/ADR-033-credit-metering-and-billing.md` |
| ADR-034 | ADR-034 — Studios: installable business workflows as data, not code | `adr/ADR-034-studio-marketplace.md` |
| ADR-035 | ADR-035 — Service-to-service authentication | `adr/ADR-035-service-to-service-authentication.md` |
| ADR-036 | ADR-036 — Pack catalogue and regulatory class | `adr/ADR-036-pack-catalogue-and-regulatory-class.md` |
| ADR-037 | ADR-037 — Pack SPI: routing as data, purity as a build rule, and the AMQP worker contract | `adr/ADR-037-pack-spi-and-open-core.md` |
| ADR-038 | ADR-038 — Worker SPI: the AMQP contract as the extension point, with advisory registration | `adr/ADR-038-worker-spi-and-registration.md` |
| ADR-039 | ADR-039 — The pack bundle: a manifest, a schema, and a compensated three-context install | `adr/ADR-039-pack-bundle-and-installer.md` |
| ADR-040 | _(cited in code, no dedicated file)_ | — |
| ADR-041 | ADR-041 — A run settles once, at the sum of what its steps measured | `adr/ADR-041-run-settlement.md` |
| ADR-042 | ADR-042 — A Studio step resolves its assets at receipt, inside their owner's directory | `adr/ADR-042-studio-asset-resolution.md` |
| ADR-043 | ADR-043 — The prospection pack: three Studios, one capability, no new code | `adr/ADR-043-prospection-pack.md` |
| ADR-044 | ADR-044 — An inference metered by its orchestration takes no hold of its own | `adr/ADR-044-deferred-metering.md` |
| ADR-045 | ADR-045 — The second producer had no marker, and only the ledger could say so | `adr/ADR-045-metering-marker-guard.md` |
| ADR-046 | ADR-046 — A list of asset ids is still assets, and a failed run's fault cannot be read from a string | `adr/ADR-046-asset-lists-and-failed-run-settlement.md` |
| ADR-047 | ADR-047 — A credit ten times finer, and the last unmetered capability | `adr/ADR-047-credit-scale-and-image-metering.md` |
| ADR-048 | ADR-048 — Optional in the published schema means optional in the type | `adr/ADR-048-optional-on-the-wire.md` |
| ADR-049 | ADR-049 — The open-core cut, tested from outside | `adr/ADR-049-open-core-split.md` |
| ADR-050 | ADR-050 — Declared, not inferred | `adr/ADR-050-declared-not-inferred.md` |
| ADR-051 | ADR-051 — SENSITIVE is five controls, not a label | `adr/ADR-051-sensitive-controls.md` |
| ADR-052 | ADR-052 — The validation pack | `adr/ADR-052-document-validation-pack.md` |
| ADR-053 | ADR-053 — The typed failure cause | `adr/ADR-053-typed-failure-cause.md` |
| ADR-054 | ADR-054 — Encryption at rest | `adr/ADR-054-asset-encryption-at-rest.md` |
| ADR-055 | ADR-055 — The REGULATED controls, and the wellbeing pack | `adr/ADR-055-regulated-controls-and-the-wellbeing-pack.md` |
| ADR-056 | ADR-056 — Authenticity signals | `adr/ADR-056-authenticity-signals.md` |
| ADR-057 | ADR-057 — One capability model | `adr/ADR-057-one-capability-model.md` |
| ADR-058 | ADR-058 — No service kit | `adr/ADR-058-no-service-kit.md` |
| ADR-059 | ADR-059 — The saga split | `adr/ADR-059-run-saga-split.md` |
| ADR-060 | ADR-060 — The saga's write boundary | `adr/ADR-060-the-saga-write-boundary.md` |
| ADR-061 | ADR-061 — Pack kind and derived installation | `adr/ADR-061-pack-kind-and-derived-installation.md` |
| ADR-062 | ADR-062 — The inert controls, closed | `adr/ADR-062-inert-controls-closed.md` |
| ADR-063 | ADR-063 — The media turn | `adr/ADR-063-the-media-turn.md` |
| ADR-064 | ADR-064 — Four trust boundaries | `adr/ADR-064-trust-boundaries.md` |
| ADR-065 | ADR-065 — The disclosure surface, closed | `adr/ADR-065-retention-by-class-and-assets-by-id.md` |
| ADR-066 | ADR-066 — Media becomes a pack, and starts being billed | `adr/ADR-066-media-becomes-a-pack.md` |
| ADR-067 | ADR-067 — The run path becomes load-bearing | `adr/ADR-067-the-run-path-becomes-load-bearing.md` |
| ADR-068 | ADR-068 — One door | `adr/ADR-068-one-door.md` |
| ADR-069 | ADR-069 — The registry declares what it runs | `adr/ADR-069-the-registry-declares-what-it-runs.md` |
| ADR-070 | ADR-070 — The run surface is sealed | `adr/ADR-070-the-run-surface-is-sealed.md` |
| ADR-071 | ADR-071 — Repair the instruments | `adr/ADR-071-repair-the-instruments.md` |
| ADR-072 | ADR-072 — A ruleset is a test suite pointed at the user's document | `adr/ADR-072-a-ruleset-is-a-test-suite.md` |
| ADR-073 | ADR-073 — The kit is a product | `adr/ADR-073-the-kit-is-a-product.md` |
