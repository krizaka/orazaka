# ADR-029 — AI providers are DB-driven; `application.yml` only bootstraps the framework default bean

- **Status**: Accepted
- **Date**: 2026-06-15
- **Scope**: `products/orazaka` (router app, core Provider Mesh, `ai_providers` table)
- **Relates to**: AGENTS.md §4 (Config vs data — domain data lives in the DB), ADR-027 (single-source `application.yaml`)

## Context

AI providers (name / base-url / api-key) exist in the database table **`ai_providers`** (seeded in
`infra/init.sql`: `ollama`→11434, `localai`→8085, `localai-image`→8086, `localai-video`→8188) and are
read at runtime — `CatalogModelManagerImpl.getProviderBaseUrl(name)` resolves a provider's base-url from
`AiProviderRepository`, and the Provider Mesh (`DynamicChatModelProvider`, `OpenAi/Anthropic/Gemini
DynamicProvider`) builds model clients dynamically (Spring AI's OpenAI auto-config is **excluded** in
`application.yml`).

At the same time, `application.yml` still declares `spring.ai.ollama.*` and `spring.ai.localai.*`. This
looked like a duplicated, competing source of truth: "providers are in the DB — why is there provider
config in yaml?". The risk is **drift** — two places defining a provider's base-url, with no written
rule about which wins.

Reality (verified in code): the DB is **already** the authoritative runtime source for provider
selection; the yaml entries only bootstrap the **framework's default beans** (the default Ollama chat
bean + the OpenAI-compatible local endpoint Spring AI needs to stand up), and they are **env-driven**
(`${OLLAMA_BASE_URL}`, `${LOCALAI_BASE_URL}`) using the **same** env vars the DB seed defaults mirror.
Image (8086) and video (8188) providers exist **only** in the DB. So the architecture is right; it was
just undocumented and un-guarded against drift.

## Decision

**`ai_providers` (DB) is the single source of truth for provider base-url / api-key at runtime.** The
admin pilots providers from the DB (and the admin console), with no redeploy.

`application.yml` `spring.ai.*` is **bootstrap-only**: it exists solely so the Spring AI framework can
instantiate its default beans at startup. It must stay **minimal** and **env-driven**, and the env vars
it reads (`OLLAMA_BASE_URL`, `LOCALAI_BASE_URL`, …) are the **same** values the `ai_providers` seed
defaults to — so the two cannot disagree (one env source, two consumers).

**Rules**
- New providers and any change to a provider's base-url/api-key go in **`ai_providers`** (DB), never in
  `application.yml`.
- The only provider config allowed in yaml is the minimal framework bootstrap (default Ollama bean +
  the OpenAI-compatible local endpoint), strictly via `${ENV:default}` placeholders.
- Runtime code resolves provider endpoints through `CatalogModelManager` / the Provider Mesh
  (DB-backed), never by reading `spring.ai.*` directly.
- "Full dynamic" (removing the framework bootstrap entirely and building every model bean from the DB at
  startup) is **explicitly out of scope** — higher risk for no functional gain, since selection is
  already DB-driven.

## Consequences

- **Positive**: ends the "DB or yaml?" ambiguity; the admin owns providers from the DB; no drift (single
  env source feeds both); aligns with AGENTS.md §4 + ADR-027.
- **Cost**: none structural — this ratifies and guards the existing design. `application.yml` gains a
  comment pointing here; reviewers reject provider config added to yaml beyond the bootstrap.
- **Enforcement**: documentation gate (`review_architect` §2) + this ADR; the `application.yml` comment
  references ADR-029.
