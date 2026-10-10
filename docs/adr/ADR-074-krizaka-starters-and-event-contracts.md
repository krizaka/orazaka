---
title: "ADR-074 — Krizaka starters and event contracts"
description: "A service is built from the four Krizaka starters and an application.yml of what its deployment decides (≤ 20 lines); its operating defaults sit below it. Every event a Krizaka -api publishes has a JSON Schema, checked against its producer and against each consumer's copy. orazaka-conversation-service is the first service migrated."
category: ADR
order: 74
---

# ADR-074 — Krizaka starters and event contracts

- **Status**: Accepted
- **Date**: 2026-10-10
- **Builds on**: [ADR-073](ADR-073-the-kit-is-a-product.md) (the kit is a product) · **Scope**: `orazaka-conversation-service`, `krizaka-users|billing|notifications-api`, `krizaka-test-support`

## What changes for a service that migrates

1. **POM** — the BOM (`krizaka-bom`, imported by `orazaka-parent`) then capabilities, no version: `krizaka-spring-boot-starter-web | -security | -rabbitmq | -observability`. They replace `krizaka-security`, the Spring web/security/resource-server/AMQP/actuator starters and the OTel bridge + exporter.
2. **`application.yml` ≤ 20 lines** — only what a deployment decides: where the database, broker, cache and other services are; secrets from the environment (empty defaults, §5 of the configuration standard); `krizaka.web.cors.allowed-origins`; `krizaka.observability.{product, service, version: "@project.version@"}` (filtered resources); global switches (`ORCHESTRATION_ENABLED`). `spring.threads.virtual` stays here ([SRC-002]).
3. **Operating defaults** (pool, listener, multipart, timeouts, OTLP endpoint, the synchronous capability endpoints) move to `META-INF/orazaka/<service>-defaults.yml`, added by an `EnvironmentPostProcessor` as the **lowest-priority** source — the kit's own pattern. The environment variables they read do not change. This amends the configuration standard's "single file" (§3): one file per audience, not one per profile.
4. **Delete what the kit does**: CORS configuration, error handler for generic failures, correlation filter, Jackson defaults, actuator exposure, log format. Errors are RFC 9457 Problem Details `{type, title, status, detail, code, requestId}`; a not-found is a `NotFoundException` with a stable code. A refusal body that is a product contract (the paywall's 402/403/503, `RefusalSchema`) stays, in an advice ordered before the kit's, until its client moves.
5. **Listener retry stays Spring Boot's** while the Orazaka DLQs are bound with the queue name: the kit's recoverer routes to `<queue>.dlq`. Binding both keys is the next step.
6. **Events**: each `*-api` ships `events/<routing-key>.v<n>.json` (JSON Schema 2020-12). The producer's test extends `EventContractTest` (`assertConforms`); a consumer with its own copy depends on the producer's `-api` in **test** scope and calls `assertReadable`. A change a consumer cannot read is `v2` under a new routing key.
