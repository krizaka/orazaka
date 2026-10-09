# Orazaka — Governance Contract (agent-neutral)

> **Single source of truth** for architecture, code, and agent-behavior rules across **every Orazaka repository**. This file lives in the workspace repository ([`krizaka/orazaka`](https://github.com/krizaka/orazaka)); each component repository carries a short `AGENTS.md` that only scopes it and defers here.
> This file is **agent-neutral**: `CLAUDE.md` (and any other agent file) only **imports** it (`@AGENTS.md`). No rule lives anywhere except in this contract and in `.agent/rules/*`.
> Every generation, review, or refactor **must** enforce these constraints without exception.
>
> Architectural detail (non-normative): [`docs/VISION_ARCHITECTURE.md`](docs/VISION_ARCHITECTURE.md), [`docs/INTERFACES.md`](docs/INTERFACES.md), [`docs/DEVEX_LIFECYCLE.md`](docs/DEVEX_LIFECYCLE.md). Code-derived docs (architecture map, ports, use-cases, interceptors, API, CLI, models, ADRs) are generated under [`docs/_generated/`](docs/_generated/) by `orazaka docs build`.

---

## 0. Current phase — **LOCAL runtime, GitHub multi-repository**

- The platform is **one GitHub repository per component** in the [`krizaka`](https://github.com/krizaka) organisation, assembled by this **workspace** (§2.1). The runtime cycle (run, e2e, docs) still runs **on the dev machine (macOS 64 GB)**.
- **Allowed on GitHub**: GitHub Actions that **build and test** (every repository runs the shared `component.yml` of this workspace; the workspace runs the full reactor), and that **publish artifacts on a `v*` tag** — the Krizaka building blocks `com.krizaka:*` to **Maven Central** (signed, through the organisation pipeline `krizaka/.github/.github/workflows/maven.yml`, manual *Publish* in the Central Portal), the Orazaka artifacts `com.krizaka.orazaka:*` to GitHub Packages, npm `@krizaka/*` to the public npm registry with provenance. Nothing else (ADR-073).
- **Forbidden for now**: cloud deployment, images pushed to a registry, cloud provisioning, remote Terraform `apply`, remote secrets beyond `GITHUB_TOKEN` — **except** the four organisation secrets of the Maven Central release (`MAVEN_CENTRAL_USERNAME`, `MAVEN_CENTRAL_PASSWORD`, `MAVEN_GPG_KEY`, `MAVEN_GPG_PASSPHRASE`), held by the organisation, never by a repository.
- **Allowed locally**: `docker-compose` (stateful infra), **native macOS** AI runtimes (Metal), running apps via the `orazaka` CLI, **hermetic** tests (Testcontainers), docs generation.
- The code stays **ready** for staging/prod (hexagonal + config-per-profile), but those environments are **deferred**: do not implement them until explicitly requested.

---

## 1. Execution & CLI

- **Single orchestrator**: the `orazaka` CLI. **No shell scripts** (`.sh`/`.bat`) for setup or operations **[ERR-125]**.
- Workspace loop: `node scripts/workspace.mjs clone` (every repository at its path) → `./mvnw install` (whole reactor) → `orazaka install` → `orazaka start` (Docker infra) → `orazaka models pull` → `orazaka dev` → `orazaka onboard`. `node scripts/workspace.mjs status|pull` keeps the repositories in step.
- Tests: `orazaka test [unit|it|e2e]`. Docs: `orazaka docs [build|sync]`.
- **Non-negotiable execution boundary**: stateful infra (PostgreSQL+pgvector, Redis, RabbitMQ) in **Docker**; AI inference (Ollama, image, video) **native macOS**. Never run inference in Docker (CPU fallback = destroyed DevX).

---

## 2. Architecture & module boundaries

Hexagonal (Ports & Adapters), enforced by **ArchUnit** at build time. Dependencies point **toward the core**; `orazaka-core` depends on no outer layer.

### Layers & responsibilities

| Layer | Module | Role (single) |
|:---|:---|:---|
| Ingress | `orazaka-conversation-service` (interactive host, ex-`orazaka-router`) | Headless Ingress: translates transport (HTTP/SSE/GraphQL) → `Intention`, enforces security. **No business logic.** The async executor is now `orazaka-job-service`; the transparent facade is `orazaka-edge`. |
| Orchestration (macro) | `orazaka-business` | App Factory: resolves `Intention` → `UseCase`, deterministic workflow (DAG) **or** saga. Delegates dynamic planning to the core. |
| Cognition (micro) | `orazaka-core` | Cognitive engine: `AiClient`, interceptor pipeline, `agent` capability, Provider Mesh. Web/DB-agnostic. |
| Pipeline | `orazaka-interceptors` | Cross-cutting filters (one module, packs by concern). |
| Outbound capabilities | `orazaka-tools` | MCP · RAG · sandbox. |
| Security (cross-cutting) | `krizaka-users-core` | RBAC · OAuth2 · crypto · **user profile**. |
| State | `orazaka-persistence` | CQRS: write+outbox / read models / cache. |
| Async | `orazaka-apps/workers/` | Consume RabbitMQ, build projections, heavy jobs (native media). |

### Absolute invariants

- `business` **never** imports `com.orazaka.core.*` as internal state; it invokes the core **inbound ports** (`AiClient`, etc.).
- `core` contains **no** business logic or product-domain rules.
- `interceptors`: `orazaka-core/.../application/interceptor/` contains **only** the `PromptContextInterceptor` interface. All implementations live in `orazaka-interceptors/` (AutoConfiguration SPI) **[ERR-122]**.
- A **port** is defined in the module that needs it (the core) and **implemented** in an outer module (package-private adapter).
- **Router = sole translation boundary** between transport and `Intention`.

### Entry concept — `Intention` (not "query")

The entry unit is an immutable `Intention` typed `COMMAND | QUERY` (the **CQRS** pivot) with `capability` (`CHAT|IMAGE|AUDIO|VIDEO|AGENT|ADMIN`) and `mode` (`SYNC|ASYNC`). Contracts: see `docs/INTERFACES.md`.

### Orchestration — three scopes (do not conflate)

1. **Pipeline** (1 inference) → `core`. Mode `DETERMINISTIC` (DB order) | `AGENTIC` (classification).
2. **Agent loop** (plan→act→observe) → `core`, `agent` capability. **The intelligence lives in the core.**
3. **Workflow / use-case** (macro, saga) → `business`. Deterministic (DAG) or dynamic (**delegates** the plan to the core). `business` stays thin coordination — it hosts **no** LLM logic.

### 2.1 Repositories — one per component, assembled by the workspace

Every component is its **own GitHub repository** so that any Krizaka application can take only what it needs (users, notifications, billing, edge, UI kit…). [`orazaka.workspace.json`](orazaka.workspace.json) is the **single list** of repositories, their workspace path and their dependencies, **in build order**; `scripts/workspace.mjs`, the `orazaka` CLI, the docs generator, the cross-repository governance rules and CI all read it.

| Layer | Repositories |
|:---|:---|
| **Krizaka building blocks** (`krizaka/`, `com.krizaka:*` on Maven Central — Orazaka consumes them, does not own them) | `krizaka-build` (parent POM, BOM, generic test kit) · `krizaka-platform-kit` (`krizaka-security`, `krizaka-messaging`) · `krizaka-users` (register, verify, login, OAuth, forgot/reset password, profile, API keys; `-api`, `-client`) · `krizaka-notifications` (e-mail · SMS · webhook per channel) · `krizaka-billing` (credits, plans, metering; `-api`, `-client`) |
| Foundation (Orazaka) | `orazaka-build` (parent POM + BOM + governance kit) · `orazaka-contracts` (platform Tier-1) · `orazaka-edge` · `orazaka-ui-kit` (`@krizaka/orazaka-shared`, `@krizaka/orazaka-design-system`) |
| AI engine | `orazaka-ai-engine` (core, interceptors, tools, business, persistence) · `orazaka-studio` · `orazaka-conversation-service` · `orazaka-job-service` · `orazaka-knowledge-service` · `orazaka-automation-service` · `orazaka-worker-media` |
| Apps & content | `orazaka-web-client` · `orazaka-web-admin` · `orazaka-mobile-client` · `orazaka-cli` · `orazaka-packs` |

**Repository rules** (build-enforced where a rule can see them):

- A repository depends only on repositories **listed before it** in the manifest — no cycle, ever.
- A **domain repository** holds its contract, its client and its service together (`krizaka-users` = `krizaka-users-api` + `krizaka-users-persistence` + `krizaka-users-core` + `krizaka-users-service`). Other repositories depend on the **contract or client**, never on the implementation ([SEAM-002]).
- A repository owns **its context's bootstrap SQL** (`<repo>/infra/initdb/NN-*.sql`, §5) and its tests read it locally.
- **Cross-repository rules** (pack purity, executor coherence, one settlement author…) run inside the workspace and are **skipped — never passed — in a standalone clone** (`Workspace.require`, orazaka-test-support). CI always builds inside the workspace, so nothing is skipped there.
- Versions move together: every Orazaka repository is at the platform version of `orazaka-parent` (the Orazaka BOM); every Krizaka repository at the version of `krizaka-bom` (`krizaka.version` in `orazaka-parent`).
- **Cross-cutting code has one author** (ADR-073): the security baseline, session JWT, service tokens, message dedup and the outbox relay come from `krizaka-platform-kit`; `[KIT-001]`…`[KIT-004]` fail on a local copy. A Krizaka repository never depends on an Orazaka one.

### Physical layout — `krizaka/` (building blocks) · `orazaka-libs/` (import) · `orazaka-apps/` (run)

`krizaka/` holds the Krizaka repositories the platform is built on, cloned like every other repository; they are not
Orazaka's and follow their own `AGENTS.md`.


The workspace places repositories on **one axis: you *run* apps, you *import* libs.** A lib is `packaging jar`, has no entrypoint, and exists only compiled into an app; an app has a `main()` + a port and is deployed. Nothing else distinguishes the two roots.

- **`orazaka-libs/`** — imported, never run: `orazaka-build`, `orazaka-contracts`, `orazaka-ai-engine`.
- **`orazaka-apps/`** — run: `services/` (JVM deployables and the domain repositories that host one), `workers/` (native/polyglot async executors, e.g. the Python `orazaka-worker-media`), `ui/` (the npm workspace root, owned by this repository, over the cloned UI repositories).
- These directories are **clone targets**: ignored by this repository's git, each subdirectory is its own repository.

`business`/`core`/`interceptors`/`tools` stay **libraries** (*layer ≠ process*): the same `business → core` path is packaged into every service and every worker. A worker is a **host**, not an orchestrator — downstream it is the same path.

### Sharing tiers — what may cross a bounded-context boundary

`orazaka-libs/` holds **three tiers with different sharing rules**. A deployable service may depend on Tier-1 + Tier-2 + **its own** Tier-3 — **never another context's Tier-3**. Build-enforced by `<Module>GovernanceTest` **[SEAM-002]**.

| Tier | Content | Sharing rule |
|:---|:---|:---|
| **1 — Contracts** (`*-api`: platform ones in `orazaka-contracts`, domain ones in their domain repository) | pure interfaces + DTOs, zero impl deps | shared **freely**, semver'd; the *only* way one context calls another |
| **2 — Platform SDK** | `core` (AiClient, provider mesh, agent), `interceptors`, `tools`, `test-support` | shared with **SDK discipline** — stable, backward-compatible, changes rarely |
| **3 — Owned domain** | `business`, `identity`, `persistence` | owned by **one** service (or one service-family); each owns its schema + DB |

**Exemplar**: every service depends on `krizaka-users-api` (Tier-1 contract), never on `krizaka-users-core` (Tier-3 impl, owned by `krizaka-users-service`). An `orazaka-libs/` that **shrinks** as domain code migrates into its owning service is healthy; one that **grows** is a distributed monolith forming — treat that as the primary health gauge.

---

## 3. Naming conventions

- Module: `orazaka-<bounded-context>`. Package: `com.orazaka.<module>.{domain,application,infrastructure}`.
- **Folder taxonomy — the `orazaka-` prefix is for artifacts, not organizational folders.** Two roots: `orazaka-libs/` (imported) and `orazaka-apps/` (run) — see §2. The **group folders** inside them are **bare** (`orazaka-libs/orazaka-contracts/`, `orazaka-apps/{services,workers,ui}/`) because they namespace nothing publishable; only Maven modules / npm packs carry the `orazaka-` prefix (`orazaka-apps/services/orazaka-edge`, `krizaka/krizaka-users/krizaka-users-api`). Never nest the prefix on a container (no `orazaka-apps/orazaka-services/`).
- **Zero `Orazaka` prefix** on classes **[ERR-104]** (`Engine`, not `OrazakaEngine`).
- Suffixes: `*Service` (interface) / `*ServiceImpl` (package-private), `*Interceptor`, `*Resolver`, `*Controller`, `*Mapper` (final, static, package-private), `*Repository`, `*Config`, `*Properties`, `*Adapter`.
- **Controllers are resource-oriented [ERR-128]**: name a controller `<Resource>Controller` after the noun it manages (`FeatureController`, `JobController`), **never** after an actor or flow — no `Admin*`, no `Bootstrap*`. Access control is a security concern (method-level `@PreAuthorize` + SecurityConfig URL rules), not the class name. One controller per resource with a single `@RequestMapping("/api/v1/<resource>")` base; split only by genuine sub-resource (`<Resource><SubResource>Controller`, e.g. `MediaGenerationController` vs `MediaAnalysisController`). Do not scatter one resource across several controllers.
- **Application services are capability-oriented [ERR-129]**: name an application service `<Capability>Service` after what it serves (`MediaJobService`, `JobStreamService`), **never** after a design-pattern role — no `*Orchestrator`, `*Evaluator`, `*Manager`, `*Handler`, `*Processor`, `*Coordinator`. Like controllers ([ERR-128]), the pattern is an implementation detail, not the name. `application/service` holds **only** services (`*Service`) — a mapper lives with the code it maps for (inlined into its single consumer, or beside its adapter), never here. A core **outbound-port** implementation is an `*Adapter` in `infrastructure/adapter/persistence` (§ outbound ports below), never `*ServiceImpl`/`*ProviderImpl`/`Jpa*Repository`; config is `*Properties`. (Library modules that use the port/impl split instead hold package-private `*ServiceImpl`/`*ProviderImpl`/`*ManagerImpl` in `application/service`, each beside the entity `*Mapper` it uses.) Build-enforced **per module** by `<Module>GovernanceTest` reusing the shared `GovernanceRules` (orazaka-test-support).
- **One pack, one component kind [ERR-130]**: locate a class by *what it is*. `domain/model` = pure domain value objects (**no** `*Request`/`*Response` — transport DTOs go in `adapter/rest/dto` or `adapter/amqp/dto`); `application/service` = `*Service` only; `infrastructure/adapter/<rest|amqp|persistence|workflow>` = that transport/concern's adapters; `infrastructure/config` = `@Configuration` + `*Properties`, package-private filters in `config/filter` (exposed as qualified `Filter` beans); `infrastructure/support` = cross-cutting infrastructure shared across adapters — stateless utilities (`*Resolver`/`*Util`), shared `@Component` plumbing (`*Store`/`*Registry`/`*Gateway`), shared `*Exception`s; no business logic, never a `*Service`/adapter/config. Build-enforced **per module** by `<Module>GovernanceTest` (router, business, interceptors, identity, tools, persistence × 2 — core has its own), each reusing the shared `GovernanceRules` (orazaka-test-support) so one contract holds framework-wide.
- Outbound ports: `<Capability>Client` · `<Thing>Provider` · `<Thing>Repository`. Adapters: `<Tech><Port>Adapter`.
- I/O records: `*Command`, `*Query`, `*Request`, `*Response`, `*Event`, `*Descriptor`.
- Use cases: `<Domain><Action>UseCase`. Interceptors: `<Concern>Interceptor` (in the `<concern>` package).
- **Pipeline module = `orazaka-interceptors`** (decided), **not** `orazaka-hooks`: it is an ordered, transforming, short-circuitable pipeline, not lifecycle callbacks; and "hooks" collides with React hooks.
- **Functional naming, not marketing** (de-marketing decided): `ClosedLoopValidationInterceptor` (ex-`QuantumValidationAdvisor`), `SemanticRouterInterceptor` (ex-`SimDagRouterInterceptor`), `PolicyConfigCache` (ex-`ConfigMeshCache`).
- **Never `gateway`**: fix any `gateway` drift found. The former `orazaka-router` app dissolved in the microservices split — its interactive surface is `orazaka-conversation-service` (`com.orazaka.conversationservice`, still :8080 behind the edge), its async executor is `orazaka-job-service` (`com.orazaka.jobservice`, :8090), and the transport facade is `orazaka-edge` (:8088). Config identifiers `orazaka.router.*` / `ROUTER_*` env / `ROUTER_INTERNAL_URL` are retained as the conversation-service's wiring keys (renaming them is deferred cosmetic churn).
- Multi-language detail (TS/Python/SQL/Terraform): see [`.agent/rules/naming_conventions.md`](.agent/rules/naming_conventions.md).

---

## 4. Backend standards

- **Java 21**, **Spring MVC + virtual threads (Loom)** — **not WebFlux**, **not Spring Cloud Gateway** (rationale: `docs/VISION_ARCHITECTURE.md` §8). Enable `spring.threads.virtual.enabled=true`.
- 1 top-level type per `.java` file + 1 mirroring test file **[ERR-103]**.
- **Self-validating records** for DTO/domain: validation in the **compact constructor**. The field owner validates it **[ERR-106/116]** — ban `if (dto.field() != null)` guards in services.
- **Mapper isolation**: mapping logic in `final class *Mapper`, static, package-private; ban setter chains > 5 lines **[ERR-107]**.
- **Concurrency**: blocking I/O, remote calls, and DB on **virtual threads**. Ban `synchronized` around I/O; use `ConcurrentHashMap`/`AtomicReference`. Propagate `SecurityContext` manually (MVC+Loom model).
- **Outbound HTTP**: `RestClient` or `@HttpExchange`. Ban manual `java.net.http.HttpClient`.
- Segregated ingress **[ERR-112]**: GraphQL/REST/AMQP handlers in separate sub-packs (`adapter.graphql/`, `adapter.rest/`, `adapter.amqp/`).
- Outbound ports = **public** interfaces; adapters = **package-private** beans in `infrastructure`.
- **Zero dead code**: no unused class/method/export/dependency, no commented-out code left in place, no orphan file. Delete **aggressively** (verifiable: IDE inspections + compiler on the Java side; `depcheck` / `knip` / `ts-prune` on the TS side). During the refactor, remove anything that does not serve the target.
- **Config vs data**: `application.yaml` = infrastructure wiring only (env-driven, each value declared once, typed `@ConfigurationProperties`); domain data & behavior (feature/capability registry, model catalog & default model, interceptor order/enable, rate-limit tiers) live in the **DB** and are never duplicated in yaml. Full rule: [`.agent/rules/configuration_standards.md`](.agent/rules/configuration_standards.md).

### No static helpers / primitive obsession **[ERR-127]**

`*Helper` / `*Util` classes (and `*Hook` when it is not an actual hook) holding **static methods** for data manipulation or orchestration are anti-patterns.

- **Validation at the boundary (Anti-Corruption Layer):** never let generic payloads (e.g. `Map<String, Object>`) leak into business logic. Convert infrastructure messages into validated **Records / Value Objects** at the entry point, through a Mapper or Adapter.
- **Smart payloads:** data extraction and validation are carried by the objects themselves (encapsulation), not by external utility methods.
- **Domain services:** rules that need dependency injection (e.g. model resolution via Spring beans) live in injectable services (`@Service` or domain components) — never in static methods that take services as parameters.
- **What this rule targets:** static methods that take **service beans** as parameters, that **leak or hand-roll `Map<String, Object>`** inside business logic, or that perform **stateful orchestration / I/O** better expressed as an injectable component.
- **Sanctioned exceptions** (not generic helpers): (a) the `final class *Mapper` (static, package-private, dependency-free) of [ERR-107]; (b) **dependency-free pure functions** — stateless math, string/formatting, or extraction over a third-party type you cannot extend — which carry no coupling worth mocking and would only be duplicated by inlining; (c) a **reflective decoupling adapter** that deliberately avoids a compile-time dependency (e.g. on the security starter).

---

## 5. Persistence (CQRS)

Two bounded contexts, **no JPA entity outside `orazaka-persistence`**:

- `persistence-app`: AI state (chat, jobs, models, configs, **outbox**), sub-packs `command/` `query/` `outbox/` `cache/`.
- `persistence-identity`: identity **and profile** (`UserProfile`, preferences, RBAC). `app` references the user only by an opaque `ActorId` — **no cross-context FK**.

DB invariants **[ERR-109]**: no raw SQL (parameterized Repos or `@Query`); no read-before-write (catch `DataIntegrityViolationException`); hash/crypto **outside** `@Transactional`; write methods return domain records; no N+1 (`LEFT JOIN FETCH` / `@EntityGraph`).

**DB bootstrap (local phase)**: **one file per bounded context, in the repository that owns the context** — `krizaka-users/infra/initdb/10-identity.sql`, `orazaka-conversation-service/…/20-conversation.sql`, `orazaka-job-service/…/30-jobs-config.sql`, `orazaka-knowledge-service/…/40-knowledge.sql`, `orazaka-automation-service/…/50-automation.sql`, `orazaka-ai-engine/…/60-governance.sql`, `krizaka-billing/…/70-billing.sql`, `orazaka-studio/…/80-studio.sql`; this workspace keeps only `infra/initdb/00-reset.sql` and `90-dev-fixtures.sql`. Schema + tables + **dev seed data**, applied alphabetically via psql: `infra/docker-compose.yml` mounts each file into the ONE Postgres container. Contexts already cut over run in their **own database with their own role**, created by their initdb file (`10-identity.sql` → `orazaka_identity_db` / role `orazaka_identity`); the rest still share `orazaka_db` until their phase. **Cross-context FKs are banned** (opaque ids only), enforced on every build by `SqlBoundaryRules` [SEAM-001]; cross-context seeds are banned too (each context seeds only its own database). `infra/init-prod.sql` is **deferred** (nothing in prod for now) — we do it once the product is finished.

---

## 6. Messaging (RabbitMQ)

RabbitMQ is the **decoupling buffer**, not a database appendage.

> This section described the plane as it was two phases ago: it named the router as the producer of
> async jobs (deleted in ADR-068), `business`/`core` as producers (neither has ever touched the
> broker), and three consumers by class names that do not exist (`JobEventRelay`,
> `WorkflowEventConsumer`). It was the **fifth** text in this repository to assert something false
> about a control, and the first that is normative — every run loads this file first. Rewritten
> against the code (ADR-069); keep it that way by reading `docs/_generated/architecture.json`, which
> is derived from the code and is where the lists below come from.

- **Every job command has a run behind it** (ADR-068). The studio service's **transactional outbox**
  is the only producer of `job.*` work: `AmqpStepExecutionAdapter` appends the command in the saga's
  own transaction and `OutboxRelay` publishes it. There is no HTTP endpoint that submits a job.
- **Other producers**, each with the one thing it publishes: the **automation service** dispatches
  `job.agent.dispatch.{userId}` to a user's own CLI agent and emits `evt.automation.telemetry`; the
  **conversation service** releases `job.automation.approved` when a human approves an automation
  job that already exists, and emits `evt.agent.presence` / `evt.agent.result.{…}`; the **job
  service** emits a job's own lifecycle and `evt.capability.changed`; the **studio service** emits
  `evt.studio.run.{started,succeeded,failed}`; **billing** emits entitlement invalidations. The
  write-side `EventPublisher` publishes through the **persistence outbox**, which carries the
  exchange and routing key on the row rather than choosing them (AGENTS.md §5).
- **Consumers**: the **job service** drains the two job lanes and their DLQs; the **studio service**
  consumes job outcomes, connector outcomes, capability and subscription changes; **billing**
  consumes settlements and unmetered turns; the **conversation service** relays job events to the
  client over **SSE** (`JobEventListener` on `orazaka.events.job-relay`, bound `job.#`) and consumes
  wallet events; **automation** consumes its own queue; **notifications** consumes the two identity
  notification queues (`evt.user.*`, `evt.password.*`) and `orazaka.notifications.requests`
  (`evt.notification.requested`) and delivers per channel (e-mail, SMS, webhook);
  **knowledge** consumes RAG indexing. **No one calls a worker directly.**
- **Two lanes, not priorities** (ADR-067): `orazaka.jobs.interactive` (`job.text.*`,
  `job.media.analyze`) and `orazaka.jobs.batch` (`job.media.generate`), each with its own consumer
  pool and its own ceiling. A capability declares which lane it belongs to with `latency_class`
  (`INTERACTIVE | BATCH`, default BATCH), and [LANE-001] fails the build when the declaration
  contradicts the queue its routing key feeds. Lanes do not create a second accelerator; they stop a
  67-second image from sitting in front of a 200 ms text step.
- Conventions: exchanges `orazaka.jobs` and `orazaka.events` (topic) plus `orazaka.dlx` (direct, the
  dead-letter target). Routing keys are `job.{capability}.{action}` and `evt.{aggregate}.{type}`,
  with a **trailing segment where the key addresses one subject** (`job.agent.dispatch.{userId}`,
  `evt.agent.result.{jobId}`). A job's own progress travels on `orazaka.events` as
  `job.{jobId}.progress|done|error` — the events exchange carries both grammars, which is why the
  relay queue binds `job.#` there and not on the jobs exchange. **DLQ** `<queue>.dlq`, exponential
  backoff (`multiplier: 2.0`), **idempotency** by `messageId` — claimed before the work and
  **released when the handler throws**, so a redelivery after a failure is not silently dropped.
- **Sync vs async rule**: *broker = heavy / deferred / event-driven*; *synchronous = low-latency
  interactive*. **Interactive chat streaming stays synchronous** (token-by-token SSE), **never**
  through the broker — `orazaka.core.chat.completion` is in the same registry as image and video and
  is not a run.

---

## 7. Interceptor pipeline (`orazaka-interceptors`)

One module, packs by concern: `security/` `token/` `context/` `translation/` `enrichment/` `reformulation/` `tooling/` `validation/` `governance/`.

- Single interface: `PromptContextInterceptor` (enriches / routes / may **short-circuit**). `governance/` drives conditional activation (predicates).
- **Kill-switches**: `orazaka.security.disable-ai=true` fails any interceptor with `isAiDependent()==true` — it gates interceptors, not the model call itself. `orazaka.core.orchestration.enabled=false` (`ORCHESTRATION_ENABLED`) **refuses** every engine turn (`PipelineDisabledException` → `503` / `PLATFORM_UNAVAILABLE`). It never bypasses the pipeline: a bypass would skip the crisis guard, the scope guard, the credit hold and the `disable-ai` gate and still call the model (ADR-062).
- **Failure posture is declared** (ADR-064): an interceptor that is a control returns `failsClosed() == true`, and its unhandled failure stops the turn; an enrichment's degrades it. A control that chooses to survive a dependency's failure handles it inside itself and says so on the class — the credit gate fails open and records every turn it serves without a hold.
- **Caller data never shares a key space with trusted context** (ADR-064): a `Context` carries platform declarations under `orazaka.` and what the user wrote under `preference.`; the pipeline merges only those two namespaces. Reordering statements is not a fix.
- Modes: `orazaka.core.orchestration.routing.mode = DETERMINISTIC | AGENTIC`.

---

## 8. Frontend · Mobile · CLI

All clients live under `orazaka-apps/ui/` — one repository each, linked by the npm workspace this repository owns (`orazaka-apps/ui/package.json`). **No client outside this folder.** Shared packages are published as `@krizaka/*` on npm (public, with provenance); inside the workspace the apps link them from source. The Krizaka brand layer (marks, motion signature) is [`@krizaka/ui`](https://github.com/krizaka/krizaka-ui).

| Package | Role | Port |
|:---|:---|:---:|
| `orazaka-web-client` | Next.js 16 client (App Router) | 3000 |
| `orazaka-web-admin` | SecOps console | 3001 |
| `orazaka-mobile-client` | Expo SDK 53 | 8081 |
| `orazaka-cli` | dev CLI + offline SQLite queue | — |
| `@krizaka/orazaka-shared` (repo `orazaka-ui-kit`) | TS types + Zod + **design tokens** (framework-agnostic; single source, consumed by web, mobile, cli) | — |
| `@krizaka/orazaka-design-system` (repo `orazaka-ui-kit`) | **web** React components + Tailwind preset + theme + Lucide registry (consumes `shared` tokens); its `theme.css` declares its own Tailwind `@source` | — |

- **Design system**: web components shared by `web-client` + `web-admin` in `orazaka-design-system`. **Banned**: duplicating components between web-client and web-admin, or putting React components in `orazaka-shared` (which stays pure contracts + tokens). **Mobile** has its own RN components but imports the **same tokens** from `shared`.
- **BFF mandatory for the browser**: a web page **never** hits the router (`:8080`) or Ollama (`:11434`) directly. All browser traffic proxies through Next.js server API routes.
- **Native clients go to the edge**, not through the BFF: `orazaka-mobile-client` calls `:8088` with `Authorization: Bearer`. The BFF authenticates with a **next-auth session cookie**, which a native app can neither obtain nor carry, so routing it there would mean building a second, native-only auth path inside a component that exists to serve the browser. The edge already exchanges keys for JWTs (`ApiKeyExchangeFilter`) and every service behind it enforces its own security — the guarantee the BFF rule protects (no client reaches a service unauthenticated) is upheld by the edge, not weakened. The rule for the browser is unchanged and non-negotiable.
- Types: always via `@krizaka/orazaka-shared` (`"@krizaka/orazaka-shared": "*"`). Ban interface duplication and cross-imports between client packs.
- Design: cinematic dark-mode; no inline hex or hardcoded Tailwind color classes. Max **250 lines/file** for `.tsx`. Dates via `date-fns` only **[ERR-108]**. Input-blocking when `isSending || isGenerating` **[ERR-126]**. Centralized Lucide icons (`Icon.tsx`).
- **The 250-line cap is a component rule, and `*.registry.tsx` is exempt from it.** A registry of 84 icon paths is not a component, and splitting one into four files of 175 lines satisfies the letter while making a reader guess which file holds the icon they want. The exemption is narrow **by construction**: a `*.registry` file may hold any amount of data and **no component** — `no-restricted-syntax` fails on a function declaration there, so a registry that grows behaviour stops being exempt. Enforced by `max-lines` in each workspace's ESLint config.
- **Every UI workspace must run ESLint**, not only a type-check. `orazaka-design-system` ran `tsc --noEmit` as its `lint`, which counts nothing — which is why `icon.tsx` reached **841 lines** against this very cap without one warning. A rule written in three configs and absent from the fourth is enforced in three places.
- UI detail: [`.agent/rules/ui_standards.md`](.agent/rules/ui_standards.md).

---

## 9. Testing (local)

- **Pyramid**: unit (per module) → integration (**Testcontainers**, `AbstractContainerIntegrationTest`, singleton per JVM, ports via `@DynamicPropertySource`) → **hermetic E2E** (`orazaka-end2end`).
- **ArchUnit**: `GovernanceTest` validates the ring rules on **every build**. Pre-commit: `./mvnw test -pl orazaka-libs/orazaka-ai-engine/orazaka-core -Dtest=GovernanceTest`.
- In the local phase, **hermetic E2E is the quality gate** (no staging/prod). `orazaka test e2e`.
- Detail: [`.agent/rules/testing_standards.md`](.agent/rules/testing_standards.md).

---

## 10. Documentation generation (local, automated, from code)

- **Docs come from code.** **Full** automation, wired into the **build**: no hand-maintained architecture doc that can drift.
- `orazaka docs build`: generates, from the code, **(a)** markdown (catalog of `UseCaseDescriptor`, ADR ledger, interceptor registry, interface contracts, **API reference, governance-rule registry**, CLI reference, model catalog) **and (b)** a **structured** architecture model (`docs/_generated/architecture.json`: modules, ports, dependencies, pipeline, messaging) extracted via ArchUnit/annotation scan. The build fails if the model is stale (`docs build --check`).
- **The API reference carries the authorisation rule, not only the path.** Access is resolved per endpoint from each service's `SecurityConfig` in **declaration order** — Spring Security is first-match-wins, and ranking matchers by specificity inverts the answer. An endpoint no matcher covers is rendered **⚠ no rule**, which is a finding rather than a formatting gap: it means the service has no security on that path at all.
- **The governance registry lists which suite enforces each rule.** A rule with no suite enforces nothing, and that must be visible without reading the test tree. Every `assert*` in `orazaka-test-support` appears, summarised by its own javadoc — so a rule is documented by whoever writes it.
- **Docstrings are the generator's input, not decoration.** A controller method's first javadoc sentence becomes its API summary; a rule's becomes its registry entry. An undocumented public surface generates an empty cell.
- **Schemas = 3D ultra-design graphical components.** On the Krizaka site, architecture schemas are rendered by **high-end interactive 3D components** (React Three Fiber / Three.js + drei), driven by `architecture.json` — not static mermaid for the main views (mermaid tolerated as print/fallback only). Design: cinematic dark-mode, depth, parallax, hover/zoom/rotate, consistent with the design system. The 3D components live in the site (`krizaka-com`), fed by the generated data.
- `orazaka docs sync`: copies `docs/` + `docs/_generated/*` → `orazaka-content/docs` (consumed by the Next.js site). **Run locally** (no CI for now).
- When changing interfaces, config keys, `infra/initdb/*.sql`, env vars: run [`.agent/workflows/sync_documentation.md`](.agent/workflows/sync_documentation.md). Generated docs are **never** hand-edited.

---

## 11. Security

- Secrets in local `.env` (never committed). Verification/reset tokens **SHA-256 hashed**, single-use, 15-min expiry. Passwords: BCrypt.
- M2M JWT on the router; RBAC resolved in `interceptors/security` via the `krizaka-users-core` ports.
- **Pinned upstream versions**: no `-SNAPSHOT` dependency as a rule (Spring Boot is pinned to the `4.0` GA line; Spring AI to `2.0.0` — see ADR-030 for the migration off the former `3.5.0` line). **Pinning a line means tracking its patches, not freezing on `.0`**: take `4.0.x` as it ships and leave `4.1` alone. One property bump also moves everything the BOM manages (JDBC driver, JUnit, Mockito, Lettuce, Micrometer…) to versions Spring tested together, which is why those must never be bumped individually — doing so overrides the BOM and is the churn this rule exists to prevent.
- **Audit, don't upgrade reflexively.** `npm audit` and `versions:display-property-updates` are the inputs; "a newer version exists" is not a reason. Never run `npm audit fix --force` in this repo: it proposes `react-native@0.72` (older than what is installed) and `expo@57` as "fixes", either of which would break the mobile client. Advisories reachable at runtime come first; build-time tooling can wait for the SDK migration that carries it.
- Detail: [`.agent/rules/security_standards.md`](.agent/rules/security_standards.md), [`.agent/rules/performance_standards.md`](.agent/rules/performance_standards.md).

---

## 12. Declared, not inferred

**When one component must know something about another's work, the other one says it. The receiver
never deduces it from a name, a shape, or a value that happens to be present.**

The test, for a case not listed below: *if this fact is wrong or absent, who finds out?* When the
answer is "nobody, and the bill or the behaviour is silently wrong", the fact must be declared by
the party who knows it — a marker, a typed field, a configuration key — and the receiver must fail
closed without it. A default is a declaration nobody made.

Four independent problems resolved the same way, which is why this is a rule and not a habit:

| Problem | The inference that failed | What is declared instead |
|:---|:---|:---|
| **Metering** [BILL-001] | the interceptor would have sniffed for a `runId` to know a turn was already metered — silently unbilling every future producer that carried one | the producer stamps `orazaka.metering.deferred` and is accountable for it (ADR-044, ADR-045) |
| **Enrichment namespace** | the engine enriched one hardcoded prefix, so a pack could not have a context of its own without editing an engine library (ADR-049 §6) | the producer declares `orazaka.enrichment.namespace`; no declaration, no enrichment (ADR-050) |
| **Failure cause** *(closed)* | the saga read the executor's error prose — and a scope-guard **refusal** and a model **outage** arrived identical, so a SENSITIVE pack's trail could not tell "we protected" from "we broke" | the executor stamps a typed `cause` on `job.{id}.error`; absence reads as `EXECUTOR_FAULT`, which releases and blames nobody (ADR-053) |

**The corollary decides who a guard protects.** Where the two failure modes are asymmetric — one
party edits this repository in review, the other is outside it and cannot be asked to remember — the
guard fails closed against the party who is not in the room. That is why [PACK-002] became a
whitelist of engine namespaces: a new engine namespace costs its author one line in the same
change, and a new pack namespace has nobody to ask (ADR-050).

**What this does not license.** Declaring is not the same as trusting: a declaration is a claim its
author is accountable for, and one that decides money or access is still checked. `EntitlementInterceptor`
honours the metering marker and *still* runs the entitlement check; `MeteringMarkerRules` fails the
build for a producer that declares nothing. Declared, then verified.

**Repairing an inert control is a change, not a fix.** A control that has never been active has a
branch that has never executed. Trace that branch before making it reachable. Three of the inert
controls found in this codebase had an unexecuted branch behind them, and in one case — the
orchestration kill-switch (ADR-062) — repairing the binding alone would have created the
vulnerability the switch was believed to prevent. A bypass is the same thing from the other side:
removing the one that skipped the pipeline for a prompt carrying an image ran the refiner and the
router on images for the first time, and they were what had to change (ADR-063).

---

## 13. Agent session protocol

1. **Load first** this contract + `.agent/rules/*` + `.agent/config/mcp.json`. Never generate code that violates a rule or an ArchUnit rule.
2. For "how does X work / where is X", prefer **structured search** (ripgrep via the filesystem MCP in `.agent/config/mcp.json`) over repeated file reads.
3. **Before declaring a task done**: pass the [`.agent/workflows/review_architect.md`](.agent/workflows/review_architect.md) gate (architecture review) and, if interfaces/config/migrations touched, [`.agent/workflows/sync_documentation.md`](.agent/workflows/sync_documentation.md).
4. **Commits.** Commit **in the repository that owns the change**; a change that spans repositories is one commit per repository, each green on its own inside the workspace. During an **active refactor run**, commit **after each green phase** (local only, **never push**): `refactor(phase-N): <summary>`. Outside a refactor run, commit/push only when explicitly asked.
5. **Local-first runtime**: never introduce cloud deployment or an unsolicited network dependency; CI is limited to what §0 allows.

---

*Agent-neutral contract. Imported as-is by `CLAUDE.md` via `@AGENTS.md`. Last rewrite: 2026-10-06 (multi-repository split: one repository per component, workspace assembly).*
