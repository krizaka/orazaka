# ADR-027 — Single-source `application.yaml`: domain config lives in the database

- **Status**: Accepted
- **Date**: 2026-06-10
- **Scope**: `products/orazaka` (router app + framework modules)
- **Supersedes**: the scattered `orazaka.*` domain-config keys previously held in `application.yml`

## Context

`application.yml` had drifted into mixing two unrelated concerns:

1. **Infrastructure wiring** — env-driven, deploy-time values (ports, datasource URL,
   broker tuning, multipart limits, OAuth client ids). These legitimately belong in
   config.
2. **Domain data & behaviour** — the capability/feature registry, per-interceptor
   enable + ordering, the default model per category, and rate-limit tiers. These are
   operational data an admin changes at runtime; encoding them in yaml meant they were
   duplicated, drifted from the database, required a redeploy to change, and (worse)
   were read from two places at once.

Concrete symptoms found during the migration: a capability blueprint existed **both**
as `orazaka.features.*` yaml **and** in two separate DB tables/consumers
(`orazaka_feature_flags`, `FeatureRegistryProperties`); per-interceptor `enabled`
flags existed in yaml **and** in `pipeline_interceptor_config`; the same `UPLOAD_DIR`
was bound under two different keys; several `orazaka.*` values were read via loose
`@Value` instead of typed records.

## Decision

**`application.yaml` is infrastructure wiring only.** Every value is env-driven
(`${ENV:default}`), declared exactly once, and bound to a typed
`@ConfigurationProperties` record — no loose `@Value` for `orazaka.*`. All domain data
and behaviour is read from the database as the single source of truth:

| Domain concern | Single source (DB) | Read through |
|:---|:---|:---|
| Operation-graph capabilities (blueprint + enabled) | `orazaka_capabilities` | `CapabilityProvider` port → `GraphEngine`, `AdminFeatureController`, `BootstrapController` |
| Per-interceptor enable / order | `pipeline_interceptor_config` | `PipelineConfigProvider` → `PipelineRegistry` / `DynamicPipelineExecutor`; `PipelineRegistry.isInterceptorEnabled` |
| Default model per category | `orazaka_models.is_default` | catalog model service (no yaml fallback) |
| Rate-limit default tier | `orazaka_rate_limits.is_default` | `RateLimitProvider` |

`application.yml` retains only: master switches (`orazaka.core.orchestration.enabled`,
`orazaka.security.disable-ai`), routing mode, model-wiring for the refiner/router AI
stages, and pure infra (`orazaka.router.uploads`, `orazaka.jobs`, `orazaka.messaging`,
`orazaka.identity.crypto`, datasource/broker, OAuth client wiring).

### Migration phases (commit-per-green)

- **Phase 2** — media default video model resolves from `orazaka_models.is_default`; dropped `orazaka.media.video-default-model`.
- **Phase 3** — rate-limit default tier resolves from `orazaka_rate_limits.is_default`; deleted `RateLimitProperties`.
- **Phase 4** — capability registry → `orazaka_capabilities` (supersedes `orazaka_feature_flags` + `orazaka.features.*` yaml + `FeatureRegistryProperties`); new core `CapabilityProvider` port + `CapabilityDescriptor`.
- **Phase 5** — per-interceptor enable → `pipeline_interceptor_config`; dropped `orazaka.core.orchestration.{user-context,system-context,refiner,router}.enabled`.
- **Phase 6** — typed-props sweep: `JobsProperties` replaces the loose `@Value execution-timeout`; single `UPLOAD_DIR` source (dropped duplicate `spring.servlet.multipart.location`).

## Consequences

**Positive.** One source of truth per concern; admins change capabilities, the pipeline,
models, and tiers at runtime (no redeploy); no yaml/DB drift; every `orazaka.*` is a
typed, self-validating record.

**Negative / trade-offs.** Domain config now requires the database to be reachable at
read time (the operation graph and pipeline degrade gracefully — empty graph /
default chain — if a provider is absent). Seed data moves into `infra/init.sql`, which
only applies to a fresh volume (existing dev DBs need re-seeding).

**Verification note (important).** `@ConfigurationProperties` binding failures surface
**only at application boot**, not in offline compile/unit/ArchUnit tests — removing a
yaml key that still has a binder NPEs at startup (this happened with
`FeatureRegistryProperties` in Phase 4). Every yaml/binding change in this line of work
must be boot-verified against live infra, not just unit-tested.
