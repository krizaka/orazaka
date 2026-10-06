---
title: Architecture Reference
description: Module map, dependencies, pipeline and messaging — extracted from the code.
category: Architecture
order: 2
generated: true
---

# Architecture Reference

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.

## Modules

| Module | Layer | Inbound ports | Outbound ports |
|:---|:---|:---|:---|
| `orazaka-persistence-app` | framework | — | — |
| `orazaka-persistence-identity` | framework | — | — |
| `orazaka-core` | framework | AiClient, CatalogModelService, ChatSessionService, JobService, McpService | AudioGeneratorClient, CapabilityProvider, ChatGeneratorClient, ChatMemoryStore, ImageGeneratorClient, InfrastructureStatusProvider, KnowledgeService, McpOrchestrator, ModelCatalogProvider, ModelEndpointResolver, PipelineConfigProvider, PlatformMcpServerProvider, PlatformToolConfigProvider, SemanticClassifierPort, TestShaperPort, ToolRegistry, UserCredentialsProvider, UserMcpServerProvider, ValidationPipelineRepository |
| `orazaka-interceptors` | framework | — | — |
| `orazaka-business` | framework | — | — |
| `orazaka-identity` | framework | ApiKeyService, IdentityReconciliationService, IdentityService, PasswordRecoveryService, RateLimitProvider, TokenService, UserProfileProvider | ApiKeyRepositoryPort, AuthorityRepositoryPort, CryptographyPort, OAuth2ProviderVerifier, PasswordEventPublisher, PasswordResetTokenRepositoryPort, UserCredentialRepositoryPort, UserEventPublisher, UserInterceptionRepositoryPort, UserProfileRepositoryPort, UserRepositoryPort, VerificationTokenRepositoryPort |
| `orazaka-tools` | framework | — | — |
| `orazaka-billing-client` | framework | — | — |
| `orazaka-studio-client` | framework | — | — |
| `orazaka-conversation-service` | app | — | — |
| `orazaka-edge` | app | — | — |
| `orazaka-identity-service` | app | — | — |
| `orazaka-automation-service` | app | — | — |
| `orazaka-knowledge-service` | app | — | — |
| `orazaka-job-service` | app | — | — |
| `orazaka-billing-service` | app | — | — |
| `orazaka-studio-service` | app | — | — |
| `orazaka-notification-service` | app | — | — |
| `orazaka-worker-media` | app | — | — |
| `orazaka-web-client` | app | — | — |
| `orazaka-web-admin` | app | — | — |
| `orazaka-mobile-client` | app | — | — |
| `orazaka-cli` | app | — | — |

## Dependency edges

```
orazaka-persistence-app → orazaka-persistence-app-api
orazaka-persistence-app → orazaka-jobs-api
orazaka-core → orazaka-persistence-app-api
orazaka-interceptors → orazaka-core
orazaka-interceptors → orazaka-billing-api
orazaka-interceptors → orazaka-jobs-api
orazaka-business → orazaka-core
orazaka-business → orazaka-studio-api
orazaka-business → orazaka-studio-client
orazaka-identity → orazaka-identity-api
orazaka-identity → orazaka-persistence-identity
orazaka-tools → orazaka-core
orazaka-billing-client → orazaka-billing-api
orazaka-studio-client → orazaka-studio-api
orazaka-conversation-service → orazaka-assets
orazaka-conversation-service → orazaka-billing-client
orazaka-conversation-service → orazaka-core
orazaka-conversation-service → orazaka-identity-api
orazaka-conversation-service → orazaka-jobs-api
orazaka-conversation-service → orazaka-tools
orazaka-conversation-service → orazaka-business
orazaka-conversation-service → orazaka-persistence-app
orazaka-conversation-service → orazaka-persistence-bridge
orazaka-conversation-service → orazaka-interceptors
orazaka-identity-service → orazaka-identity
orazaka-automation-service → orazaka-billing-client
orazaka-job-service → orazaka-assets
orazaka-job-service → orazaka-billing-client
orazaka-job-service → orazaka-core
orazaka-job-service → orazaka-identity-api
orazaka-job-service → orazaka-jobs-api
orazaka-job-service → orazaka-tools
orazaka-job-service → orazaka-business
orazaka-job-service → orazaka-persistence-app
orazaka-job-service → orazaka-persistence-bridge
orazaka-job-service → orazaka-interceptors
orazaka-billing-service → orazaka-billing-api
orazaka-studio-service → orazaka-studio-api
orazaka-studio-service → orazaka-jobs-api
orazaka-studio-service → orazaka-billing-api
orazaka-studio-service → orazaka-billing-client
orazaka-notification-service → orazaka-notification-api
orazaka-web-client → orazaka-conversation-service
orazaka-web-admin → orazaka-conversation-service
orazaka-mobile-client → orazaka-conversation-service
orazaka-cli → orazaka-conversation-service
orazaka-conversation-service → orazaka-worker-media
orazaka-worker-media → orazaka-persistence-app
```

## Interceptor pipeline (DB-driven order)

| # | Interceptor | Enabled |
|:--|:---|:--|
| 1 | `UserContextResolver` | ✅ |
| 2 | `SystemContextInjector` | ✅ |
| 3 | `RagInterceptor` | ✅ |
| 4 | `EntitlementInterceptor` | ✅ |
| 5 | `McpInterceptor` | ✅ |
| 6 | `BrandContextInterceptor` | ✅ |
| 7 | `MemoryInterceptor` | ✅ |
| 8 | `RefinerInterceptor` | ✅ |
| 9 | `RouterInterceptor` | ✅ |
| 9 | `ToolInterceptor` | ✅ |
| 10 | `MediaInterceptor` | ✅ |
| 11 | `UserContextInterceptor` | ✅ |

## Messaging topology (AGENTS.md §6)

**Exchanges**

- `orazaka.jobs` (topic)
- `orazaka.events` (topic)
- `orazaka.dlx` (direct)

**Queues**

| Queue | Exchange | Binding | DLQ |
|:---|:---|:---|:---|
| `orazaka.events.job-relay` | `orazaka.events` | `job.#` | `orazaka.events.job-relay.dlq` |
| `orazaka.events.password.notifications` | `orazaka.events` | `evt.password.*` | `orazaka.events.password.notifications.dlq` |
| `orazaka.events.user.notifications` | `orazaka.events` | `evt.user.*` | `orazaka.events.user.notifications.dlq` |
| `orazaka.jobs.automation` | `orazaka.jobs` | `job.automation.*` | `orazaka.jobs.automation.dlq` |
| `orazaka.jobs.batch` | `orazaka.jobs` | `job.media.generate` | `orazaka.jobs.batch.dlq` |
| `orazaka.jobs.interactive` | `orazaka.jobs` | `job.text.*, job.media.analyze` | `orazaka.jobs.interactive.dlq` |
| `orazaka.jobs.video` | `orazaka.jobs` | `job.video.*` | `orazaka.jobs.video.dlq` |
| `orazaka.notifications.requests` | `orazaka.events` | `evt.notification.requested` | `orazaka.notifications.requests.dlq` |

**Producers**

| Module | Exchange | Routing key |
|:---|:---|:---|
| `orazaka-automation-service` | `orazaka.events` | `evt.automation.telemetry` |
| `orazaka-automation-service` | `orazaka.jobs` | `job.agent.dispatch.{…}` |
| `orazaka-billing-service` | `orazaka.events` | `(dynamic)` |
| `orazaka-conversation-service` | `orazaka.events` | `evt.agent.presence` |
| `orazaka-conversation-service` | `orazaka.events` | `evt.agent.result.{…}` |
| `orazaka-conversation-service` | `orazaka.jobs` | `job.automation.approved` |
| `orazaka-job-service` | `orazaka.events` | `(dynamic)` |
| `orazaka-job-service` | `orazaka.events` | `evt.capability.changed` |
| `orazaka-studio-service` | `orazaka.jobs` | `(dynamic)` |
| `orazaka-studio-service` | `orazaka.events` | `evt.studio.run.failed` |
| `orazaka-studio-service` | `orazaka.events` | `evt.studio.run.started` |
| `orazaka-studio-service` | `orazaka.events` | `evt.studio.run.succeeded` |
| `orazaka-studio-service` | `orazaka.jobs` | `job.automation.approved` |

**Consumers**

| Module | Queue |
|:---|:---|
| `orazaka-automation-service` | `orazaka.jobs.automation` |
| `orazaka-billing-client` | `#entitlementInvalidationQueue.name` |
| `orazaka-billing-service` | `#settlementQueue.name` |
| `orazaka-billing-service` | `#unmeteredTurnQueue.name` |
| `orazaka-conversation-service` | `#walletEventsQueue.name` |
| `orazaka-conversation-service` | `orazaka.events.job-relay` |
| `orazaka-job-service` | `orazaka.jobs.batch` |
| `orazaka-job-service` | `orazaka.jobs.batch.dlq` |
| `orazaka-job-service` | `orazaka.jobs.interactive` |
| `orazaka-job-service` | `orazaka.jobs.interactive.dlq` |
| `orazaka-knowledge-service` | `orazaka.jobs.rag` |
| `orazaka-notification-service` | `orazaka.events.password.notifications` |
| `orazaka-notification-service` | `orazaka.events.user.notifications` |
| `orazaka-notification-service` | `orazaka.notifications.requests` |
| `orazaka-studio-service` | `orazaka.events.studio` |
| `orazaka-studio-service` | `orazaka.events.studio.capability` |
| `orazaka-studio-service` | `orazaka.events.studio.connector` |
| `orazaka-studio-service` | `orazaka.events.studio.dlq` |
| `orazaka-studio-service` | `orazaka.events.studio.subscription` |
