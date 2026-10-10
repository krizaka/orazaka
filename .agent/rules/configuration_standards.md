# Rule: Configuration Standards (config vs data)

> One principle governs all configuration: **`application.yaml` = infrastructure wiring only; the DB = domain data & behavior.** Never duplicate one in the other. See `AGENTS.md` §4–§5.

## §1 Config vs Data (the dividing line)
- **Belongs in `application.yaml`** (infra wiring, env-driven): ports, connection strings (DB/Redis/RabbitMQ), framework knobs (Hikari, AMQP listener), Spring AI runtime endpoints (Ollama base-url), security wiring (OAuth client registrations), management/resilience/logging, global operational switches (`orchestration.enabled`, `security.disable-ai`).
- **Belongs in the DB** (domain data & behavior, read at runtime — **forbidden in yaml**):
  - capability / feature registry (enabled, label, icon, uri, payload template) → `FeatureFlagEntity` / capabilities table (ADR-027).
  - model catalog & default model → `orazaka_models` (`is_default`). Never hardcode a default model in yaml.
  - interceptor pipeline order & per-interceptor enable → `pipeline_interceptor_config` + governance policies.
  - rate-limit tiers & default tier → `rate_limit_tier`.
- **Litmus test**: if a non-developer (admin) would ever change it at runtime, or it already exists as a DB row, it is **data** → DB, not yaml.

## §2 Single source — zero duplication
- Every value is declared **once**. If two keys need the same value, both reference the **same** `${ENV_VAR}` — never two literals.
- One concept = one key. Example: keep exactly two timeouts — `spring.mvc.async.request-timeout` (HTTP) and `orazaka.jobs.execution-timeout` (job). No third overlapping timeout.
- A yaml "fallback" for a value that also lives in the DB is duplication — **banned**. Resolve from the DB; if the DB is empty, fail clearly or seed via `infra/initdb/`.

## §3 Naming & grouping
- All app properties under `orazaka.<module>.<concern>` (`orazaka.router.*`, `orazaka.core.*`, `orazaka.identity.*`, `orazaka.messaging.*`). No cross-module mixing (no `media`/`features` siblings duplicating `core`).
- **Banned**: bracketed dotted map keys (`"[orazaka.core.media.video]"`), vague namespaces (`spring.ai.custom.*`), root-level domain keys (move `crypto` → `orazaka.identity.crypto`).
- File layout, in order: `server` → `spring` (framework) → `management`/`resilience4j`/`logging` → `orazaka.*` (by module). Local phase = **single file**, no per-profile overlay.
- **A service on the Krizaka starters** (ADR-074) splits by audience, never by profile: `application.yml` (≤ 20 lines) holds what a deployment decides; its operating defaults (Hikari, listener, timeouts, upload limits) live in `META-INF/orazaka/<service>-defaults.yml`, the lowest-priority source. Each value is still declared once.

## §4 Typed properties (no loose values)
- Every `orazaka.*` group is backed by a **`@ConfigurationProperties` record** (immutable, validated in the compact constructor) — **no scattered `@Value`** injections.
- `@ConfigurationProperties` lives in the module it configures (`infrastructure.config`), package-private where possible.

## §5 No hardcoded domain data, no hardcoded secrets
- Infra defaults via `${ENV_VAR:default}` are fine. Hardcoded **domain data** (feature lists, model names, interceptor toggles) is **banned** — it belongs in the DB (§1).
- **Never** a non-empty secret default (no `dummy-secret`). Secrets default to empty (`${X:}`), and the dependent feature (e.g. OAuth registration) is **conditional** on the secret being present.
- Keep per-class log levels minimal in the committed file.

## §6 Quick reference — where each thing lives
| Concern | yaml | DB |
| :--- | :---: | :---: |
| ports, datasource, redis, rabbitmq, Ollama endpoint | ✅ | |
| Hikari / listener / resilience / logging | ✅ | |
| OAuth client registrations (secrets via env) | ✅ | |
| global switches (`orchestration.enabled`, `disable-ai`) | ✅ | |
| crypto key/salt (env) under `orazaka.identity.crypto` | ✅ | |
| feature / capability registry | | ✅ |
| model catalog + default model | | ✅ |
| interceptor order + per-interceptor enable | | ✅ |
| rate-limit tiers + default tier | | ✅ |
