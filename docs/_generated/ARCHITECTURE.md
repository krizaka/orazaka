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
| `krizaka-users-persistence` | framework | — | — |
| `orazaka-core` | framework | AiClient, CatalogModelService, ChatSessionService, JobService, McpService | AudioGeneratorClient, CapabilityProvider, ChatGeneratorClient, ChatMemoryStore, ImageGeneratorClient, InfrastructureStatusProvider, KnowledgeService, McpOrchestrator, ModelCatalogProvider, ModelEndpointResolver, PipelineConfigProvider, PlatformMcpServerProvider, PlatformToolConfigProvider, SemanticClassifierPort, TestShaperPort, ToolRegistry, UserCredentialsProvider, UserMcpServerProvider, ValidationPipelineRepository |
| `orazaka-interceptors` | framework | — | — |
| `orazaka-business` | framework | — | — |
| `krizaka-users-core` | framework | ApiKeyService, IdentityReconciliationService, IdentityService, PasswordRecoveryService, RateLimitProvider, TokenService, UserProfileProvider | ApiKeyRepositoryPort, AuthorityRepositoryPort, CryptographyPort, OAuth2ProviderVerifier, PasswordEventPublisher, PasswordResetTokenRepositoryPort, UserCredentialRepositoryPort, UserEventPublisher, UserInterceptionRepositoryPort, UserProfileRepositoryPort, UserRepositoryPort, VerificationTokenRepositoryPort |
| `orazaka-tools` | framework | — | — |
| `krizaka-billing-client` | framework | — | — |
| `orazaka-studio-client` | framework | — | — |
| `orazaka-conversation-service` | app | — | — |
| `orazaka-edge` | app | — | — |
| `krizaka-users-service` | app | — | — |
| `orazaka-automation-service` | app | — | — |
| `orazaka-knowledge-service` | app | — | — |
| `orazaka-job-service` | app | — | — |
| `krizaka-billing-service` | app | — | — |
| `orazaka-studio-service` | app | — | — |
| `krizaka-notifications-service` | app | — | — |
| `orazaka-worker-media` | app | — | — |
| `orazaka-web-client` | app | — | — |
| `orazaka-web-admin` | app | — | — |
| `orazaka-mobile-client` | app | — | — |
| `orazaka-cli` | app | — | — |

## Dependency edges

```
orazaka-persistence-app → krizaka-messaging
orazaka-persistence-app → orazaka-persistence-app-api
orazaka-persistence-app → orazaka-jobs-api
krizaka-users-persistence → krizaka-messaging
krizaka-users-persistence → krizaka-test-support
orazaka-core → krizaka-security
orazaka-core → orazaka-persistence-app-api
orazaka-interceptors → orazaka-core
orazaka-interceptors → krizaka-billing-api
orazaka-interceptors → orazaka-jobs-api
orazaka-business → orazaka-core
orazaka-business → orazaka-studio-api
orazaka-business → orazaka-studio-client
krizaka-users-core → krizaka-users-api
krizaka-users-core → krizaka-users-persistence
krizaka-users-core → krizaka-test-support
orazaka-tools → orazaka-core
krizaka-billing-client → krizaka-security
krizaka-billing-client → krizaka-billing-api
orazaka-studio-client → krizaka-security
orazaka-studio-client → orazaka-studio-api
orazaka-conversation-service → krizaka-security
orazaka-conversation-service → krizaka-users-client
orazaka-conversation-service → orazaka-assets
orazaka-conversation-service → krizaka-billing-client
orazaka-conversation-service → orazaka-core
orazaka-conversation-service → krizaka-users-api
orazaka-conversation-service → orazaka-jobs-api
orazaka-conversation-service → orazaka-tools
orazaka-conversation-service → orazaka-business
orazaka-conversation-service → orazaka-persistence-app
orazaka-conversation-service → orazaka-persistence-bridge
orazaka-conversation-service → orazaka-interceptors
orazaka-edge → krizaka-security
krizaka-users-service → krizaka-security
krizaka-users-service → krizaka-users-core
krizaka-users-service → krizaka-test-support
orazaka-automation-service → krizaka-messaging
orazaka-automation-service → krizaka-billing-client
orazaka-knowledge-service → krizaka-messaging
orazaka-knowledge-service → krizaka-security
orazaka-job-service → krizaka-messaging
orazaka-job-service → krizaka-security
orazaka-job-service → krizaka-users-client
orazaka-job-service → orazaka-assets
orazaka-job-service → krizaka-billing-client
orazaka-job-service → orazaka-core
orazaka-job-service → krizaka-users-api
orazaka-job-service → orazaka-jobs-api
orazaka-job-service → orazaka-tools
orazaka-job-service → orazaka-business
orazaka-job-service → orazaka-persistence-app
orazaka-job-service → orazaka-persistence-bridge
orazaka-job-service → orazaka-interceptors
krizaka-billing-service → krizaka-messaging
krizaka-billing-service → krizaka-security
krizaka-billing-service → krizaka-billing-api
krizaka-billing-service → krizaka-test-support
orazaka-studio-service → krizaka-messaging
orazaka-studio-service → krizaka-security
orazaka-studio-service → orazaka-studio-api
orazaka-studio-service → orazaka-jobs-api
orazaka-studio-service → krizaka-billing-api
orazaka-studio-service → krizaka-billing-client
krizaka-notifications-service → krizaka-messaging
krizaka-notifications-service → krizaka-notifications-api
krizaka-notifications-service → krizaka-test-support
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
| `krizaka-billing-service` | `orazaka.events` | `(dynamic)` |
| `orazaka-automation-service` | `orazaka.events` | `evt.automation.telemetry` |
| `orazaka-automation-service` | `orazaka.jobs` | `job.agent.dispatch.{…}` |
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
| `krizaka-billing-client` | `#entitlementInvalidationQueue.name` |
| `krizaka-billing-service` | `#settlementQueue.name` |
| `krizaka-billing-service` | `#unmeteredTurnQueue.name` |
| `krizaka-notifications-service` | `orazaka.events.password.notifications` |
| `krizaka-notifications-service` | `orazaka.events.user.notifications` |
| `krizaka-notifications-service` | `orazaka.notifications.requests` |
| `orazaka-automation-service` | `orazaka.jobs.automation` |
| `orazaka-conversation-service` | `#walletEventsQueue.name` |
| `orazaka-conversation-service` | `orazaka.events.job-relay` |
| `orazaka-job-service` | `orazaka.jobs.batch` |
| `orazaka-job-service` | `orazaka.jobs.batch.dlq` |
| `orazaka-job-service` | `orazaka.jobs.interactive` |
| `orazaka-job-service` | `orazaka.jobs.interactive.dlq` |
| `orazaka-knowledge-service` | `orazaka.jobs.rag` |
| `orazaka-studio-service` | `orazaka.events.studio` |
| `orazaka-studio-service` | `orazaka.events.studio.capability` |
| `orazaka-studio-service` | `orazaka.events.studio.connector` |
| `orazaka-studio-service` | `orazaka.events.studio.dlq` |
| `orazaka-studio-service` | `orazaka.events.studio.subscription` |
