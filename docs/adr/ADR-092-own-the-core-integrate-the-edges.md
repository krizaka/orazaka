---
title: "ADR-092 — Own the core, integrate the edges"
description: "Orazaka owns its orchestration core and its control loop: the DAG, the router's policy, the hardware-aware dispatch, the control verdicts and live steering. It integrates protocols and connectors behind ports: Spring AI 2 for the models, the official MCP SDK through spring-ai-mcp, RabbitMQ and the Postgres outbox. The domain is pure Java 21: Spring AI moves to an orazaka-adapter-spring-ai module that implements our ports, and ArchUnit, behind a ratchet, keeps org.springframework out of core and business. No LangChain4j, no LangGraph4j, no StructuredTaskScope."
category: ADR
order: 92
---

# ADR-092 — Own the core, integrate the edges

- **Status**: Accepted — direction approved by Oussama on 2026-10-26. Slices below, each test-first.
- **Input**: an external LLM audit (2026-10-26) recommending a hybrid architecture, verified against the code by the CTO.
  What it got right, what it got wrong and what we refuse is in §2 and §5. A counter-review (2026-10-26, accepted by the
  CTO) tightened the boundary (§4 rule 1), the GPU arbiter (§3, §6), the steering edges (§4 rule 8), the Loi 25 record
  (§4 rule 7), the purity proof (§4 rule 3) and dropped `StructuredTaskScope` (§5).
- **Builds on**: [ADR-027](ADR-027-db-driven-configuration.md) and [ADR-029](ADR-029-db-driven-ai-providers.md)
  (policy is data), [ADR-030](ADR-030-spring-ai-2-universal-proxy-dynamic-router.md) (Spring AI 2 as the universal
  proxy), [ADR-086](ADR-086-durable-agent-sessions-on-studio-runs.md) (durable sessions, leases),
  [ADR-088](ADR-088-runs-as-background-tasks.md) (steering, heavy-job lock), [ADR-085](ADR-085-operator-audit-trail.md)
  (audit trail).
- **Issues**: §7 — P1 [orazaka-ai-engine#112](https://github.com/krizaka/orazaka-ai-engine/issues/112); P2 #113, #114, worker-media#83, studio#87, studio#88.

## 1. Decision

**We own what makes Orazaka Orazaka** — the graph a run follows, the policy that routes it, the scheduler that shares
one GPU, the loop that judges an output and the controls a human uses mid-run. **We integrate what the world already
standardised** — model APIs, MCP, the broker, the vector store, the diffusion runtimes — each behind a port of ours,
in one place.

Three consequences:

1. **A pure Java 21 domain, one door to Spring AI.** Spring AI lives in one adapter module,
   `orazaka-adapter-spring-ai`, which implements our ports (inference, embedding, structured output). No class in
   `..orazaka.core..` or `..orazaka.business..` depends on `org.springframework..`. ArchUnit enforces it behind a
   ratchet: the violations are counted and the count only goes down. No big bang.
2. **The core knows no product.** No scene, timeline, lease, creator or salon in `orazaka-core`. Packs and product
   wrappers are consumers. The proof is an Orazaka **pack** (`orazaka-packs/document-validation`, the lease checks)
   evolving with **no diff in `orazaka-core`**.
3. **Control is deterministic first, typed, and data-driven.** A cheap rule judges before a model does; every judgement
   is a typed verdict; thresholds and bounds are rows, not Java.

## 2. What the code says (checked 2026-10-26)

- **Spring AI is already in the core**, by choice (ADR-030, the Boot 4 / Spring AI 2 migration): `orazaka-core/pom.xml`
  depends on `spring-ai-model`, `-ollama`, `-openai`, `-anthropic`, `-google-genai`, `-mcp`, `-vector-store`, `-retry`.
  The audit's « Spring AI would break your agnostic core » is false: the core was never Spring-AI-free. The real
  problem is **where** it is imported:
  - `orazaka-core`: 36 main files, **22 of them outside `infrastructure`** (4 in `domain` —
    `InternalChatRequest`, `ChatMemoryStore`, `MemoryResolver`, `ToolRegistry` — and 18 in `application`, among them
    `PromptContextInterceptor`, whose `preProcess` takes Spring AI `Message` and `ChatOptions`).
  - `orazaka-interceptors`: 14 files (pom: `spring-ai-model`, `-ollama`, `-openai`); `orazaka-tools`: 2 files
    (`CachingToolCallback`, `DefaultToolRegistry`; pom: `spring-ai-model`).
  - `orazaka-business`, `orazaka-assets`, `orazaka-persistence-app`, `orazaka-persistence-bridge`: none.
  - In all, **52 main files** import Spring AI (36 + 14 + 2; 89 with the tests). Against the stricter rule (no
    `org.springframework..` at all), `orazaka-core` has **63** main files and `orazaka-business` **2** (Spring wiring:
    `@Component`, `@ConfigurationProperties`, `@Transactional`).
  - The products (Yomizaka, Akinaza…) are TypeScript and call the engine over its API: the classpath risk is
    engine-internal only.
  - The inbound port `AiClient` (`core.domain.ports.inbound`) is already clean: it speaks our `ChatRequest`,
    `ChatResponse`, `AudioRequest`, `ImageRequest` records.
- **MCP** goes through `spring-ai-mcp`, built on the official MCP Java SDK (`McpClientFactory`, `McpServiceImpl`,
  `McpInterceptor`). We do not implement the protocol.
- **The DAG is the Studio blueprint** (`orazaka-studio`): `BlueprintStep` carries `dependsOn`, `forEach` +
  `maxParallel`, `onError`, `maxAttempts`, `timeout`, `condition`, `outputContract` (ADR-076 subset) and the `APPROVAL`
  kind; `Blueprint` rejects cycles and dangling edges; `RunSagaService` advances it with compensation (`COMPENSATING`).
  The core's `DagCompiler` / `AdaptiveDag` / `IntentMesh` / `IntentClassifier` is a stub: two hard-coded task names,
  edges as strings, no executor, referenced by nothing outside itself.
- **Outbox**: `OutboxStore` (contracts), `OutboxStoreImpl`, `RelayOutboxStoreAdapter`, `OutboxEventEntity`
  (engine persistence-app), the job-service's unmetered-turn adapter.
- **GPU**: the media worker manages its own VRAM — `threading.Semaphore(1)` (`main.py`), `should_offload`
  (`wan_generator.py`), `empty_cache` and the resource guard (`telemetry.py`). `HostCapabilityDetector` and the model
  catalogue know the accelerator. **Nothing arbitrates between Ollama and the worker**: no call to Ollama's `/api/ps`,
  no `keep_alive` anywhere. The audit's « Ollama VRAM scheduler » is not existing IP. ADR-088 point 6 designed a
  heavy-job lock; it is not built. In production the media worker runs on a remote GPU (ADR-078): the two only
  contend when they share one machine (the Mac, a single GPU server).
- **Control loop**: `ClosedLoopValidationInterceptor` has four tiers (schema, MCP sandbox, critic-vs-advocate debate,
  test-driven response), ordered by the database (`ValidationPipelineRepository`). But it runs in `postProcess`
  (returns `void`): its retry loop re-validates **the same text** `maxRetries` times, never regenerates, and on
  exhaustion logs and serves the response. Tier B is a placeholder that always passes. No typed verdict, no drift
  score, no escalation, no episodic memory, no circuit breaker (resilience4j appears only in a comment of
  `DeterministicRouterEngine`).
- **Events and steering**: run events are SSE **snapshots** read from the database on an interval (`RunEventService`);
  `approve`, `resume {fromStep}` (dependents re-run, the others keep their outputs) and `cancel` (the whole run) exist;
  `job.cancel.<jobId>` stops one job. ADR-088's steering is designed, not built. The exact result cache is per run
  (`studio_run.input_fingerprint`, orazaka-studio#61), not per step.
- **The `orazaka-cinema` repository does not exist.** `StructuredTaskScope` is a **preview** API in Java 21.

## 3. Component → own / hybridize / integrate

| Component | Choice | Today | Decision |
| :--- | :--- | :--- | :--- |
| 1. Planner — DAG of typed nodes with an output contract and a control policy | **Own** | **Partial**: the Studio blueprint is a typed DAG with `outputContract` and `APPROVAL`; no per-node control policy; no intent decomposer; the core's `DagCompiler` is a stub | The blueprint **is** the DAG. Add a per-node control-policy reference (§4 rule 5). Delete the core's DAG stub. A planner that writes a blueprint from an intent is a consumer (a pack), not core; GOAP-style preconditions go to Incubation |
| 2. Router and capability matcher | **Own** the policy, **integrate** the providers | **Partial**: DB-driven `DynamicModelRouter` (ADR-029/030), `CapabilityRoutingAdapter`, `SemanticRouterInterceptor`; the job plane routes on `featureKey` to any worker on the broker (local or LAN). No routing on live hardware state | Keep; feed it the arbiter's state (component 3). A2A exposure: Incubation |
| 3. Parallel dispatcher with a hardware-aware scheduler | **Own** | **Partial**: fan-out with `maxParallel`, ADR-067's two lanes, the worker's own semaphore and offload. **Missing**: pools, weights, any arbitration with Ollama | A GPU arbiter **per device**: a `GpuLease` (`AutoCloseable`, TTL, heartbeat, forced revocation that kills a frozen subprocess), profiles `SHARED_LIGHT` and `EXCLUSIVE_HEAVY` over the pools (`VRAM_HEAVY`, `LLM_INFERENCE`, `CPU_IO`, `EXTERNAL_API`); before granting `EXCLUSIVE_HEAVY` it sends `keep_alive: 0` to Ollama and checks on `/api/ps` that the memory is freed; jobs of one DAG wave are batched by model affinity; a small model stays outside the heavy lock so the UI answers. It reuses the worker's VRAM management. It is ADR-088's heavy-job lock, generalised |
| 4. Control loop | **Own** | **Partial**: four tiers ordered by the DB; the step `outputContract`; the `APPROVAL` step. **Broken**: re-validates the same text, serves on exhaustion. **Missing**: verdict type, drift score, re-adjust with the diff, escalation, episodic memory, circuit breaker | `sealed interface ControlVerdict` and a deterministic-first loop (§4 rule 6), policies as rows |
| 5. Event bus and live steering | **Own** the semantics, **integrate** the transport | **Partial**: outbox + RabbitMQ, SSE snapshots, approve / resume-from-step / cancel-run, per-run exact cache. **Missing**: typed replayable events (orazaka-studio#50), steering commands, sub-tree cancellation, per-step content-addressed cache | Steering commands at step boundaries, typed edges (`CONTENT`, `ASSEMBLY`, `CONTINUITY`, §4 rule 8) and sub-tree cancellation (Next); a Merkle per-step cache once steering lands (Backlog) |
| Saga and compensation | **Own** | **Exists** (`RunSagaService`) | Keep |
| Model connectors (Ollama, OpenAI, Anthropic, Gemini) | **Hybridize behind a port** | **Exists**: Spring AI 2, but imported far beyond the adapters (§2) | Spring AI only in `orazaka-adapter-spring-ai`, implementing our inference, embedding and structured-output ports; everyone else through `AiClient` and the interceptor SPI, given engine types |
| Vector store, embeddings | **Hybridize behind a port** | **Exists** (`spring-ai-vector-store`, `EmbeddingClient`) | Same boundary rule |
| MCP | **Integrate as-is** | **Exists**: `spring-ai-mcp` on the official MCP Java SDK | Keep; `McpClientFactory` moves into `orazaka-adapter-spring-ai` |
| Broker and outbox | **Integrate as-is** | **Exists**: RabbitMQ, the Postgres outbox relay (krizaka-platform-kit) | Keep |
| Diffusion, TTS, video runtimes | **Integrate as-is** | **Exists**: the Python media worker | Keep; it reports to the arbiter, it does not become Java |
| A2A | **Integrate later** | **Missing** | Incubation |
| `StructuredTaskScope` | **Refused** | Preview in Java 21 | Not used (§5) |

## 4. Boundary rules

1. **The domain is pure Java 21; Spring AI is one adapter module.** A new module, `orazaka-adapter-spring-ai`, holds
   every Spring AI class and implements our ports (inference, embedding, structured output). Two ArchUnit rules:
   no class outside `orazaka-adapter-spring-ai` depends on `org.springframework.ai..` (baseline 52 main files), and no
   class in `..orazaka.core..` or `..orazaka.business..` depends on `org.springframework..` (baseline core 63,
   business 2). Both run behind a **ratchet**: violations counted per rule, the count may only go down, each slice
   lowers it. No big bang. The poms of `orazaka-core`, `-interceptors` and `-tools` end without any `spring-ai-*`;
   Spring wiring moves to auto-configuration in the adapter modules.
2. **The port is ours.** `AiClient` stays the inbound port. The interceptor SPI (`PromptContextInterceptor`),
   `InternalChatRequest`, `ToolRegistry`, `ChatMemoryStore` and `MemoryResolver` take engine records (messages,
   options, tool definitions) instead of Spring AI types; the adapter maps them once.
3. **The core is product-blind.** No product or domain noun in `orazaka-core` (today: none, checked by class name; the
   law corpus lives in `orazaka-tools`, ADR-089). ArchUnit forbids `orazaka-core` from depending on packs, studios or
   product packages. A pull request that changes `orazaka-core` to serve one product is refused: the change goes to a
   port or a pack. **The proof is a pack**, not a product: the next change of `orazaka-packs/document-validation` (the
   lease rulesets) lands with no diff in `orazaka-core`.
4. **Policy is data.** Pools, weights, thresholds, `K`, breaker windows and routing are database rows (ADR-027,
   ADR-029), edited by the admin, never `if` on a name in Java.
5. **Every node has a contract and a policy.** A blueprint step names its `outputContract` (exists) and a control
   policy (new): which levels run, the thresholds, `K`, and where it escalates.
6. **Deterministic first.** Level 1 (schema, file present and readable, duration, ratios) runs before any model and
   costs no token (target under 10 ms, measured). Level 2 (an LLM or VLM judge) produces a `DriftScore` compared to the
   policy's thresholds. Then at most `K` local re-adjustments carrying the diff, then escalation to the supervisor or a
   human. An episodic error memory refuses a re-adjustment that repeats an earlier failure (anti-oscillation); a
   circuit breaker opens on a judge or a model that keeps failing. Each judgement is
   `sealed interface ControlVerdict permits Validated, DriftAdjustment, HumanEscalation`, as records, written to the
   run's event log.
7. **Loi 25.** The Act respecting the protection of personal information in the private sector, section 12.1 (a
   decision based exclusively on automated processing): `HumanEscalation` is the path to a human review. Every
   persisted verdict carries `(runId, driftReason, humanActorId, timestamp, actionTaken)` and is written through the
   Outbox in the same transaction as the run's state, so the record cannot be lost or diverge; with the operator audit
   trail (ADR-085) it is the record of how the decision was made. A policy may make escalation mandatory for a node
   whose output is a decision about a person.
8. **Steering edges are typed.** A blueprint edge says what a change upstream means downstream: `CONTENT` regenerates
   the dependent; `ASSEMBLY` re-runs only the deterministic assembler; `CONTINUITY` re-runs only the control-loop
   evaluator on the neighbour, which regenerates it only if its drift is above the threshold and otherwise flags
   « impact détecté » for the user to decide.

## 5. What we refuse, and why

- **LangChain4j.** A second connector stack beside Spring AI 2: two ways to call a model, two option models, two
  upgrade trains. Spring AI 2 is the migration we already paid for (ADR-030).
- **LangGraph4j.** Our DAG is the Studio blueprint, with its saga, its compensation, its approvals, its leases and its
  billing hold. A second graph runtime would own run state twice.
- **A home-made MCP or A2A protocol stack.** We use the official SDKs, behind our adapters.
- **Calling an unbuilt component IP.** The VRAM scheduler is planned (§7), not existing; the `orazaka-cinema` repository
  does not exist and is not created by this ADR.
- **`StructuredTaskScope`.** It is a preview API in Java 21; we do not use it, and it is not on the roadmap.
- **A model judge before a rule.** Level 2 never runs on an output level 1 rejects.

## 6. Rollout

Each slice is one issue, test-first, merged green before the next one that depends on it.

1. **Boundary** (P1, Next): the two ArchUnit rules behind the ratchet at today's counts; `orazaka-adapter-spring-ai`
   created; interceptors and tools moved to engine types; then core's Spring AI files, then its Spring wiring, slice by
   slice; the DAG stub deleted. Counts reach 0.
2. **Control verdict** (P2, Next): the failing test for the re-validation loop first; then `ControlVerdict`, level 1,
   level 2 with `DriftScore`, `K` re-adjustments with the diff, escalation, episodic memory, breaker, all as policy rows.
3. **GPU arbiter** (P2, Next): `GpuLease` per device (TTL, heartbeat, forced revocation), `SHARED_LIGHT` /
   `EXCLUSIVE_HEAVY`, active eviction verified on `/api/ps`, batching by model affinity, a small model outside the heavy
   lock; the worker side reports its VRAM and resident models and obeys a revocation.
4. **Steering and sub-tree cancellation** (P2, Next): `PAUSE_BRANCH`, `OVERRIDE_ARTIFACT`, `INJECT_CONSTRAINT`,
   `APPROVE_GATE` at step boundaries on ADR-088's design; typed edges `CONTENT` / `ASSEMBLY` / `CONTINUITY`; cancel
   only the impacted sub-tree.
5. **Content-addressed step cache** (P2, Backlog): a Merkle key per step so a change re-runs only the impacted
   branches; checkpoint and replay on the event log (orazaka-studio#50).
6. **Incubation**: A2A AgentCards; an Apache-2.0 « Loi 25 redaction » MCP/A2A connector; GOAP-style preconditions and
   effects in the planner (inspired by Embabel).

Performance slices (3, 4, 5) answer the v3 direction of the blog's chapter 13,
[« And v3? »](https://blog.krizaka.com/story/orazaka-v2-the-architecture-we-build/#and-v3): warm workers and GPU
scheduling, events instead of re-reading, a cache with its invalidation written down.

## 7. Issues

| Slice | Priority | Board | Issue |
| :--- | :--- | :--- | :--- |
| 1. Spring AI boundary (ArchUnit), interceptors and tools to the port | P1 | Next | [krizaka/orazaka-ai-engine#112](https://github.com/krizaka/orazaka-ai-engine/issues/112) |
| 2. `ControlVerdict` and the deterministic-first loop | P2 | Next | [krizaka/orazaka-ai-engine#114](https://github.com/krizaka/orazaka-ai-engine/issues/114) |
| 3. GPU arbiter between Ollama and the media worker | P2 | Next | [krizaka/orazaka-ai-engine#113](https://github.com/krizaka/orazaka-ai-engine/issues/113) |
| 3. The worker reports VRAM and resident models | P2 | Next | [krizaka/orazaka-worker-media#83](https://github.com/krizaka/orazaka-worker-media/issues/83) |
| 4. Steering commands and sub-tree cancellation | P2 | Next | [krizaka/orazaka-studio#87](https://github.com/krizaka/orazaka-studio/issues/87) |
| 5. Content-addressed step cache (Merkle DAG) | P2 | Backlog | [krizaka/orazaka-studio#88](https://github.com/krizaka/orazaka-studio/issues/88) |
| 6. A2A AgentCards | — | Incubation | [krizaka/orazaka#428](https://github.com/krizaka/orazaka/issues/428) |
| 6. Apache-2.0 « Loi 25 redaction » connector | — | Incubation | [krizaka/orazaka#429](https://github.com/krizaka/orazaka/issues/429) |
| 6. GOAP-style preconditions and effects | — | Incubation | [krizaka/orazaka-studio#89](https://github.com/krizaka/orazaka-studio/issues/89) |

Already open and reused, not duplicated: the replayable event log
([krizaka/orazaka-studio#50](https://github.com/krizaka/orazaka-studio/issues/50)), the bounded review loop across steps
([krizaka/orazaka-studio#48](https://github.com/krizaka/orazaka-studio/issues/48)), the worker's keep-hot model manager
([krizaka/orazaka-worker-media#65](https://github.com/krizaka/orazaka-worker-media/issues/65)), the runs epic
([krizaka/orazaka#388](https://github.com/krizaka/orazaka/issues/388)). krizaka/orazaka-ai-engine#115 (`StructuredTaskScope`) was
closed as not planned after the counter-review (§5).
