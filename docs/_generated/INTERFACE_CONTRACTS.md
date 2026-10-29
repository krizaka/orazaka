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

- `AgentTurns`
- `AiClient`
- `CatalogModelService`
- `ChatSessionService`
- `CitationVerifier`
- `ExternalCheckCapability`
- `JobService`
- `McpService`
- `StepRouter`

**Outbound ports**

- `AccessAudit`
- `AudioGeneratorClient`
- `AudioTranscriber`
- `CapabilityProvider`
- `ChatGeneratorClient`
- `ChatInvocation`
- `ChatMemoryStore`
- `CheckAuditLog`
- `CheckHttp`
- `CheckKeyStore`
- `CheckMeter`
- `CheckProviderCatalog`
- `CheckSubjectPepper`
- `CodeSandboxPort`
- `ConsentRegistry`
- `ControlVerdictRecorder`
- `ConversationMemory`
- `DomainEventPublisher`
- `EmbeddingClient`
- `ExternalCheckConnector`
- `FeatureModelRoutes`
- `ImageGeneratorClient`
- `InfrastructureStatusProvider`
- `KnowledgeService`
- `McpOrchestrator`
- `ModelCatalogProvider`
- `ModelEndpointResolver`
- `PipelineConfigProvider`
- `PlatformMcpServerProvider`
- `PlatformToolConfigProvider`
- `PromptAssembly`
- `ProviderChatClient`
- `SemanticClassifierPort`
- `SpeechSynthesis`
- `StepModelRecorder`
- `StepRouteProvider`
- `StructuredOutputClient`
- `TestShaperPort`
- `ToolAnswerCodec`
- `ToolOptions`
- `ToolPermissionProvider`
- `ToolRegistry`
- `ToolResolution`
- `ToolResultCache`
- `UserCredentialsProvider`
- `UserMcpServerProvider`
- `ValidationPipelineRepository`

## `krizaka-users-core`

**Inbound ports**

- `AdminUserService`
- `ApiKeyService`
- `IdentityReconciliationService`
- `IdentityService`
- `OrganizationService`
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
- `OrganizationRepositoryPort`
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
- `FeatureRouteManager`
- `JobPersistenceProvider`
- `OutboxStore`
- `PipelineConfigManager`
- `PlatformMcpServerPersistenceProvider`
- `PlatformToolConfigPersistenceProvider`
- `RuntimeConfigProvider`
- `SpeechVoiceManager`
- `UserMcpServerPersistenceProvider`
- `ValidationPipelineManager`

