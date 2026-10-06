# ADR-032 — Microservices decomposition of the Orazaka monolith (Strangler Fig)

- **Status**: Accepted (executed locally, phases 0–6; CI/cloud deferred per §0)
- **Date**: 2026-07-18
- **Scope**: `products/orazaka` — whole repository (new service modules, `infra/initdb/`, `.env`, edge route table, AMQP topology, E2E constellation)
- **Extends**: ADR-027 (DB-driven config), ADR-029/030 (DB-driven providers), ADR-031 (config governance)
- **Roadmap**: [`docs/MICROSERVICES_TARGET_ARCHITECTURE.md`](../MICROSERVICES_TARGET_ARCHITECTURE.md)

## Context

The Orazaka backend began as a modular monolith (`orazaka-router`) bundling the cognitive
libraries (`core`/`business`/`interceptors`/`tools`/`persistence`) and serving every transport —
interactive chat/SSE, async jobs, media, MCP, identity. It was already hexagonal and
ArchUnit-enforced, but a single deployable owned every context's data and every inbound path.
The target architecture calls for independently owned services fronted by a transparent edge, per
the Strangler Fig pattern, adapted **100% local** (no CI/cloud — AGENTS.md §0): the hermetic E2E
gate through the edge replaces the plan's CI/canary/SLO Definition-of-Done items.

## Decision

Decompose incrementally, one gate-green commit per phase, the topic exchanges
(`orazaka.jobs`/`orazaka.events`) held stable as the async API while consumers and data move.

1. **Edge facade first** (`orazaka-edge` :8088) — a transparent streaming proxy; `ROUTER_URL`
   points clients at the edge so every later cutover is a route-table flip with instant rollback.
2. **Data seam** — one Postgres container, **one database per service** with its own role
   (`orazaka_identity_db`, `orazaka_automation_db`, `orazaka_knowledge_db`), created by that
   service's `infra/initdb/*.sql`; cross-context foreign keys and cross-context seeds are banned
   (opaque `ActorId` only), enforced by `SqlBoundaryRules`.
3. **Contract-copy over shared jars** — a service duplicates the subset of a message/DTO contract
   it uses (AGENTS.md §6); no shared messaging library crosses a service boundary. Frozen shapes
   are guarded by `AmqpContractIT` fixtures.
4. **Services extracted**: `identity-service` :8083 (trust root; edge exchanges `oz_` API keys for
   session JWTs), `automation-service` (ex worker-integrations; own DB, identity coupling dropped
   via local contract-copy events), the Python **media worker** as an AMQP consumer of
   `orazaka.jobs.video` emitting `job.{id}.done|error`, `knowledge-service` :8084 (RAG retrieve +
   tool-source lookup behind the core `KnowledgeService` port; `job.rag.*` async indexing), and
   `job-service` :8090 (the async COMMAND executor — `JobListener` + strategies).
5. **The monolith dissolves** — with the executor gone, the former `orazaka-router` becomes
   `orazaka-conversation-service` (`com.orazaka.conversationservice`, :8080 behind the edge): the
   interactive host + job producer + SSE relay.

## Cross-process concerns

- **SSE across the process boundary**: once the executor left the router process, in-process job
  status changes could no longer reach the SSE emitters. Executors (the Python media worker, then
  `job-service`) emit `job.{id}.done|error` events; the conversation-service's `JobEventListener`
  applies them and fans out to connected clients — the `job.{jobId}.progress|done|error` contract
  never changed, so the relay never noticed the migration.
- **Environment-variable precedence**: OS env vars outrank `application.yml`. The shared local
  `.env` exports `SPRING_DATASOURCE_*` for the app database, which silently hijacked any new
  service that relied on `spring.datasource` + a yaml placeholder. Every own-database service
  builds its `DataSource` from a dedicated `orazaka.<service>.datasource` prefix so autoconfiguration
  (and the env pollution) backs off.
- **AMQP queue re-declares**: a consumer that re-declares a work queue must copy the platform's
  `workQueueArguments` (`x-max-length`, `x-overflow`, DLX) argument-for-argument, or RabbitMQ
  rejects it with `PRECONDITION_FAILED`.

## Consequences

- Six services plus the conversation host, each independently built and rolled back, owning its
  data, reached only through the edge route or declared AMQP bindings — the migration's
  Definition of Done.
- The SSE relay stays in the conversation-service (the plan's "thin relay service"); relocating it
  to the edge with an exclusive-queue-per-node consumer is off-laptop hardening, deferred.
- Full conversation/job database split (`orazaka_conversation_db`/`orazaka_jobs_db`) is deferred
  while the chat ↔ jobs ↔ config-plane tables still interleave in `orazaka_db`.
- Config identifiers of the former router (`orazaka.router.*`, `ROUTER_*`, the M2M audience) are
  retained as the conversation-service's wiring keys; renaming them is deferred cosmetic churn.
- The dead in-process video-generation client path (`AiClient.video` / `VideoGeneratorClient`) was
  removed once video generation moved to the media worker over AMQP.
