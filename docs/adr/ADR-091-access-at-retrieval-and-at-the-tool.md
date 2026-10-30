---
title: "ADR-091 — Access is enforced at retrieval and at the tool: the actor travels, the ACL sits in the query"
description: "An employee must never read the CEO's salary through the assistant. The verified actor (tenant, user, roles, groups) travels with every retrieval and tool call; every indexed passage carries the ACL of its source; the filter is part of the query, before ranking; every tool declares the roles it needs and the executor fails closed."
category: ADR
order: 91
---

# ADR-091 — Access is enforced at retrieval and at the tool

- **Status**: Proposed — implemented by the PRs of orazaka-ai-engine#107 (P0, security). Wording is deliberately general; the issue holds the detail until the fix is deployed.
- **Date**: 2026-10-26
- **Builds on**: [ADR-035](ADR-035-internal-surface-authenticated.md) (`/internal/**` requires `SERVICE`), [ADR-064](ADR-064-trust-boundaries.md) (what is a user's content, what the platform declares; no content in logs), [ADR-087](ADR-087-grounded-research.md) (the knowledge tool). Related: orazaka#372 (organizations: the day a tenant is a row, the identity emits it).
- **Scope**: `orazaka-ai-engine` (`KnowledgeService`, `RagInterceptor`, `ToolRegistry`, `McpService`, the caches), `orazaka-knowledge-service` (index metadata, queries, ACL), `orazaka-conversation-service` (the MCP controller), `orazaka-edge`, the workspace (`infra/migrations/2026-10-26-knowledge-access.sql`).

## Context

The assistant answers from documents the company indexed and from tools. Both were reachable by anyone signed in:
retrieval carried no caller, the index stored a tool id and nothing else, a source was readable by its owner **or by
everyone**, and a tool ran for any session. The role model (`ROLE_ADMIN` / `ROLE_USER`) existed and nothing consulted it
below the HTTP route. A prompt cannot repair that: the filter must exist before the model sees anything.

## Decision

### 1. The actor is the verified session, carried by a signed token

- The **actor** is `(tenant, subject, roles, groups)`. It is built by the host service from the authenticated user (the
  identity directory's authorities), never from a request body, a header or a preference. The directory hands one list of
  authorities; three kinds are told apart by prefix: `TENANT_<id>` names the tenant, `GROUP_<name>` a group, anything else is
  a role. No `TENANT_` authority makes a user a tenant of one (their own id); two make the identity ambiguous and yield
  **no actor**. When organizations (#372) land, identity emits the same authorities from membership: nothing here changes.
- Inside the engine the actor rides the `Context` the host already declares (user id + authorities), which the pipeline
  copies into the platform keys `userId` and `roles` *after* the user's preferences, so a preference cannot name them
  (ADR-064).
- To the knowledge service the actor travels in the **`act` claim of the service token** the core already mints
  (`roles: [SERVICE]`, HS256, five minutes). The claim is covered by the signature: the receiver trusts it as far as it
  trusts the shared secret, which already is the trust root of every internal call. A body that names a user or a tenant is
  ignored (the DTOs have no such field; a governance test keeps it so). A token that is unsigned, signed with another secret
  or edited after signing is a 401; a valid service token **without** `act` is a 403 and an audit line.
- The edge forwards the client's `Authorization` (a session JWT, or the JWT it exchanged an `oz_` key for) and nothing else
  that names an identity: `X-Orazaka-*` request headers are reserved for the platform and are dropped at the edge.

### 2. ACL at ingestion

A source row carries `tenant_id` (`*` is the platform's own content, written by operators, never by a caller), its owner
(`user_id`) and `acl_principals`, a list of `role:<ROLE>`, `group:<GROUP>` or `user:<id>` entries. **Default: the owner
only** — the column has no default tenant, so an insert that forgets the rule fails instead of being world-readable.
Every passage indexed from a source carries the same rule as vector metadata: `tenant_id`, `owner_id`, `source_id` and one
boolean flag per ACL entry (`acl_<sha256 prefix of the entry>`, a hash so that two entries never share a key and a role name
is never part of a JSON path). A passage has a stable id and indexing a source first deletes what it indexed before, so
**changing an ACL and re-indexing replaces the metadata**; it never leaves the old grants behind.

### 3. The filter is part of the query

`KnowledgeQueryService` has no read without a principal. The SQL source search puts `tenant_id IN (:tenant, '*')` and
`(owner = :subject OR acl && :grants)` in the `WHERE`; the vector search is given the same rule as its filter expression
(`tenant AND (owner OR flag OR flag …)`), which the store applies **before ranking**. A passage the caller may not read is
never fetched, so it cannot leak through a snippet, a count, a ranking or a cache. A tenant filter is in every query:
cross-tenant retrieval is impossible by construction, similar text included. ArchUnit keeps it so: only
`KnowledgeQueryService` searches the store, and every one of its public methods takes the principal first.

Caches follow the same rule. The tool-result cache key carries `Actor.scope()` (a digest of tenant, user, roles, groups);
the semantic/exact answer cache partitions by it and **does not cache a turn with no verified actor**. A removed role is a
new scope: the next request is a miss, not a stale hit.

### 4. Per-tool permissions, failing closed

- A tool declares the roles any of which may use it when it registers (`ToolRegistry.registerTool(…, requiredRoles)`); a tool
  that declares nothing is **administrators only**. An administrator overrides it with rows of `platform_tool_permissions`
  (`tool_id`, `required_role`), read on every call, so a change holds on the next request. An empty requirement is held by
  nobody.
- There is no tool listing without an actor: `ToolRegistry.getRegisteredTools(actor)` returns the permitted callbacks, each
  **bound to the actor** (`ActorScope`), and `McpService.getAvailableTools(actor)` shows only those. `executeTool(actor, …)`
  authorizes first: no actor → `NO_ACTOR`, no role → `MISSING_ROLE`, both a 403, both audited; the tool is never run.
  The model's tool calling gets the same list (`ToolInterceptor`, `McpClientFactory`), so a tool the actor cannot use is never
  offered to the model either.
- **Tool results are filtered by the same ACL**: the knowledge tool reads through the actor of the running call
  (`ActorScope.current()`), never through an argument the model wrote; with no actor it returns nothing.
- MCP servers inherit their scope: a user's own servers are theirs (they are attached only for their actor); platform
  servers are attached for a signed-in actor only. Per-server required roles are a follow-up (data, same table shape).

### 5. Admin side

Everything an administrator decides is data: the tool roles (`platform_tool_permissions`), a source's ACL
(`PUT /internal/v1/knowledge/sources/{id}/acl`, `ROLE_ADMIN` of the source's own tenant; a foreign or platform source answers
as a missing one; the source is re-indexed in the same call). Roles and groups themselves belong to identity and arrive as
authorities. Defaults are least privilege: owner-only sources, admin-only undeclared tools, no actor no access. The admin
REST/UI on the conversation service and the console screens are tracked as follow-ups in the issue.

### 6. Audit

A refusal leaves a line with the principal (tenant, subject), the resource id and the reason, **never the query, the
arguments or the content** (ADR-064). Knowledge: `knowledge_access_audit` rows (reasons `no-principal`, `acl`, `not-admin`);
for a search, the ids of the matching sources of the caller's own tenant that its grants do not cover (a probe bounded at 20,
inside the same tenant, so it discloses nothing across tenants). Tools: one structured line on the `orazaka.audit.access`
logger per refused execution (`NO_ACTOR`, `MISSING_ROLE`).

## Consequences

- A user without the HR role asking for « le salaire du CEO » gets no passage, no citation and a model that has nothing to
  repeat; the HR user gets it. The same text indexed by two tenants is two rows, each seen by its own tenant.
- A retrieval made without an actor (an anonymous context, an ambiguous identity) returns nothing instead of everything.
- Existing sources are migrated to the access they effectively had and no more (`2026-10-26-knowledge-access.sql`); vectors
  indexed before carry no metadata and match no filter, so they are re-indexed.
- The shared HS256 secret remains the trust root: any process holding it can mint a token for any actor. Moving the `act`
  mint into `krizaka-security` (so `ServiceTokenProvider` can carry it) and asymmetric keys are tracked separately.

## Tests

`KnowledgeAccessIT` (Testcontainers, the real DDL, the real HTTP surface): the HR scenario, cross-tenant, no principal,
forged / unsigned / tampered tokens, a body that names another user, removed role, an injection planted in a document.
`VectorAccessTest` (the filter in a vector store). `ActorTest`, `ActingServiceTokenTest`, `ActorScopeTest`,
`McpServiceImplTest`, `DefaultToolRegistryTest`, `RagInterceptorTest`. ArchUnit: `KnowledgeAccessGovernanceTest`,
`AccessGovernanceTest`.
