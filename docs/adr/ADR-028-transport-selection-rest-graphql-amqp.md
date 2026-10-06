# ADR-028 — Transport selection: when an operation is REST vs GraphQL vs AMQP

- **Status**: Accepted
- **Date**: 2026-06-15
- **Scope**: `products/orazaka` (router ingress `orazaka-apps/orazaka-router`, framework `Intention` boundary)
- **Relates to**: AGENTS.md §2 (Router = sole translation boundary, `HTTP/SSE/GraphQL → Intention`), §6 (Messaging: sync vs async)

## Context

The router (`orazaka-router`) is the **sole** translation boundary between transport and the
`Intention` domain unit. It currently exposes **three** ingress transports, and the allocation of
operations across them grew organically without a written rule, producing drift:

- **GraphQL** (`infrastructure/adapter/graphql`, `resources/graphql/schema.graphqls`): `me`,
  `operationGraph`, `interceptionSchema`; mutations `chat`, `image`, `speech`, `updatePreferences`,
  `register`, `resolveInterception`; a declared `Subscription.chatStream`.
- **REST** (`infrastructure/adapter/rest`, 27 controllers): SSE streams (`ChatStream`, `AgentStream`,
  `CodeStream`), media generation/analysis (`Image`, `Video`, `Speech`, `MediaAnalysis`,
  `MediaUpload`), async jobs (`Job`, `AutomationJob`, `AdminJob`), admin/ops (`AdminFeature/Model/
  Pipeline`, `Validation`, `InfrastructureStatus`), `Auth`, `Bootstrap`.
- **AMQP** (`infrastructure/adapter/amqp`): job-execution strategies consumed by the worker.

**Observed inconsistencies** (the reason for this ADR — "why is X REST and not GraphQL, and vice
versa?"):

1. `chat`, `image`, `speech` exist **both** as GraphQL mutations (`AiController`) **and** as REST
   endpoints (`ChatStreamController`, `ImageController`, `SpeechController`, `/api/v1/media/generation/*`). The
   chat composer and BFF call the **REST** ones; the GraphQL mutations overlap them.
2. `Subscription.chatStream` is declared in the schema, but interactive streaming actually runs over
   **REST SSE** (`ChatStreamController`, token-by-token). The subscription is effectively dead schema.
3. The capability registry is exposed **twice**: `operationGraph` (GraphQL) and
   `/api/v1/features` (REST, `BootstrapController`) return the same node/blueprint data.

## Decision

Transport is chosen by the **shape of the interaction**, not by preference. One operation = one
client-facing transport.

| Transport | Use when | Why | Examples (target state) |
|:---|:---|:---|:---|
| **GraphQL** | Typed, **bounded request/response** reads & commands where the client benefits from field selection / a single typed round-trip, and the result is a small JSON object. | One schema, one round-trip, no over-fetch; strong typing for the client SDK. | `me`, `operationGraph`, `interceptionSchema`, `updatePreferences`, `register`, `resolveInterception` |
| **REST** | The interaction is **transport-shaped** in a way GraphQL handles poorly: **(a)** token-by-token **SSE streaming**; **(b)** **binary / multipart** (upload & generated media bytes); **(c)** **async job submission** with `202 Accepted + jobId` semantics; **(d)** **ops/standard contracts** consumed by infra or third parties. | SSE is the sanctioned streaming transport (§6 — *not* GraphQL subscriptions / WebSocket); JSON-only GraphQL can't carry bytes without wasteful base64; HTTP status codes model async acceptance; actuator/OAuth/bootstrap are standardized REST. | `chat/agent/code` SSE streams, `Image/Video/Speech` generation, `MediaUpload`, `MediaAnalysis` (`202+jobId`), `Auth`, `Bootstrap`, actuator |
| **AMQP** | **Decoupled async heavy execution** — never client-facing. | Broker = heavy / deferred / event-driven (§6); the worker is a consumer host, not an ingress. | job-execution strategies (`*Strategy`), `JobListener` |

**Rule of thumb**: *streaming or bytes or 202-async or infra-standard → REST; small typed
synchronous query/command → GraphQL; deferred heavy work → AMQP. Interactive chat streaming stays
synchronous SSE and is never routed through the broker (§6).*

## Remediation (apply best practices to resolve the drift)

1. **De-duplicate `chat`** → keep **REST SSE** (`ChatStreamController`) as the single chat transport;
   **remove the dead `Subscription.chatStream`** from `schema.graphqls`. Interactive streaming is SSE
   per §6.
2. **`image` / `speech`** → these are *bounded request/response* generations (small JSON/asset
   reference). Pick **one** transport per the table. Recommended: keep the **REST** `/api/v1/media/generation/*`
   endpoints (they are registered as capability blueprints in `orazaka_capabilities` and uniformly
   carry `${model:}`/options, consumed by the chat composer) and **retire the GraphQL `image`/`speech`
   mutations** to remove the overlap. If a GraphQL one-shot is required for a typed client, keep
   *only* the GraphQL form and remove the REST twin — but never both.
3. **Capability registry** → choose a single source of truth for the node/blueprint list. Recommended:
   **REST `/api/v1/features`** is the canonical client feed (already consumed by the chat
   composer); keep `operationGraph` **only** if the admin/visualization client needs the richer typed
   `OperationNode` projection, and document that split explicitly. Do not let both drift.
4. **Going forward**: every new ingress operation must justify its transport against the table above
   in its PR; reviewers reject transport choices that don't match the interaction shape (this is now
   part of the `review_architect` documentation gate).

## Implementation (2026-06-16) — remediation applied, with one corrected assumption

A code review found the original "verify none call them (the web-client BFF uses REST)" caveat was
**only half true**: the web-client's GraphQL `ChatApi` was already **dead** (the live composer uses
REST `executeFeature` → `/api/v1/media/generation/*` + SSE), but the **`orazaka-cli`** — a first-class client (§8) —
was actively calling the GraphQL `chat`/`image`/`speech` mutations **and** streaming chat over a
GraphQL **`chatStream` subscription on WebSocket**, which itself **violated §6** (interactive streaming
must be SSE, never a subscription/WS). Blind deletion would have broken the CLI; the review migrated it
first. The remediation is now **done**:

- **Router**: removed the GraphQL `chat`/`image`/`speech` mutations + the `chatStream` subscription
  (and the now-orphaned `ChatResponse` type) from `AiController` + `schema.graphqls`. The controller
  now exposes only `operationGraph` + `NodeState` resolvers. GraphQL keeps `me`,
  `interceptionSchema`, `operationGraph`, `updatePreferences`, `register`, `resolveInterception`.
- **web-client**: deleted the dead `services/chat.api.ts` (GraphQL `ChatApi`) + its test.
- **orazaka-cli**: `chat.api.ts` is now pure REST **SSE** streaming; the `chat-stream.ws.ts`
  GraphQL-subscription module was deleted; `image`/`speech` moved to **async REST jobs** (`POST
  /api/v1/media/generation/{image,speech}` → `202 + jobId` → poll), mirroring `generateVideo`.
- **Capability registry** (item 3) is **not yet consolidated**: `operationGraph` (GraphQL, used by the
  CLI) and `/api/v1/features` (REST, used by the web composer) still coexist; the redundant
  REST `OperationGraphController` (`/api/v1/status/graph`) remains a follow-up.

## Consequences

- **Positive**: a written, testable rule ends the "REST or GraphQL?" guesswork; removes duplicated
  endpoints (smaller attack surface, less drift); aligns transport with §2/§6; the CLI no longer
  streams over a §6-violating GraphQL/WebSocket subscription.
- **Cost**: removing the GraphQL `chat/image/speech` mutations + `chatStream` subscription was a
  breaking change for the CLI — handled by migrating the CLI to REST/SSE in the same change. CLI
  image/speech are now asynchronous (submit + poll) rather than synchronous one-shots.
- **Enforcement**: the allocation table is the reference for the `review_architect` §2 documentation
  gate; protocol **isolation** (REST/GraphQL/AMQP in distinct sub-packs) is already enforced by
  ArchUnit `ERR-112`.
