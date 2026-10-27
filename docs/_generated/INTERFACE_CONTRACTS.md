---
title: Interface Contracts (generated)
description: Inbound and outbound ports per module, extracted from the code.
category: Architecture
order: 3
generated: true
---

# Interface Contracts (generated)

## `orazaka-core`

**Inbound ports**

- `AiClient`
- `CatalogModelService`
- `ChatSessionService`
- `CitationVerifier`
- `ExternalCheckCapability`
- `JobService`
- `McpService`
- `StepRouter`

**Outbound ports**

- `AudioGeneratorClient`
- `CapabilityProvider`
- `ChatGeneratorClient`
- `ChatMemoryStore`
- `CheckAuditLog`
- `CheckHttp`
- `CheckKeyStore`
- `CheckMeter`
- `CheckProviderCatalog`
- `CheckSubjectPepper`
- `ConsentRegistry`
- `EmbeddingClient`
- `ExternalCheckConnector`
- `ImageGeneratorClient`
- `InfrastructureStatusProvider`
- `KnowledgeService`
- `McpOrchestrator`
- `ModelCatalogProvider`
- `ModelEndpointResolver`
- `PipelineConfigProvider`
- `PlatformMcpServerProvider`
- `PlatformToolConfigProvider`
- `SemanticClassifierPort`
- `StepModelRecorder`
- `StepRouteProvider`
- `TestShaperPort`
- `ToolRegistry`
- `UserCredentialsProvider`
- `UserMcpServerProvider`
- `ValidationPipelineRepository`

## `krizaka-users-core`

**Inbound ports**

- `AdminUserService`
- `ApiKeyService`
- `IdentityReconciliationService`
- `IdentityService`
- `PasswordRecoveryService`
- `RateLimitProvider`
- `TokenService`
- `UserProfileProvider`

**Outbound ports**

- `AdminUserRepositoryPort`
- `ApiKeyRepositoryPort`
- `AuthorityRepositoryPort`
- `CryptographyPort`
- `OAuth2ProviderVerifier`
- `PasswordEventPublisher`
- `PasswordResetTokenRepositoryPort`
- `UserCredentialRepositoryPort`
- `UserEventPublisher`
- `UserInterceptionRepositoryPort`
- `UserProfileRepositoryPort`
- `UserRepositoryPort`
- `VerificationTokenRepositoryPort`

## `orazaka-persistence-app-api`

**Inbound ports**

- `CapabilityManager`
- `CatalogModelManager`
- `ChatMemoryPersistenceProvider`
- `ChatSessionPersistenceProvider`
- `JobPersistenceProvider`
- `OutboxStore`
- `PipelineConfigManager`
- `PlatformMcpServerPersistenceProvider`
- `PlatformToolConfigPersistenceProvider`
- `RuntimeConfigProvider`
- `SpeechVoiceManager`
- `UserMcpServerPersistenceProvider`
- `ValidationPipelineManager`

