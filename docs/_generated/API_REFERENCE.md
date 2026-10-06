---
title: API Reference
description: Every REST endpoint of every service, with the authorisation rule that guards it, extracted from the controllers and their SecurityConfig.
category: API
order: 6
generated: true
---

# API Reference

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.


**Access** is read from each service's `SecurityConfig`, most-specific matcher first — the same
order Spring Security applies. `SERVICE` is the machine-to-machine authority required on
`/internal/v1/**` (ADR-035); `public` means no credential at all, and **⚠ no rule** means
no matcher covers the path — the service has no security on it whatsoever.


## billing-service

| Method | Path | Access | Controller | Summary |
|:---|:---|:---|:---|:---|
| GET | `/api/v1/billing/configuration` | authenticated | ConfigurationController | The declared key vocabulary — type, permitted domain and code default per key. |
| PATCH | `/api/v1/billing/configuration` | authenticated | ConfigurationController | Applies one validated configuration change. |
| GET | `/api/v1/billing/pack-subscriptions` | authenticated | PackSubscriptionController | Every live holder of a pack — what an admin checks before withdrawing one. |
| GET | `/api/v1/billing/pack-subscriptions/{actorId}` | authenticated | PackSubscriptionController | The packs one actor holds. |
| GET | `/api/v1/billing/pack-subscriptions/me` | authenticated | PackSubscriptionController | The packs the signed-in user holds. |
| DELETE | `/api/v1/billing/pack-subscriptions/me/{packKey}` | authenticated | PackSubscriptionController | Removes a pack from the signed-in user. |
| POST | `/api/v1/billing/pack-subscriptions/me/{packKey}` | authenticated | PackSubscriptionController | Adds a pack to the signed-in user. |
| GET | `/api/v1/billing/packs` | authenticated | PackController | The priced catalogue. |
| DELETE | `/api/v1/billing/packs/{packKey}` | authenticated | PackController | Withdraws a pack from sale. |
| GET | `/api/v1/billing/packs/{packKey}` | authenticated | PackController | One pack with its entitlement matrix. |
| PUT | `/api/v1/billing/packs/{packKey}` | authenticated | PackController | Creates or replaces a pack's price and entitlements. |
| GET | `/api/v1/billing/packs/prices` | authenticated | PackController | The whole price table, for the Pack catalogue to render a marketplace page from. |
| GET | `/api/v1/billing/plans` | authenticated | PlanController | The catalogue. |
| DELETE | `/api/v1/billing/plans/{planKey}` | authenticated | PlanController | Retires a plan — deactivated, never deleted, because subscriptions reference it. |
| GET | `/api/v1/billing/plans/{planKey}` | authenticated | PlanController | One plan with its entitlement matrix. |
| PUT | `/api/v1/billing/plans/{planKey}` | authenticated | PlanController | Creates or replaces a plan. |
| GET | `/api/v1/billing/pricebook` | authenticated | PricebookController |  |
| POST | `/api/v1/billing/pricebook` | authenticated | PricebookController |  |
| GET | `/api/v1/billing/pricebook/estimate` | authenticated | PricebookController | What an action would cost the signed-in user, and whether they can cover it. |
| GET | `/api/v1/billing/pricebook/history` | authenticated | PricebookController |  |
| POST | `/api/v1/billing/pricebook/preview` | authenticated | PricebookController |  |
| GET | `/api/v1/billing/subscriptions` | authenticated | SubscriptionController | Every live subscriber of a plan — what an admin checks before retiring one. |
| DELETE | `/api/v1/billing/subscriptions/{actorId}` | authenticated | SubscriptionController | Ends an actor's subscription. |
| GET | `/api/v1/billing/subscriptions/{actorId}` | authenticated | SubscriptionController | The subscription in force for an actor. |
| POST | `/api/v1/billing/subscriptions/{actorId}` | authenticated | SubscriptionController | Moves an actor onto a plan — upgrade, downgrade or trial. |
| POST | `/api/v1/billing/subscriptions/{actorId}/rollover` | authenticated | SubscriptionController | Rolls a subscription into its next period, honouring a pending cancellation. |
| GET | `/api/v1/billing/usage/capabilities` | authenticated | UsageController | Consumption and refusals per capability × model. |
| GET | `/api/v1/billing/usage/top-consumers` | authenticated | UsageController | The heaviest consumers. |
| GET | `/api/v1/billing/wallets/{actorId}` | authenticated | WalletController | Reads an actor's balances. |
| POST | `/api/v1/billing/wallets/{actorId}/adjustments` | authenticated | WalletController | Issues a manual credit adjustment — support goodwill, or a claw-back. |
| GET | `/api/v1/billing/wallets/{actorId}/entitlements` | authenticated | WalletController | Reads an actor's effective entitlements plus their balance summary. |
| GET | `/api/v1/billing/wallets/adjustments/today` | authenticated | WalletController | What an admin has already adjusted today, against their ceiling. |
| GET | `/api/v1/billing/wallets/me` | authenticated | WalletController | The signed-in user's own balances. |
| GET | `/api/v1/billing/wallets/me/entitlements` | authenticated | WalletController | The signed-in user's own entitlements and available balance. |
| POST | `/internal/v1/billing/credits/{holdId}/release` | SERVICE | CreditController | Closes a hold with no debit. |
| POST | `/internal/v1/billing/credits/{holdId}/settle` | SERVICE | CreditController | Closes a hold against measured consumption. |
| POST | `/internal/v1/billing/credits/{holdId}/settle-aggregate` | SERVICE | CreditController | Closes one hold against the measurements of the several steps it authorised. |
| POST | `/internal/v1/billing/credits/{holdId}/settle-measured` | SERVICE | CreditController | Closes a hold against an executor's raw measurements, pricing them in the unit the hold's pinned rate uses. |
| POST | `/internal/v1/billing/credits/holds` | SERVICE | CreditController | Reserves the estimated cost of a request. |
| GET | `/internal/v1/billing/entitlements/{actorId}` | SERVICE | EntitlementController | Reads an actor's effective entitlements plus their balance summary. |
| DELETE | `/internal/v1/billing/packs/{packKey}` | SERVICE | PackProvisioningController | Withdraws a pack from sale, so a failed install can undo the half it already applied. |
| PUT | `/internal/v1/billing/packs/{packKey}` | SERVICE | PackProvisioningController | Creates or replaces a pack's price and entitlement matrix. |

## conversation-service

| Method | Path | Access | Controller | Summary |
|:---|:---|:---|:---|:---|
| POST | `/api/v1/agent/report` | authenticated | AgentController | Receives execution reports from the CLI agent after local task completion. |
| GET | `/api/v1/agent/stream` | authenticated | AgentController | Establishes a persistent SSE stream for the CLI agent. |
| GET | `/api/v1/assets/{jobId}/{filename}` | ADMIN + USER | AssetController | Streams one asset to its owner, or to an administrator. |
| GET | `/api/v1/chat/sessions` | authenticated | ChatController |  |
| POST | `/api/v1/chat/sessions` | authenticated | ChatController |  |
| DELETE | `/api/v1/chat/sessions/{sessionId}` | authenticated | ChatController |  |
| PATCH | `/api/v1/chat/sessions/{sessionId}` | authenticated | ChatController |  |
| GET | `/api/v1/chat/stream/{conversationId}` | ADMIN + USER | ChatController | Streams chat via SSE using GET. |
| POST | `/api/v1/chat/stream/{conversationId}` | ADMIN + USER | ChatController | Streams chat via SSE using POST (supporting file reference mappings). |
| POST | `/api/v1/code` | authenticated | CodeController | Streams code generation via SSE using POST. |
| GET | `/api/v1/features` | ADMIN + USER | FeatureController | What this deployment can currently run: every enabled capability with its live degraded-mode state. |
| PUT | `/api/v1/features/{featureKey}` | authenticated | FeatureController | Admin: toggles an existing capability's enabled state. |
| GET | `/api/v1/features/all` | authenticated | FeatureController | Admin: all capabilities (enabled or not) from the database. |
| POST | `/api/v1/intent` | authenticated | IntentController | Dispatches a synchronous user intention through the App Factory and returns the result. |
| POST | `/api/v1/intent/route` | public | IntentController | M2M Level-0 gate routing: verifies the envelope and returns a signed intent token. |
| GET | `/api/v1/jobs` | authenticated | JobController | Retrieves a paginated list of jobs for the authenticated user (or all jobs for admins). |
| GET | `/api/v1/jobs/{id}` | ADMIN + USER | JobController | Fetches the single, atomic state of a specific job. |
| POST | `/api/v1/jobs/{id}/progress` | public | JobController | Updates progress of a running job and broadcasts it to connected users. |
| POST | `/api/v1/jobs/{jobId}/approve` | ADMIN + USER | JobController | Approves a pending automation job and dispatches its payload to the execution queue. |
| POST | `/api/v1/jobs/{jobId}/revoke` | ADMIN + USER | JobController | Revokes a pending automation job, preventing its execution. |
| GET | `/api/v1/jobs/active-connections` | ADMIN + USER | JobController | Retrieves the current active SSE connection count. |
| POST | `/api/v1/jobs/purge` | ADMIN + USER | JobController | Purges jobs, chat sessions and rate-limit cache for the default test accounts. |
| GET | `/api/v1/jobs/stream` | ADMIN + USER | JobController | Registers a Server-Sent Events stream for real-time job status notifications. |
| GET | `/api/v1/mcp/servers/platform` | authenticated | McpController |  |
| POST | `/api/v1/mcp/servers/platform` | authenticated | McpController |  |
| DELETE | `/api/v1/mcp/servers/platform/{id}` | authenticated | McpController |  |
| GET | `/api/v1/mcp/servers/user` | authenticated | McpController |  |
| POST | `/api/v1/mcp/servers/user` | authenticated | McpController |  |
| DELETE | `/api/v1/mcp/servers/user/{id}` | authenticated | McpController |  |
| GET | `/api/v1/mcp/tools` | authenticated | McpController | Retrieves all registered tools and their schemas. |
| POST | `/api/v1/mcp/tools/{name}/execute` | authenticated | McpController | Executes a tool by name with the provided arguments. |
| GET | `/api/v1/media/search` | authenticated | MediaAnalysisController | Performs a passive RAG context search against the semantic index. |
| POST | `/api/v1/media/upload` | authenticated | MediaAnalysisController | Securely uploads a raw binary asset, isolated per authenticated user. |
| GET | `/api/v1/models` | ADMIN + USER | ModelController | Retrieves the local catalog of Ollama models. |
| POST | `/api/v1/models` | ADMIN + USER | ModelController | Adds a new model definition to the catalog. |
| DELETE | `/api/v1/models/{id}` | authenticated | ModelController | Deletes a model definition by its database ID. |
| PUT | `/api/v1/models/{id}` | authenticated | ModelController | Updates an existing model definition in the catalog. |
| GET | `/api/v1/models/catalog` | authenticated | ModelController | Retrieves the complete AI model catalog definitions from the database. |
| GET | `/api/v1/models/providers` | authenticated | ModelController | Retrieves all available AI provider names from the database. |
| GET | `/api/v1/models/supported` | authenticated | ModelController | Retrieves the list of supported model names grouped by media type. |
| GET | `/api/v1/pipeline/interceptors` | authenticated | PipelineController | Retrieves all pipeline interceptor configurations ordered by execution order. |
| PUT | `/api/v1/pipeline/interceptors` | authenticated | PipelineController | Bulk-updates pipeline interceptor ordering and enabled state. |
| POST | `/api/v1/pipeline/interceptors/reset` | authenticated | PipelineController | Resets all pipeline interceptor configurations to hardcoded defaults. |
| GET | `/api/v1/pipeline/validation` | authenticated | PipelineController | Retrieves all validation pipeline tier configurations ordered by execution order. |
| PUT | `/api/v1/pipeline/validation` | authenticated | PipelineController | Bulk-updates validation pipeline tier ordering and enabled state. |
| GET | `/api/v1/status/graph` | ADMIN + USER | StatusController | Compiles and outputs the operations graph. |
| GET | `/api/v1/status/health` | public | StatusController | Returns sovereign readiness health details (public probe). |
| GET | `/api/v1/status/infrastructure` | authenticated | StatusController | Returns the current online/offline snapshot of the local inference engines. |

## edge

| Method | Path | Access | Controller | Summary |
|:---|:---|:---|:---|:---|
| ANY | `/**` | ⚠ no rule | ProxyController | Catch-all proxy entry point — everything not served by the edge itself is forwarded. |

## identity-service

| Method | Path | Access | Controller | Summary |
|:---|:---|:---|:---|:---|
| GET | `/api/v1/api-keys` | authenticated | ApiKeyController |  |
| POST | `/api/v1/api-keys` | authenticated | ApiKeyController |  |
| DELETE | `/api/v1/api-keys/{id}` | ADMIN + USER | ApiKeyController |  |
| POST | `/api/v1/auth/forgot` | public | AuthController | Forgot password endpoint. |
| POST | `/api/v1/auth/login` | public | AuthController | Login endpoint. |
| POST | `/api/v1/auth/oauth` | public | AuthController | OAuth2 Token-Exchange login endpoint. |
| POST | `/api/v1/auth/register` | public | AuthController | Register endpoint. |
| POST | `/api/v1/auth/reset` | public | AuthController | Reset password endpoint. |
| POST | `/api/v1/auth/verify` | public | AuthController | Verifies the provided account activation token. |
| GET | `/api/v1/credentials` | authenticated | CredentialController |  |
| POST | `/api/v1/credentials` | authenticated | CredentialController |  |
| DELETE | `/api/v1/credentials/{providerName}` | ADMIN + USER | CredentialController |  |
| GET | `/api/v1/interceptions/{schemaId}` | authenticated | InterceptionController | Returns the raw interception schema JSON for the given schema id, served as text so the JSON string is not double-encoded by Jackson (the client parses it). |
| POST | `/api/v1/interceptions/resolve` | authenticated | InterceptionController | Resolves an active interception by merging the user's responses. |
| GET | `/api/v1/profile` | authenticated | ProfileController | Returns the authenticated user's profile. |
| PUT | `/api/v1/profile/preferences` | ADMIN + USER | ProfileController | Updates the authenticated user's preference map and returns the refreshed profile. |
| GET | `/internal/v1/tiers/{key}` | SERVICE | InternalUserController | Bucket parameters of a rate-limit tier. |
| GET | `/internal/v1/tiers/default` | SERVICE | InternalUserController | The DB-flagged default rate-limit tier (anonymous callers). |
| POST | `/internal/v1/tokens/exchange` | SERVICE | InternalUserController | Exchanges a valid oz_ API key for a session JWT (performed by the edge). |
| GET | `/internal/v1/users/{id}` | SERVICE | InternalUserController | Full user snapshot for downstream principal hydration (404 via UserNotFoundException). |
| GET | `/internal/v1/users/{id}/credentials/{provider}` | SERVICE | InternalUserController | The user's decrypted BYOK provider key (service-to-service only). |
| GET | `/internal/v1/users/{id}/profile` | SERVICE | InternalUserController | The user's profile for pipeline context assembly. |

## job-service

| Method | Path | Access | Controller | Summary |
|:---|:---|:---|:---|:---|
| DELETE | `/internal/v1/capabilities/{featureKey}` | SERVICE | CapabilityController | Removes one capability. |
| PUT | `/internal/v1/capabilities/{featureKey}` | SERVICE | CapabilityController | Registers or replaces one capability a pack contributes. |
| GET | `/internal/v1/capabilities/{featureKey}/route` | SERVICE | CapabilityController | Resolves where one capability's work is executed. |
| POST | `/internal/v1/workers` | SERVICE | WorkerController | Registers a worker, or refreshes what is known about it. |
| POST | `/internal/v1/workers/{workerName}/heartbeat` | SERVICE | WorkerController | Records a heartbeat from an already-registered worker. |

## knowledge-service

| Method | Path | Access | Controller | Summary |
|:---|:---|:---|:---|:---|
| POST | `/internal/v1/knowledge/retrieve` | SERVICE | KnowledgeController | Semantic RAG retrieval over the vector store. |
| POST | `/internal/v1/knowledge/sources/search` | SERVICE | KnowledgeController | Substring search over a tool's registered RAG sources. |

## studio-service

| Method | Path | Access | Controller | Summary |
|:---|:---|:---|:---|:---|
| GET | `/api/v1/studios` | authenticated | StudioController | The catalogue, optionally narrowed to one profession. |
| GET | `/api/v1/studios/{studioKey}` | authenticated | StudioController | One Studio's detail, including the schemas its forms are generated from. |
| GET | `/api/v1/studios/{studioKey}/blueprints` | authenticated | StudioBlueprintController | Every version of a Studio, drafts included — the Builder's version list. |
| DELETE | `/api/v1/studios/{studioKey}/blueprints/{version}` | authenticated | StudioBlueprintController | Deprecates a version without deleting it. |
| PUT | `/api/v1/studios/{studioKey}/blueprints/{version}` | authenticated | StudioBlueprintController | Creates or replaces a draft version. |
| POST | `/api/v1/studios/{studioKey}/blueprints/{version}/publish` | authenticated | StudioBlueprintController | Publishes a draft, minting it as the Studio's latest version. |
| POST | `/api/v1/studios/{studioKey}/installations` | authenticated | StudioInstallationController | Installs a Studio, pinning its newest published version. |
| POST | `/api/v1/studios/{studioKey}/runs` | authenticated | StudioRunController | Starts a run of a Studio, addressed by its key rather than by an installation. |
| GET | `/api/v1/studios/{studioKey}/versions` | authenticated | StudioController | A Studio's version history. |
| GET | `/api/v1/studios/composer` | authenticated | StudioController | The Studios that belong in a chat composer, for this actor. |
| GET | `/api/v1/studios/installations` | authenticated | StudioInstallationController | "My Studios". |
| DELETE | `/api/v1/studios/installations/{installationId}` | authenticated | StudioInstallationController | Uninstalls, keeping the configuration for a future reinstall. |
| GET | `/api/v1/studios/installations/{installationId}` | authenticated | StudioInstallationController | One installation. |
| PATCH | `/api/v1/studios/installations/{installationId}` | authenticated | StudioInstallationController | Replaces an installation's configuration. |
| POST | `/api/v1/studios/installations/{installationId}/runs` | authenticated | StudioRunController | Starts a run. |
| POST | `/api/v1/studios/installations/{installationId}/upgrade` | authenticated | StudioInstallationController | Moves the pin to the newest published version — never automatic. |
| GET | `/api/v1/studios/packs` | authenticated | PackCatalogController | The marketplace, optionally narrowed to one shelf. |
| GET | `/api/v1/studios/packs/{packKey}` | authenticated | PackCatalogController | One Pack's detail. |
| POST | `/api/v1/studios/packs/bundles` | authenticated | PackBundleController | Installs a bundle. |
| DELETE | `/api/v1/studios/packs/bundles/{bundleKey}` | authenticated | PackBundleController | Removes a bundle's catalogue rows and withdraws its pack from sale. |
| POST | `/api/v1/studios/packs/bundles/validation` | authenticated | PackBundleController | Checks a bundle against this platform without writing anything. |
| GET | `/api/v1/studios/packs/categories` | authenticated | PackCatalogController | The shelves themselves, so the client renders headings it did not have to invent. |
| GET | `/api/v1/studios/runs` | authenticated | StudioRunController | This actor's run history. |
| GET | `/api/v1/studios/runs/{runId}` | authenticated | StudioRunController | One run with its per-step states and outputs. |
| POST | `/api/v1/studios/runs/{runId}/approve` | authenticated | StudioRunController | Resolves an approval step, resuming the run. |
| POST | `/api/v1/studios/runs/{runId}/cancel` | authenticated | StudioRunController | Cancels a run and releases its hold. |
