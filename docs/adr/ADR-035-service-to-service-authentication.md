---
title: "ADR-035 — Service-to-service authentication"
description: "Why /internal/v1 requires a SERVICE authority instead of relying on the edge not routing it, what the M2M token is, and why mTLS is deferred rather than rejected."
category: ADR
order: 35
---

# ADR-035 — Service-to-service authentication

- **Status**: Accepted
- **Date**: 2026-08-09
- **Scope**: `products/orazaka` — `/internal/v1/**` on billing, studio and identity; the media
  surface on the conversation service; the M2M token minted by `orazaka-billing-client`,
  `orazaka-studio-client` and the conversation service's identity adapter.
- **Supersedes**: the `permitAll()` rationale recorded inline in three `SecurityConfig`s and in
  `docs/STUDIO_ARCHITECTURE.md` §10.
- **Closes**: production-readiness audit findings #1, #3, #4.

## Context

Three services opened `/internal/v1/**` with `permitAll()`. The reason was written down and was
coherent: the edge's route table forwards only `/api/**`, so `/internal/**` is unreachable from
outside. Two things are wrong with it.

First, it is **network-topology security**. It holds exactly as long as the topology does. In a
default Kubernetes namespace every pod reaches every pod, and this platform *fetches URLs* — web
search, MCP servers, RAG ingestion from web sources. One SSRF anywhere in the estate becomes
unauthenticated `hold` / `settle` / `release` against the credit ledger. The append-only trigger
does not help: those are legitimate mutations, correctly recorded, on behalf of nobody.

Second, it is **one layer described as if it were two**. The edge not routing the prefix is a
useful control. It was the only control.

The same shape appeared on media. `/uploads/**` was authenticated at the URL (`hasAnyAuthority`),
but a static `ResourceHandlerRegistry` served the whole tree, so the check answered "is this caller
a user" and never "does this caller own this file" — and the BFF passed the owner segment straight
through from the request.

## Decision

**1. `/internal/v1/**` requires the `SERVICE` authority.**

```java
.requestMatchers("/internal/v1/**").hasAuthority("SERVICE")
```

The token is an HS256 JWT with `roles: ["SERVICE"]`, signed with the shared identity secret that
every service already uses to validate session tokens.

**The authority is `SERVICE`, not `SCOPE_SERVICE` and not `ROLE_SERVICE`.** Billing, studio and the
job service configure `JwtGrantedAuthoritiesConverter` with `setAuthoritiesClaimName("roles")` and
`setAuthorityPrefix("")`, so the authority *is* the raw claim value. A prefixed matcher fails closed
against a correct token, and the tempting repair — loosening the matcher — puts the hole back. The
audit's own prescription (`hasAuthority("SCOPE_internal")`) is wrong for this reason and has been
corrected in the audit document.

**Identity is different and needed a second change.** It authenticates through an opaque-token
`AuthenticationManager` that resolves authorities from the *user record*, not from a claim. A
correctly signed `SERVICE` token had no user row to hydrate and would have failed the lookup. Its
`resolveSessionPrincipal` now recognises a token whose sole role is `SERVICE` and returns a
synthetic principal holding that one authority. The signature is still verified first; only the
principal differs.

**2. The edge's non-routing of `/internal/**` stays.** Two layers, and the ordering matters: the
token is the control, the topology is the backstop.

**3. Media is a resource with an owner.** `GET /api/v1/assets/{jobId}/{filename}` resolves the owner
from the job record and refuses anything else with `404` — never `403`, which would confirm the file
exists and turn the endpoint into an enumeration oracle. The static handler and its CORS mapping are
deleted rather than hardened: serving a tenant's disk through a handler that cannot express
ownership is the defect, not a configuration of it.

## Alternatives considered

**mTLS — deferred, not rejected.** It authenticates the *channel* and does not depend on a shared
secret, which is strictly stronger than what is adopted here. It is deferred because it needs a
certificate authority, rotation, and a service mesh or sidecar to terminate — none of which exist in
the current 100 % local phase (AGENTS.md §0), and introducing them would be a larger change than the
hole being closed. **When the platform reaches a mesh, mTLS replaces the shared-secret token and this
ADR should be superseded.**

**Per-service credentials.** Each caller holding its own secret would bound the blast radius of a
leak to one service. Rejected for now only because it needs somewhere to keep and rotate five
secrets — the same missing infrastructure as mTLS — and the shared secret is already the trust root
every validator uses. This is the cheaper of the two upgrades and should come first.

**Keeping topology as the only control.** Rejected: see Context.

## Consequences

**Accepted weakness, stated plainly.** Any process holding the shared identity secret can mint a
`SERVICE` token. The boundary is the secret, not the caller — so a compromise that yields the secret
yields the internal surface. That is a real reduction of the value of this control, and it is why
the two alternatives above are queued rather than closed.

**The token is minted in three places** — both Tier-2 clients and the conversation service's
identity adapter — because no shared Tier-2 module exists for them to inherit from. Wave 3's
`orazaka-service-kit` (audit §5.2) is where the three become one. Duplicating deliberately and
naming the successor beats creating the kit inside a security change.

**A fitness function, not just three fixed files.** `GovernanceRules.assertNoPermitAllOnInternalOrUploads`
scans every `SecurityConfig` and fails on `permitAll()` applied to a matcher containing `/internal`
or `/uploads`. It is wired into all six service governance suites. Fixing four configs by hand is
worth little on its own: the fifth service reintroduces the pattern and nothing notices — which is
precisely how three services ended up with the same defect.

**Known gap.** `orazaka-knowledge-service` exposes `/internal/v1/knowledge` and has neither
`spring-boot-starter-security` nor a `SecurityConfig`, so its internal surface is open and there is
no `permitAll()` for the rule above to catch. It is not in the audit's finding #3 and was outside
this wave's file manifest. It needs the same treatment and a rule that also fails on a service that
exposes `/internal/**` with no security on the classpath at all.

## Related

- [Production readiness audit](../PRODUCTION_READINESS_AUDIT.md) §2.1, §2.3, §2.4
- [ADR-033 — credit metering and billing](ADR-033-credit-metering-and-billing.md)
- [ADR-034 — Studio marketplace](ADR-034-studio-marketplace.md)
- [Security standards](../../.agent/rules/security_standards.md)
