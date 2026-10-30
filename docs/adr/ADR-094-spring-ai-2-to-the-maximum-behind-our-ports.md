---
title: "ADR-094 — Use Spring AI 2 to the maximum, behind our ports"
description: "Spring AI 2 now ships what we half-wrote or did not have: the tool loop as a component, MCP client and server on the official SDK, structured-output validation, Micrometer observations with token metrics, provider prompt caching, evaluators and modular RAG. We adopt them inside orazaka-adapter-spring-ai, behind our ports, with ADR-092's ArchUnit rules unchanged. We keep what is ours: the run graph, routing as data, access at retrieval, controls, memory and its retention. Experimental agents go to Krizaka Lab; message parts and session memory wait for 2.1 GA; agents in core wait for 3.0."
category: ADR
order: 94
---

# ADR-094 — Use Spring AI 2 to the maximum, behind our ports

- **Status**: Proposed (2026-10-29). Slices in §6, each test-first.
- **Date**: 2026-10-29
- **Input**: a summary of the Spring AI roadmap pasted by Oussama (2026-10-29), verified claim by claim against the
  primary sources (spring.io, the GitHub releases and milestones of spring-projects/spring-ai, docs.spring.io, the
  Embabel repository). The table of verdicts and a French draft article are on the Feature,
  [krizaka/orazaka#485](https://github.com/krizaka/orazaka/issues/485).
- **Builds on**: [ADR-030](ADR-030-spring-ai-2-universal-proxy-dynamic-router.md) (Spring AI 2, universal proxy,
  dynamic router), [ADR-092](ADR-092-own-the-core-integrate-the-edges.md) (own the core, integrate the edges; Spring AI
  in one adapter), [ADR-086](ADR-086-durable-agent-sessions-on-studio-runs.md) (durable agent sessions),
  [ADR-087](ADR-087-grounded-research.md) (grounded research), [ADR-091](ADR-091-access-at-retrieval-and-at-the-tool.md)
  (access at retrieval and at the tool), [ADR-083](ADR-083-client-connectivity-and-capacity.md) (Studios as an MCP
  server), ADR-033 (hold → settle), ADR-064 (no user content in logs), ADR-072 (a ruleset is a test suite).

## 1. Decision

ADR-092 drew the line: **a pure Java 21 domain, Spring AI in `orazaka-adapter-spring-ai`**, implementing our ports. That
line holds. This ADR says what we put **on the adapter's side of the line**: everything Spring AI 2 does well and
maintains for us, instead of our own half-versions or nothing.

Three rules:

1. **The framework does the mechanics, we do the policy.** The tool loop, schema validation and retry, provider
   caching directives, observations, query rewriting and evaluators are mechanics: Spring AI's. Who may call what, how
   much it costs, what is retained, which model serves which feature, when a human decides: ours, in the database.
   An advisor never holds a policy; it receives one, read from our rows, through our port.
2. **Behind our ports, always.** Core and business see `ChatInvocation`, `StructuredOutputClient`, `ToolResolution`,
   `ChatMemoryStore`, `EmbeddingClient`, a new `OutputJudge`, never a Spring AI type. `ChatClient` may be used **inside**
   the adapter as the implementation of a port. ADR-092's two ArchUnit rules and their ratchet are unchanged.
3. **Released, trusted, swappable.** We adopt released 2.0.x now; 2.1 at GA; nothing experimental in production. Spring
   AI is Apache-2.0, maintained by the Spring team at Broadcom, on the official MCP Java SDK that the same team
   maintains: it passes the « trusted open source first » rule. No second connector stack (ADR-092 §5 still refuses
   LangChain4j and LangGraph4j).

## 2. What the sources say (checked 2026-10-29)

- **Released**: 2.0.0 GA on 2026-06-12 (Boot 4.0 / 4.1, Framework 7.0, JSpecify everywhere, Jackson 3); 2.0.1 on
  2026-08-21; **2.0.2 and 2.1.0-RC1 on 2026-10-23**. GitHub milestone `2.1.0` is due **2026-11-19**, on Boot 4.2.
- **Java**: Boot 4 needs Java 17+ (up to 27). We stay on 21 by choice.
- **Tool calling**: 2.0 removed the loop from every `ChatModel` (`internalToolExecutionEnabled` is gone); the loop is
  `ToolCallingAdvisor` on `ChatClient`, or `ToolCallingManager` by hand. `ToolSearchToolCallingAdvisor` exposes tools
  progressively. 2.1.0-RC1 adds tool call confirmation.
- **MCP**: the official MCP Java SDK (2.0 targets the 2025-11-25 spec; 2026-07-28 in progress); client and server
  starters (`spring-ai-starter-mcp-client`, `-mcp-server-webmvc`…), `@McpTool` / `@McpResource` / `@McpPrompt`,
  **Streamable HTTP by default, SSE deprecated**, stateless servers (customizers in 2.0.2), `McpToolFilter`, MCP security
  docs.
- **Structured output**: `StructuredOutputValidationAdvisor` validates against the schema and self-corrects (a bug
  repeating tool calls fixed in 2.0.2).
- **Observability**: Micrometer observations `gen_ai.client.operation`, `spring.ai.chat.client`, `spring.ai.advisor`,
  `spring.ai.tool`, `db.vector.client.operation`; the counter `gen_ai.client.token.usage` with cache read/creation
  attributes; prompt and completion logging **off by default**; no cost metric.
- **Prompt caching**: per provider options (`AnthropicChatOptions`, `BedrockCacheOptions`); no generic cache.
- **Guardrails**: only `SafeGuardAdvisor` (sensitive words in the output). **Nothing against prompt injection.**
- **Evaluators**: `RelevancyEvaluator` and `FactCheckingEvaluator` (since 1.x), nothing else.
- **RAG**: modular stages (`RewriteQueryTransformer`, `CompressionQueryTransformer`, `MultiQueryExpander`,
  `DocumentRetriever`, `DocumentJoiner`, `DocumentPostProcessor`, `ContextualQueryAugmenter`), ~20 vector stores including
  PGVector, `VectorStore.upsert()` (2.1). **No hybrid search, no built-in reranker** (a post-processor hook).
- **Memory**: `ChatMemory` repositories (in-memory, JDBC, Cassandra, MongoDB, Neo4j, Redis) — **deprecated in 2.1.0-RC1**
  in favour of session memory (an event log with turn-aware compaction). Message parts (ordered text, reasoning, tool
  calls, tool results, media) arrive in 2.1; RC1 migrated OpenAI and DeepSeek.
- **Agents**: the agentic support is announced for **November 2026 as a Spring Projects Experimental project**, to merge
  into **Spring AI 3.0 mid-2027**. The community « Spring AI Agents » (`AgentClient` over CLI coding agents, 2025) is a
  different thing. **Embabel** (Apache-2.0, Kotlin, GOAP planner, built on Spring AI) keeps its own governance: its README
  says contributing it to Spring is not planned. There is no announced convergence.
- **Models**: OpenAI, Anthropic, Google GenAI (Gemini), Bedrock, Mistral, DeepSeek, Ollama. The Azure OpenAI module was
  removed in 2.0.

## 3. What Orazaka uses today (checked on orazaka-ai-engine main `fd3db42`, 2026-10-29)

| Area | Spring AI 2 offers | Orazaka today | Gap |
| :--- | :--- | :--- | :--- |
| Model calls | `ChatModel`, `ChatClient` + advisors | `ChatModel` called directly by `SpringAiChatInvocation`; models built per call from the DB (`DynamicModelRouter`, `UniversalProxyChatProvider`, `*DynamicProvider`); no `ChatClient`, no advisor | Fine for routing; we miss every advisor |
| Tool loop | `ToolCallingManager` / `ToolCallingAdvisor` | One model call per turn; `AbstractEngine.chat` returns only **client** tool calls (ADR-093). No `ToolCallingManager`, no `executeToolCalls` in main | **Server-side tools are offered but probably never run since 2.0** — slice 1 proves it with a failing test |
| Tools, access | `ToolCallback`, `FunctionToolCallback` | `SpringAiToolRegistry`, `ActorBoundToolCallback`, `CachingToolCallback` (scope in the key), `ClientToolCallback`, roles as rows (ADR-091) | Ours, keep |
| MCP client | SDK client, Streamable HTTP, `McpToolFilter` | `SpringAiToolResolution` builds SDK clients (platform and user servers, sealed tokens) over **`HttpClientSseClientTransport`** (deprecated) or stdio | Move to Streamable HTTP (orazaka-ai-engine#65) |
| MCP server | starters, `@McpTool`, stateless | None in Java; `.agent/mcp-server` is a TypeScript dev tool | orazaka#239 |
| Structured output | `StructuredOutputValidationAdvisor`, native JSON schema | `SpringAiStructuredOutputClient`: `BeanOutputConverter`, one attempt | Validation and bounded retry |
| Observability | gen_ai observations and token counter | `DynamicPipelineExecutor` timers (Micrometer, no Spring); no `ObservationRegistry` passed to any model | Wire it |
| Prompt caching | provider cache options, cache token attributes | None; `TokenUsage` has no cached field | Cost |
| Guardrails | `SafeGuardAdvisor` (word list) | `ScopeGuardInterceptor`, `ResponseScreen`, `JudgeGuard`, ADR-087's SSRF and injection guards, ADR-093's fenced data channel | **Ours are stronger; keep** |
| Memory | `ChatMemory` (deprecated in 2.1), session memory (2.1) | `ChatMemoryStore` port, `PersistedChatMemoryStore` on our Postgres table, best effort, `findRecent(limit)` by count, flat text | Compaction and parts at 2.1 |
| RAG | modular stages, `PgVectorStore` | `RagInterceptor`; `orazaka-knowledge-service` hand-written JDBC on pgvector with its own embedding client, ACL in the query (ADR-091), `LIKE` text search (knowledge-service#6); `PgVectorSemanticCacheStore` | Query stages and rerank; hybrid stays ours |
| Evaluators | `RelevancyEvaluator`, `FactCheckingEvaluator` | None; ADR-087's deterministic citation verifier | Golden suites, level-2 judge |
| Run graph, agents | (Nov 2026, experimental) | Studio blueprint DAG, saga, approvals, ADR-086 sessions | Ours, keep |
| Build | 2.0.2 | `spring-ai.version` 2.0.1 in orazaka-parent; **`orazaka-core/pom.xml` still declares eight `spring-ai-*` and four Spring modules at compile scope** although no main class imports them (ADR-092 rule 1 wants the pom clean) | Slice 2 |

## 4. Decisions by area

### 4.0 Version and build
Adopt **2.0.2 now**. Move the Spring and Spring AI dependencies of `orazaka-core` out of compile scope and add a build
guard so they cannot return (ArchUnit catches an import, not a dependency). 2.1 lands only at GA, with Boot 4.2, in one
PR after krizaka-parent moves.

### 4.1 The tool loop — adopt now
`SpringAiChatInvocation` runs the loop with Spring AI's `ToolCallingManager` (sync and stream). Our gates stay in front:
`ToolResolution` decides what is offered (ADR-091 roles, READ_ONLY for grounded research), `ActorBoundToolCallback`
runs as the actor, client tools refuse to run on the engine (ADR-093). Max rounds per turn are a row; each round's usage
is summed into the one hold of the turn. We do not move the engine onto `ChatClient` wholesale: our interceptor pipeline
(context, cache, governance, screening, metering) is the policy and stays ours.

### 4.2 Agent loops, planning, the experimental agents — ours, then the lab
The **Studio blueprint is the run graph** (ADR-092 §3) and ADR-086 sessions are the agent model; no second run state.
Spring AI's agentic project (Nov 2026, experimental) is **prototyped in Krizaka Lab** against a Studio run, never a
dependency before Spring AI 3.0 and a new ADR. Embabel is read for ideas (GOAP preconditions and effects,
orazaka-studio#89), not adopted: Kotlin, its own governance, and it would own planning state. Tool search
(`ToolSearchToolCallingAdvisor`) is measured in the lab first, then adopted behind `ToolResolution` if it wins.

### 4.3 Evaluators — adopt now, in CI and behind a port
Golden cases (grounded research, knowledge RAG, pack rulesets) are judged by `FactCheckingEvaluator` /
`RelevancyEvaluator` on a **local** judge model named by a catalogue row, in an opt-in or nightly job; the deterministic
checks remain the required gate. In production, an `OutputJudge` port with a Spring AI `Evaluator` adapter is the level-2
judge of the control loop (orazaka-ai-engine#114), always after level 1 (ADR-092 §4 rule 6).

### 4.4 MCP — client and server on the official SDK
- **Client**: Streamable HTTP for platform and user servers (SSE kept only for a server that offers nothing else, read
  from the server's row); `McpToolFilter` applies the READ_ONLY and role filters we already compute; the clients stay
  built from DB rows with sealed tokens. Tracked by orazaka-ai-engine#65.
- **Server**: the Studios a key may run are exposed as MCP tools with Spring AI's MCP server (WebMVC, **stateless**
  Streamable HTTP, `@McpTool` or the programmatic spec) in an adapter module behind the edge; every spending call goes
  through the run path (idempotency key, credit hold, approvals), descriptions are ours, per-key limits apply, and the
  threat note of ADR-083 comes first. Tracked by orazaka#239.

### 4.5 Observability — adopt now
Every model the adapter builds gets the host's `ObservationRegistry`: latency, `gen_ai.client.token.usage`, tool and
vector-store observations, OpenTelemetry spans through Micrometer Tracing. Content logging stays off and is pinned by a
test (ADR-064). **Money stays on our metering** (`TokenUsage`, `ChatTokenMeter`, ADR-033); the gen_ai counter is for
operations and a daily reconciliation. Metric tags are low-cardinality (provider, model, feature key, lane), never a
tenant or user id. The backend and dashboards are orazaka#12 and orazaka#323.

### 4.6 Structured output — adopt now
The `StructuredOutputClient` port is implemented with `ChatClient` + `StructuredOutputValidationAdvisor` inside the
adapter: schema validation, re-ask with the error, attempts bounded by a row, a typed failure that feeds the control
loop. Native JSON-schema mode when the model's catalogue row says the provider supports it.

### 4.7 Prompt caching — adopt now
A cache policy per catalogue model (on/off, which prefix, TTL) drives the provider's cache options; `TokenUsage` carries
cache-read and cache-write tokens; billing meters them at their own pricebook unit. Never for a prefix holding user
content of a SENSITIVE turn. Local prefix caching (vLLM, SGLang) is orazaka#343.

### 4.8 Guardrails — ours
`SafeGuardAdvisor` is a word list on the output; it does not address prompt injection. Our screens and ADR-087/093 guards
stay the defence; we do not add `SafeGuardAdvisor`. If Spring AI ships a real injection defence, it is evaluated in the
lab against our cases first.

### 4.9 Memory and sessions — ours, framework compaction at 2.1
We never adopt `ChatMemory` (deprecated in 2.1). Our `ChatMemoryStore` port and Postgres table stay the record
(retention by class, ADR-065/078; the actor's scope). At 2.1 GA, the adapter uses session memory's turn-aware compaction
strategies under a policy row (token budget per model), and memory persists **message parts**. Conversation sessions are
not our run sessions: ADR-086 stays the durable agent session.

### 4.10 Message parts — at 2.1 GA
`EngineMessage` gains ordered parts as our records (text, reasoning, tool call, tool result, media); the adapter maps
Spring AI's parts both ways. Tool call confirmation maps onto our approvals (ADR-086/093); our approval is the record.

### 4.11 RAG — framework stages around our retriever
We adopt Spring AI's query stages (rewrite, multi-query, contextual augmentation with the « I don't know » path) and a
rerank `DocumentPostProcessor` on a catalogued local reranker, each switched on per feature key and kept only if it wins
on the golden cases. **The retriever stays ours**: hybrid search (Postgres full text + pgvector, fused by reciprocal rank)
with the ACL in the query before ranking (ADR-091), in `orazaka-knowledge-service` (knowledge-service#6). Spring AI's
`PgVectorStore` is not used for knowledge: its filter is metadata on its own table, not our access model.

## 5. What we do not adopt, and why

- **Spring AI types in core or business.** ADR-092 §4 rules 1–2, unchanged.
- **`ChatClient` as the engine.** The engine's pipeline is our policy; `ChatClient` is an implementation detail of ports.
- **`ChatMemory` and its repositories.** Deprecated in 2.1; our table carries retention and scope.
- **`PgVectorStore` for knowledge, `SafeGuardAdvisor`.** §4.11, §4.8.
- **Experimental agents, Embabel, LangGraph4j in production.** §4.2; ADR-092 §5. The langgraph4j spike
  (orazaka-ai-engine#44) is closed as not planned.
- **One vendor.** Every provider-specific option (cache, reasoning, Responses API) is a catalogue row; the default path
  works on any OpenAI-compatible endpoint (ADR-030).

## 6. Slices

Each slice is one issue, test-first, sub-issues of [krizaka/orazaka#485](https://github.com/krizaka/orazaka/issues/485).

| # | Slice | When | Issue |
| :--- | :--- | :--- | :--- |
| 1 | The engine runs the server-side tool loop (`ToolCallingManager` in the adapter), failing test first | Now (2.0.x) | [orazaka-ai-engine#169](https://github.com/krizaka/orazaka-ai-engine/issues/169) |
| 2 | Spring AI 2.0.2; core pom without Spring, with a build guard | Now | [orazaka-ai-engine#170](https://github.com/krizaka/orazaka-ai-engine/issues/170) |
| 3 | Micrometer observations on every model, content off, reconciliation with billing | Now | [orazaka-ai-engine#171](https://github.com/krizaka/orazaka-ai-engine/issues/171) |
| 4 | Structured output validated and self-corrected, bounded by a row | Now | [orazaka-ai-engine#172](https://github.com/krizaka/orazaka-ai-engine/issues/172) |
| 5 | Prompt caching by catalogue row, cached tokens metered | Now | [orazaka-ai-engine#173](https://github.com/krizaka/orazaka-ai-engine/issues/173) |
| 6 | Evaluators on golden cases in CI; `OutputJudge` for the level-2 judge | Now | [orazaka-ai-engine#174](https://github.com/krizaka/orazaka-ai-engine/issues/174) |
| 7 | Modular RAG stages and rerank around our retriever | Now | [orazaka-ai-engine#175](https://github.com/krizaka/orazaka-ai-engine/issues/175) |
| — | MCP client on Streamable HTTP, `McpToolFilter` | Now | [orazaka-ai-engine#65](https://github.com/krizaka/orazaka-ai-engine/issues/65) (amended) |
| — | Studios as an MCP server (stateless, WebMVC starter) | Now | [orazaka#239](https://github.com/krizaka/orazaka/issues/239) (amended) |
| — | Hybrid retrieval (full text + pgvector, RRF, ACL first) | Now | [orazaka-knowledge-service#6](https://github.com/krizaka/orazaka-knowledge-service/issues/6) (amended) |
| 8 | Spring AI 2.1: message parts, session-memory compaction, tool call confirmation | **At 2.1 GA** | [orazaka-ai-engine#176](https://github.com/krizaka/orazaka-ai-engine/issues/176) |
| Lab | Experimental agents and tool search against a Studio run, report only | Nov 2026, Krizaka Lab | [krizaka-lab#72](https://github.com/krizaka/krizaka-lab/issues/72) |
| — | Agents in core | **At Spring AI 3.0** (mid-2027), new ADR | — |

Order: 2 and 1 first (1 is a probable regression), then 3, 4, 6; 5 and 7 when 3 and 6 can measure them.

## 7. Consequences

- We delete code instead of writing it: the structured-output retry, the missing tool loop, the absent token metrics.
- The adapter grows; core does not. The ArchUnit ratchet still only goes down.
- A Spring AI upgrade is a single-module change, tested by the adapter's tests and the golden suites.
- The engine's cost becomes visible twice (billing for money, gen_ai metrics for operations), and the two are reconciled.
