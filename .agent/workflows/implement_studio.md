---
description: STUDIOS — PHASED IMPLEMENTATION (phase 0 = contract + schema foundations)
---

# Workflow: Implement the Studio context (installable business workflows)

Design intent: [`docs/STUDIO_ARCHITECTURE.md`](../../docs/STUDIO_ARCHITECTURE.md).
Decision record: [`docs/adr/ADR-034-studio-marketplace.md`](../../docs/adr/ADR-034-studio-marketplace.md).
**That design document is normative for *what* and *why*. This workflow is normative for *how* and
*in what order*. Where they disagree, the design document wins and this file is corrected.**

## §0 Init

1. Load `AGENTS.md` (the governance contract) — §0, §2, §3, §4, §5, §6, §9, §11 all bind this work.
2. Load `.agent/rules/naming_conventions.md`, `configuration_standards.md`, `messaging_standards.md`,
   `testing_standards.md`.
3. Read `docs/STUDIO_ARCHITECTURE.md` §1 (naming), §4 (domain model), §5 (schema), §6 (the DSL),
   §16 (rollout), §17 (governance), §20 (manifest).
4. Read for pattern-matching **before writing anything**:
   - `infra/initdb/70-billing.sql` — the own-database initdb shape, the immutability trigger, the
     opaque-`actor_id` convention
   - `krizaka/krizaka-billing/krizaka-billing-api/` — the Tier-1 contract module shape (this is the
     closest sibling: same tier, same era, same conventions)
   - `.agent/workflows/implement_billing.md` — the tranche discipline that produced it
   **Mirror these. Do not invent a new structure.**

## §1 Scope of THIS run — phase 0 only

Phase 0 is **Tier-1 contract + schema + enum widening + module registration**. It contains **no
Spring bean, no service module, no controller, no consumer, no UI**. It is deliberately the slice
with zero wiring risk, because everything else depends on it.

**In scope** — exactly the file manifest of §3.
**Out of scope, do NOT start** — `orazaka-studio-service`, the DAG interpreter, adapters,
`BrandContextInterceptor`, the `media.compose` capability, any `.tsx`, any CLI verb. Those are
phases 1–5 (design §16). If phase 0 is green and you have budget left, **stop and report**, do not
continue.

## §2 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 — 100% local | No CI, no cloud, no remote secret, no new network dependency. |
| AGENTS.md §5 — own DB, no cross-context FK | `80-studio.sql` creates its own role + database. **Every `REFERENCES` must target a table created in the same file.** `actor_id`, `pack_key`, `feature_key`, `job_id`, `hold_id`, `asset_id` are opaque `VARCHAR`, never FKs. `SqlBoundaryRules` [SEAM-001] fails the build otherwise. |
| AGENTS.md §5 — own dedup copy | The studio DB carries its **own** `processed_messages` (contract-copy), not a shared one. |
| AGENTS.md §4 — config vs data | Studios, blueprints, limits are **rows**. Nothing about a Studio in any `application.yml`. |
| AGENTS.md §2 — tier purity | `orazaka-studio-api` is Tier-1: **zero** implementation dependencies — no Spring, no Jackson, no JPA, no Lombok. Pure JDK + JUnit (test scope). It must **not** import `com.orazaka.business.*` or `com.krizaka.billing.*`. |
| ERR-103 | One top-level type per `.java` file **+ one mirroring test file**. |
| ERR-106/116 | Records validate in the **compact constructor**. No service-side null guards. |
| ERR-104 | No `Orazaka` class prefix. |
| ERR-127 | No `*Util`/`*Helper` static classes. `RunScope` resolves its own placeholders — smart payload. |

## §3 File manifest — phase 0

```
CREATE  infra/initdb/80-studio.sql
MODIFY  infra/initdb/00-reset.sql                        (+ studio drop block, + file inventory line)
MODIFY  infra/initdb/70-billing.sql                      (+ realestate-studio package & entitlement seed)
MODIFY  infra/initdb/30-jobs-config.sql                  (+ orazaka.studio.media.compose capability row, is_enabled=false)
CREATE  orazaka-apps/services/orazaka-studio/orazaka-studio-api/pom.xml
CREATE  …/src/main/java/com/orazaka/studio/domain/model/StudioPricing.java
CREATE  …/domain/model/StudioStatus.java
CREATE  …/domain/model/BlueprintStatus.java
CREATE  …/domain/model/StepKind.java
CREATE  …/domain/model/ErrorPolicy.java
CREATE  …/domain/model/InstallationStatus.java
CREATE  …/domain/model/RunStatus.java
CREATE  …/domain/model/Studio.java
CREATE  …/domain/model/Blueprint.java
CREATE  …/domain/model/BlueprintStep.java
CREATE  …/domain/model/BlueprintOutput.java
CREATE  …/domain/model/Installation.java
CREATE  …/domain/model/Run.java
CREATE  …/domain/model/RunStep.java
CREATE  …/domain/model/RunScope.java
CREATE  …/domain/model/StepDispatch.java
CREATE  …/domain/exception/BlueprintValidationException.java
CREATE  …/domain/exception/StudioNotEntitledException.java
CREATE  …/domain/port/StudioCatalogClient.java
CREATE  …/domain/port/StudioRunClient.java
CREATE  …/src/test/java/com/orazaka/studio/domain/model/*Test.java   (one per type — ERR-103)
MODIFY  orazaka-libs/orazaka-ai-engine/orazaka-business/.../api/Capability.java        (+ STUDIO)
MODIFY  orazaka-libs/orazaka-ai-engine/orazaka-business/.../api/Payload.java           (+ permits StudioPayload)
CREATE  orazaka-libs/orazaka-ai-engine/orazaka-business/.../api/StudioPayload.java
CREATE  orazaka-libs/orazaka-ai-engine/orazaka-business/src/test/.../api/StudioPayloadTest.java
MODIFY  pom.xml                                          (+ <module> next to krizaka-billing-api)
MODIFY  .env  /  exemple.env.txt                         (+ §6 block, secrets = CHANGE_ME)
```

## §4 `infra/initdb/80-studio.sql` — write it verbatim from design §5

Header comment in the house style of `70-billing.sql` (owner, purpose, opaque-id note). Then:

```sql
CREATE ROLE orazaka_studio LOGIN PASSWORD 'orazaka_studio_pass';
CREATE DATABASE orazaka_studio_db OWNER orazaka_studio;
\c orazaka_studio_db
SET ROLE orazaka_studio;
```

Then the tables **exactly as specified in `docs/STUDIO_ARCHITECTURE.md` §5**, in this order:
`studio` (+ `studio_pricing_needs_package` CHECK, + `idx_studio_browse`) · `studio_i18n` ·
`studio_blueprint` (+ the **immutability trigger**) · `studio_installation` (+ the
`UNIQUE (actor_id, studio_key)`, + `idx_installation_actor`) · `studio_run` (+ both indexes) ·
`studio_run_step` (+ `idx_run_step_job`) · `studio_outbox` (+ partial pending index) ·
`processed_messages` · `studio_runtime_config` (+ its four seeded keys).

**Do not omit `trg_studio_blueprint_immutable`** (design §5) — it is a fitness function, not
decoration, and it is the reason phase 3 can trust a pinned version. Note the difference from
`credit_ledger_entry`: this trigger is *conditional* — it must allow a `DRAFT → PUBLISHED` status
transition and forbid any change to `definition`/`input_schema` once `PUBLISHED`, plus all `DELETE`s.

### Seed data (dev only, idempotent)

All inserts `ON CONFLICT … DO NOTHING`:

1. **`studio_runtime_config`** — the four keys of design §5.
2. **`studio`** — the two launch Studios of design §11:
   - `trade-showcase` — *"Vitrine Artisan"*, profession `trades`, `pricing = 'FREE'`,
     `pack_key NULL`, `entitlement_key = 'studio.trade-showcase'`, `status = 'PUBLISHED'`,
     `latest_version = '1.0.0'`.
   - `realestate-reels` — *"Reels Immobilier"*, profession `real-estate`, `pricing = 'PAID'`,
     `pack_key = 'realestate-studio'`, `entitlement_key = 'studio.realestate-reels'`,
     `status = 'DRAFT'`, `latest_version NULL`. **DRAFT on purpose**: its blueprint needs the
     `media.compose` capability, which does not exist until phase 4. Publishing it in phase 0 would
     break fitness function #2 of design §15.
3. **`studio_i18n`** — `fr` + `en` rows for both.
4. **`studio_blueprint`** — `trade-showcase` `1.0.0`, `status = 'PUBLISHED'`, with a **chat+image
   only** definition (no `media.compose`, no `APPROVAL`, no `CONNECTOR`): a `describe` fan-out over
   photos via `orazaka.core.media.vision`, a `caption` step via `orazaka.core.chat.completion`, an
   `image` step via `orazaka.core.media.image`. This is the phase-3 acceptance fixture — it must run
   with **zero new capability**. `realestate-reels` gets no blueprint row in phase 0.
   Every `featureKey` in the definition **must already exist and be enabled** in
   `orazaka_capabilities` (read `30-jobs-config.sql` and copy the keys verbatim; do not guess).
5. **No `studio_installation` / `studio_run` seed.** An installation belongs to an actor and phase 2
   creates it through the API; seeding one here would pre-empt the entitlement gate under test.

### `70-billing.sql`

Add, in the existing seed style: a `billing_pack` row `realestate-studio` (label
*"Studio Immobilier"*, `profession = 'real-estate'`, a placeholder `price_cents`,
`included_credits`, `is_active = true`) and its `billing_pack_entitlement` row
`studio.realestate-reels = 'true'` (`value_type = 'boolean'`). Also add
`studio.trade-showcase = 'true'` to **every** plan's `billing_plan_entitlement` matrix — a `FREE`
Studio still needs its key granted, otherwise `EntitlementSnapshot.allows` reads an absent key as a
denial (that is the documented behaviour, not a bug to work around in code).

### `30-jobs-config.sql`

Add one `orazaka_capabilities` row:
`('orazaka.studio.media.compose', 'Studio Media Composition', 'video', 'media.compose', '/api/v1/media/generation/compose', 'POST', <payload_template>, false)`.
**`is_enabled = false`** — the worker branch lands in phase 4. Registering it now keeps the key
stable and lets phase 3's validator reject it with a clear message instead of "unknown feature".

### `00-reset.sql`

Add, next to the existing billing block and in the same comment style:

```sql
-- Studio context: its own database — dropped wholesale.
DROP DATABASE IF EXISTS orazaka_studio_db WITH (FORCE);
DROP ROLE IF EXISTS orazaka_studio;
```

Also add the `80-studio.sql` line to the file-inventory comment at the top.

## §5 `orazaka-studio-api` — the Tier-1 contract

`pom.xml`: copy `krizaka/krizaka-billing/krizaka-billing-api/pom.xml` verbatim, change
`artifactId`/`name`/`description`. **No dependency beyond `junit-jupiter` (test scope).**

Package root `com.orazaka.studio.domain`. Implement design §4 exactly, with compact-constructor
validation (ERR-106) and Javadoc on every public type. The validation that matters:

- **`Studio`** — `studioKey`/`label`/`profession`/`entitlementKey` non-blank;
  `pricing == PAID ⇒ packKey != null` (mirror the SQL CHECK — the invariant belongs to the type,
  not only to the table); `locales` defensively copied.
- **`Blueprint`** — this is the load-bearing one. The compact constructor **must** reject:
  empty `steps`; duplicate `step.id`; a `dependsOn` that names no step; a **cycle** (iterative
  Kahn/DFS, no recursion on untrusted depth); an `out` name collision; a `CAPABILITY` step with a
  blank `featureKey`; a `forEach` on a step whose `maxParallel < 1`. Throw
  `BlueprintValidationException` carrying the offending step id — a caller must be able to point the
  admin at the exact node.
  Placeholder resolution against the input schema is **phase 1** (it needs a JSON Schema reader,
  which is a Jackson dependency and therefore forbidden in Tier-1): here, validate only the
  **grammar** of each `{{ … }}` occurrence.
- **`BlueprintStep`** — `id` non-blank and matching `^[a-z][a-z0-9-]{0,59}$`; `kind` non-null;
  `dependsOn`/`inputs` defensively copied; `maxAttempts >= 1`; `timeout` non-null and
  `<= Duration.ofHours(1)`.
- **`RunScope`** — the **smart payload** (ERR-127). It exposes
  `String resolve(String template)` and `boolean matches(String condition)` and holds
  `inputs`/`config`/`steps`/`item`/`secrets` as immutable maps. Supported grammar, and **nothing
  else** (design §6.2): `{{inputs.x}}`, `{{config.x}}`, `{{steps.<out>.<field>}}`, `{{item}}`,
  the `{{key:default}}` fallback, and the four conditions `== <literal>`, `!= <literal>`,
  `is null`, `is not null`. An unrecognised form throws — it never silently renders empty.
  `secrets` is readable by `resolve` but **`toString()` must not contain it**; write the test.
- **`StepDispatch`** — the record `business` hands to `StepExecutionClient`:
  `(runId, stepId, ordinal, featureKey, resolvedInputs, actorId, correlationId, holdId)`.

Ports (interfaces only, no default methods):

```java
public interface StudioCatalogClient { List<Studio> browse(String profession); Optional<Studio> find(String studioKey); }
public interface StudioRunClient    { String start(UUID installationId, Map<String, Object> inputs); Optional<Run> find(UUID runId); }
```

### `orazaka-business` widening

```java
public enum Capability { CHAT, IMAGE, AUDIO, VIDEO, AGENT, ADMIN, STUDIO }

public sealed interface Payload extends UseCasePayload
    permits ChatPayload, ImagePayload, AgentPayload, StudioPayload {}

public record StudioPayload(UUID installationId, Map<String, Object> inputs) implements Payload {}
    // validate: installationId non-null · inputs non-null, Map.copyOf
```

`business` must **not** depend on `orazaka-studio-api` in this phase — `StudioPayload` is a
deliberate contract-copy-free record using only JDK types, exactly as `BillableCapability` is a
contract-copy of `Capability` in the opposite direction. Adding the dependency is a phase-3
decision.

**Check the blast radius of widening `Capability`**: `SpringUseCaseRegistry.resolve` matches on
capability and any `switch` over the enum elsewhere may now be non-exhaustive. Compile the whole
reactor and fix what breaks — do not add a `default` branch to silence it.

## §6 `.env` / `exemple.env.txt`

Append a `# ── STUDIO ──` block in the house style, next to the billing block:

```
STUDIO_PORT=8096
STUDIO_INTERNAL_URL=http://localhost:8096
STUDIO_DB_NAME=orazaka_studio_db
STUDIO_DB_USER=orazaka_studio
STUDIO_DB_PASSWORD=CHANGE_ME        # exemple.env.txt only; .env carries the dev value
```

`8096` is free — verify against the port table in design §3 (8080 · 8082 · 8083 · 8084 · 8088/8089 ·
8090 · 8095) and against `infra/docker-compose.yml` before committing to it. **Note**: an earlier
tranche of `implement_billing.md` published Lago's API on `127.0.0.1:8096`. If that mapping is still
present in `infra/docker-compose.yml`, move Lago to `8098` — an opt-in profile yields to a
first-class service — and say so in the report.

No `orazaka.studio.*` key beyond wiring. Limits live in `studio_runtime_config`.

## §7 Acceptance gate — run these, in order

```bash
# 1. The contract module compiles and its tests pass
./mvnw -q -pl orazaka-apps/services/orazaka-studio/orazaka-studio-api test

# 2. The whole reactor still builds — this is the Capability-widening blast-radius check
./mvnw -q -DskipTests install

# 3. Architecture + data seam. SEAM-001 is exercised by SqlBoundaryTest in persistence, and that is
#    the one that actually reads 80-studio.sql. Run both.
./mvnw -q -pl orazaka-libs/orazaka-ai-engine/orazaka-core -Dtest=GovernanceTest test
./mvnw -q -pl orazaka-libs/orazaka-ai-engine/orazaka-persistence-app -Dtest=SqlBoundaryTest test

# 4. The local loop still comes up unchanged
orazaka stop --purge && orazaka start
docker ps --format '{{.Names}}'

# 5. The studio database exists, is seeded, and the blueprint is immutable once published
psql -h localhost -U orazaka_studio -d orazaka_studio_db -c "\dt"
psql -h localhost -U orazaka_studio -d orazaka_studio_db \
     -c "SELECT studio_key, pricing, status, entitlement_key FROM studio ORDER BY studio_key;"
psql -h localhost -U orazaka_studio -d orazaka_studio_db \
     -c "UPDATE studio_blueprint SET definition = '{}'::jsonb WHERE status = 'PUBLISHED';"
     # MUST fail with the trigger's exception
psql -h localhost -U orazaka_studio -d orazaka_studio_db \
     -c "UPDATE studio_blueprint SET status = 'DEPRECATED' WHERE status = 'PUBLISHED';"
     # MUST succeed — the trigger is conditional, not a blanket ban

# 6. The billing side grants the keys
psql -h localhost -U krizaka_billing -d krizaka_billing_db \
     -c "SELECT * FROM billing_pack_entitlement WHERE entitlement_key LIKE 'studio.%';"

# 7. Every featureKey in the seeded blueprint exists and is enabled (fitness function #2, by hand
#    until phase 3 automates it). Cross-read 30-jobs-config.sql; the seeded trade-showcase
#    blueprint must reference only enabled keys, and NOT orazaka.studio.media.compose.
```

Phase 0 is done when **all seven** pass. In step 5 the failing `UPDATE` is a **success**: if it
succeeds, the trigger is missing and a published blueprint is not immutable.

## §8 Do NOT

- **Do not** create `orazaka-studio-service` in this phase.
- **Do not** add any Spring, Jackson or JPA dependency to `orazaka-studio-api`.
- **Do not** import `com.orazaka.business.*` or `com.krizaka.billing.*` from the contract module.
- **Do not** add a foreign key from a studio table to any table outside `80-studio.sql`.
- **Do not** enable `orazaka.studio.media.compose` or publish `realestate-reels`.
- **Do not** put a Studio, a blueprint, a limit or a price in any `application.yml`.
- **Do not** implement an expression evaluator, a scripting engine or a template library in
  `RunScope` — the grammar of design §6.2, literally, and throw on anything else.
- **Do not** touch the user's uncommitted working-tree changes.
- **Do not** commit or push — the user reviews the diff and commits.
- **Do not** modify `docs/_generated/*` by hand.

## §9 Before declaring done

1. Run the `.agent/workflows/review_architect.md` gate.
2. `80-studio.sql` and `.env` changed ⇒ run `.agent/workflows/sync_documentation.md`.
3. Report: the file list you actually created/modified, the seven gate results verbatim, and **any
   place where you had to deviate from `docs/STUDIO_ARCHITECTURE.md`** — a deviation is a design bug
   to fix in the document, not a detail to absorb silently.

## §10 Next phases (do not start without an explicit go)

Per design §16. Each phase ends green (build + `GovernanceTest`) and is a valid recovery checkpoint.

- **Phase 1 — catalogue read-only.** `orazaka-studio-service` :8096 (mirror
  `orazaka-knowledge-service`, the smallest complete service shape), `StudioController`,
  JSON-Schema placeholder validation, edge route, UI `/studios` grid + detail. Design §3, §10, §12.
- **Phase 2 — install + config.** `StudioInstallationController`, the `EntitlementProvider` gate
  (honour `snapshot.resolved()`), `InstallDialog`, *Mes Studios*. Design §8.
- **Phase 3 — engine + run.** `orazaka-business/usecases/studio/`, `BlueprintRepository` +
  `StepExecutionClient` ports, the saga listener, one hold per run, `RunSweeper`. Validate with
  `trade-showcase` — it needs no new capability, so any failure is unambiguously an engine bug.
  Design §6, §7.
- **Phase 4 — media composition.** `orazaka.studio.media.compose` in `orazaka-worker-media`,
  publish `realestate-reels`, the `APPROVAL` step, pricebook rows. Design §7.2, §11.1.
- **Phase 5 — authoring + lifecycle.** Admin Studio Builder, publish workflow, upgrade banner,
  retention job, analytics, `orazaka studio` CLI verb, blueprint catalogue in `orazaka docs build`.
  Design §12.4, §14.
