# ADR-030 — Spring AI 2.0 / Boot 4 upgrade + Universal Proxy Client & Dynamic Model Router (DB-driven, no provider starters)

- **Status**: Accepted (implementation in progress — completes on the local build loop)
- **Date**: 2026-06-16
- **Scope**: `products/orazaka` — root `pom.xml`, `orazaka-router`, `orazaka-core` (model wiring), `application.yml`
- **Supersedes/extends**: ADR-027 (DB single-source config), ADR-029 (DB-driven providers — this ADR takes it from "documented" to "enforced by removing the yaml/starters")
- **Overrides**: AGENTS.md §11 (Spring Boot pinned to the 3.5.0 GA line) — see *Consequences*.

## Context

Spring AI **2.0.0 GA** (2026-06-12) requires **Spring Boot 4.0/4.1 + Spring Framework 7 + Jackson 3**
(no Spring Boot 3.5 compatibility). The team chose to adopt it for the programmatic, provider-agnostic
model API (2.0 consolidates providers and centres on `ChatClient` + `*.builder()`), and to **take back
control of provider wiring**: load *everything* from the DB and drop the Spring AI provider **starters**
so there is no hidden autoconfiguration. This realises the "full dynamic" option that ADR-029 had
deferred, now cheap to do because 2.0's builder API makes programmatic client construction first-class.

## Decision

### 1. Platform upgrade
- `spring-boot.version` 3.5.0 → **4.0.0**; `spring-ai.version` 1.1.6 → **2.0.0** (BOM
  `org.springframework.ai:spring-ai-bom:2.0.0`). Java 21 baseline already satisfies Spring 7.

### 2. Drop the provider starters
- Remove `spring-ai-starter-model-ollama` and `spring-ai-starter-model-openai` from
  `orazaka-router/pom.xml`. Keep the model **libraries** (`spring-ai-ollama`, `spring-ai-openai`,
  `spring-ai-anthropic`, `spring-ai-google-genai`) in `orazaka-core` for their `*.builder()` classes.
- `application.yml`: removed the entire `spring.ai.*` provider block, the
  `spring.autoconfigure.exclude` OpenAI list (nothing to exclude without starters), and
  `orazaka.core.default-provider`.

### 3. Universal Proxy Client
A single **OpenAI-compatible** client builder is the universal proxy: every local provider exposes an
OpenAI-compatible endpoint (Ollama via `/v1`, LocalAI, …), so
`OpenAiApi.builder().apiKey(<db>).baseUrl(<db>)` + `OpenAiChatModel.builder().openAiApi(api)
.defaultOptions(...)` reaches **any** provider by base-url. (Native `OllamaChatModel.builder()` remains
available where the native API is preferred.) This mirrors the existing
`OpenAiDynamicProvider`/`DynamicChatModelProvider` strategy — extended with a `baseUrl`.

### 4. Dynamic Model Router
A `DynamicModelRouter` resolves a client **on demand** from the DB, replacing
`AiModelConfiguration`'s static `@Primary` `ChatModel`/`ImageModel`/`TextToSpeechModel` beans:
1. Input: capability `category` (chat/image/speech/…) + optional `modelName` (the user's
   `orazaka_user_model_prefs` choice, else the catalog default).
2. Look up the model in `orazaka_models` (`model_name` → `provider_name`, `category`) and the default
   via `is_default`.
3. Look up the provider's `base_url` / `api_key` in `ai_providers`
   (reuse `CatalogModelManager.getProviderBaseUrl`).
4. Build the client via the Universal Proxy Client (cache per `(provider, model)`).
- The default provider/model is therefore **`orazaka_models.is_default`** (per category) — no
  `default-provider` yaml. An admin edits `ai_providers` / `orazaka_models` and runtime follows with no
  redeploy.
- **Placement / boundary**: the router needs DB reads, so it depends on a core **outbound port**
  (e.g. `ModelClientResolver` / extend `DynamicChatModelProvider`) whose adapter reads the catalog —
  keep core hexagon-clean (no direct persistence import); the adapter lives where `CatalogModelManager`
  is reachable. Confirm against ArchUnit `GovernanceTest` / `CrossModuleBoundaryTest`.

## Migration map (verified coordinates + this codebase's breaking-change surface)

| Area | What changes | Surface here |
|------|--------------|--------------|
| **Jackson 2 → 3** | `com.fasterxml.jackson` → `tools.jackson`; prefer `JacksonUtils.getDefaultJsonMapper()` / `JsonHelper`. | **26 files** import `com.fasterxml.jackson`. |
| **Model/options API** | `ChatClient.options(builder)` (not built); `copy()` → `mutate().build()`; `ChatModel.call()` still takes built options. | **49 files** use `ChatModel`/`ImageModel`/`*Options`. |
| **Provider wiring** | `defaultProvider` / `LocalAiConfig` / `spring.ai.*` gone → resolve via `DynamicModelRouter` from the DB. | `AiModelConfiguration`, `CoreConfiguration`, `CoreProperties`, `Engine`/`AbstractEngine`, `EnginePipelineBridge`/`EngineStreamBridge`, `OllamaModelCatalogProvider` (~10). |
| **Tool calling** | `ToolCallingAdvisor` auto-registered; `@Tool` POJOs; removed `.internalToolExecutionEnabled()`, `SpringBeanToolCallbackResolver`, `.toolNames()`. | `orazaka-tools` + interceptor `tooling/`. |
| **Chat memory** | `conversationId` required at call time (`ChatMemory.CONVERSATION_ID`); no `DEFAULT_CONVERSATION_ID`. | chat memory advisors. |
| **MCP** | MCP merged into Spring AI core + first-class `@McpTool` annotations — opportunity to simplify `orazaka-tools` MCP. | `orazaka-tools`, `spring-ai-mcp`. |
| **Spring Boot 4 / Spring 7** | Jakarta EE 11, security/web/data/test changes. | whole stack (compile-driven). |

## Consequences
- **Positive**: providers fully DB-controlled (admin-piloted, no redeploy, no drift); fewer deps (two
  starters dropped); aligns with ADR-027/029; 2.0's `ChatClient`/advisors simplify tool-calling + MCP.
- **Cost / risk**: a **full-platform migration** — not verifiable in the no-CI local phase from a single
  pass; **completes only against a working compile/test loop** (26 Jackson files + 49 model-API files +
  ~10 provider-config files + Boot 4 fallout). Ships incrementally.
- **§11 update required**: AGENTS.md §11 still says "Spring Boot pinned to 3.5.0 GA". Update it to the
  Boot 4.0 line (GA, no `-SNAPSHOT`) to reflect this ADR.

## Verified build findings (`./mvnw clean compile`, run 2026-06-16)

Running the build confirmed the coordinates and surfaced the real first walls (`javap` on the 2.0 jars,
not migration notes, is the source of truth):

1. **Coordinates resolve** — Spring Boot `4.0.0` + Spring AI `2.0.0` GA (+ Spring Session 4, Spring WS 5,
   Testcontainers 2) download from Central. The pom bump is valid.
2. **Boot 4 removed `spring-boot-starter-aop`** (only `4.0.0-M1/M2` exist, no GA). Fixed: replaced it in
   `orazaka-tools/pom.xml` + `orazaka-router/pom.xml` with `org.aspectj:aspectjweaver` (BOM-managed,
   `1.9.25`); `AopAutoConfiguration` (core) enables `@Aspect` proxying when it's present.
   (`orazaka-tools/sandbox/SandboxAspect` is a real `@Aspect @Around`.)
3. **Spring AI 2.0 rewrote the OpenAI integration on the official `com.openai` Java SDK** — bigger than the
   notes implied. Verified via `javap`: `org.springframework.ai.openai.api.OpenAiApi` is **gone**, and
   `OpenAiChatModel.Builder` no longer has `.apiKey()/.baseUrl()/.openAiApi()` — it now takes
   `.openAiClient(com.openai.client.OpenAIClient)` + `.options(OpenAiChatOptions)`. `spring-ai-openai:2.0.0`
   pulls only `com.openai:openai-java-core` (the okhttp client builder `OpenAIOkHttpClient` is the separate
   `com.openai:openai-java-client-okhttp` artifact — **must be added**). **Target construction**:
   `OpenAIClient c = OpenAIOkHttpClient.builder().apiKey(key).baseUrl(url).build();`
   `OpenAiChatModel.builder().openAiClient(c).options(OpenAiChatOptions.builder().model(name).build()).build();`
   (verify the okhttp builder method names by `javap` once the artifact is on the classpath.)
   **Affected**: `UniversalProxyChatProvider`, `OpenAi/Anthropic/GeminiDynamicProvider`,
   `ImageGeneratorClientImpl`, and `AiModelConfiguration` (the latter is **deleted** here, replaced by the
   `DynamicModelRouter`). Jackson 3 (26 files) + Boot 4 fallout are still downstream of this.

## Local-completion checklist
1. `./mvnw -q -DskipTests clean compile` → fix Jackson-3 + Spring-AI-2 + Boot-4 errors iteratively.
2. Implement `UniversalProxy(OpenAI-compatible) provider` + `DynamicModelRouter`; delete
   `AiModelConfiguration` static beans + the `LocalAiConfig`/`defaultProvider` plumbing.
3. `./mvnw test -pl orazaka-libs/orazaka-core -Dtest=GovernanceTest -am -Dsurefire.failIfNoSpecifiedTests=false` (ring rules still green).
4. `orazaka test it` / `e2e`; `node scripts/generate-docs.mjs --check`.
5. Update AGENTS.md §11 (Boot 4) and regenerate `docs/_generated/ADRS.md`.
