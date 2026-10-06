# ADR-033 — Credit metering & billing: local append-only ledger, Lago for money

- **Status**: Accepted (design; phases 0–3 local per §0, phase 4 gated on leaving the local phase)
- **Date**: 2026-07-29
- **Scope**: `products/orazaka` — new `orazaka-billing-service` :8095, new Tier-1 contract
  `orazaka-libs/contracts/orazaka-billing-api`, `infra/initdb/70-billing.sql`,
  `orazaka-interceptors/governance/`, media worker `job.done` payload, `orazaka-web-admin`
- **Extends**: ADR-027 (DB-driven config), ADR-031 (config governance), ADR-032 (service decomposition)
- **Design**: [`docs/BILLING_ARCHITECTURE.md`](../BILLING_ARCHITECTURE.md)

## Context

Orazaka sells variable-cost compute, not seats: a four-second video costs three orders of magnitude
more to produce than a chat reply. The product requires (a) three subscription plans today
(`free`/`premium`/`ultimate`) with more addable later without a deploy, (b) à-la-carte credit
purchase, (c) admin configuration of all of it, and (d) a path to selling curated workflow bundles
per profession.

Two properties make this more than a Stripe subscription. **Authorisation must precede execution** —
once an MLX video job starts on the Mac the cost is sunk, so a post-paid model lets a zero-balance
user burn an hour of GPU. And **the estimate is never the truth** — a chat turn's token count is
unknown before generation. Neither a pure pre-paid debit nor a pure post-paid meter satisfies both.

A third constraint is specific to this product: with Ollama/MLX on owned hardware there is **no
upstream provider invoice to pass through**. The cost basis is GPU-seconds on a hardware class, so
the price table must be *calibrated from measurement*, not derived from a vendor's rate card.

Finally, AGENTS.md §0 forbids cloud dependencies and remote secrets in the current phase, while the
product's differentiator is Loi 25 / GDPR sovereignty. Any answer that puts the authorisation
decision inside a proprietary SaaS contradicts both.

## Decision

### 1. A two-phase hold/settle protocol over an append-only ledger owned by Orazaka

`hold` (reserve an estimate before execution) → `settle` (debit measured reality) → `release` (a
failed job is never billed). Over-drafting is prevented **at the database level** by a `CHECK`
constraint plus a conditional single-statement `UPDATE`, not by application logic — concurrent
submissions cannot both consume the same last credits. An `idempotency_key UNIQUE` on the ledger,
combined with the existing `processed_messages` dedup, makes at-least-once delivery safe: a
double-debit is unrecoverable trust damage and warrants two independent guards.

`credit_ledger_entry` is append-only **by construction** — a `BEFORE UPDATE OR DELETE` trigger raises,
which a `REVOKE` would not achieve (the table owner keeps implicit rights on its own table), and an
ArchUnit rule forbids mutating repository methods. `balance_after` on every row makes the ledger
self-verifying under replay.

An `ACTIVE` hold past its TTL is released by a sweeper. Without it a worker crash freezes a user's
balance permanently; this is the most commonly omitted component of credit systems and is therefore
a build-enforced fitness function, not a TODO.

### 2. The ledger authorises; Lago invoices

**Lago** (AGPLv3, self-hosted in `docker-compose`, v1.45.1 — April 2026) owns plans, prorata,
invoices, dunning, tax and PSP orchestration. Orazaka owns the real-time ledger, holds, pricebook and
entitlements. The split follows one criterion: **is it on the hot path of a user request?**

Authorisation is. It cannot depend on an external service's latency or availability, and a
sovereignty-positioned product cannot put the "may this run?" decision in a third party. Invoicing is
not: it is solved, regulated, boring work with a long tail of legal edge cases (mid-cycle upgrades,
VAT per jurisdiction, failed-payment retries) that we must not rewrite.

Consequence: if Lago is down, Orazaka keeps authorising and metering; `evt.usage.recorded` queues in
the transactional outbox and drains on recovery.

### 3. RabbitMQ for settlement, sync HTTP for authorisation

Per AGENTS.md §6 (*broker = heavy/deferred/event-driven; synchronous = low-latency interactive*):

- **Synchronous HTTP** (`@HttpExchange`, M2M JWT): the hold. It is a blocking precondition of an
  interactive request; a queue hop on every chat turn would turn a broker hiccup into a total outage.
- **`orazaka.jobs`** (existing contract, unchanged): `job.{id}.done|error` drives settle/release.
- **`orazaka.events`** via outbox: `evt.usage.recorded` (Lago sync), `evt.subscription.*` (fan-out to
  identity for the rate-limit tier, to billing for the wallet grant, to conversation for entitlement
  cache eviction), `evt.credit.exhausted` / `evt.wallet.low-balance` (UI nudges without polling).

Entitlements are cached in Redis (TTL 60s, evicted on `evt.subscription.*`) so the check is
in-process after the first call.

### 4. Entitlement and credit are separate concerns

Entitlement gates **access** (`capability.video=true` — a `free` user cannot generate video at any
balance); credits gate **volume**. Both are key/value rows, so a new plan or a new entitlement key is
an admin action. Rate limiting stays in `orazaka-identity`, driven by a subscription event — billing
does not absorb it, and no cross-context FK is created (SEAM-001).

> **Amendement (2026-08-10) — « package » renommé en « pack ».** Le concept est inchangé : une
> offre d'achat unique, ciblée métier, qui accorde des droits et des crédits. Seul le mot change,
> pour une raison de lisibilité du code : dans un monorepo Java, `package` est l'identifiant le plus
> surchargé qui soit — il ouvre les 1 068 fichiers de production. `pack` ne heurte rien, porte le
> sens de *lot* et de *crédits inclus*, et se lit tel quel dans l'UI française. Ont été écartés
> pour collision : `agent` (déjà `Capability.AGENT`), `module` (les modules Maven), `plan`
> (l'abonnement). Colonnes : `package_key` → `pack_key`, `billing_package` → `billing_pack`,
> `billing_package_entitlement` → `billing_pack_entitlement`. Fait avant tout déploiement, donc sans
> migration.

The same entitlement grammar expresses **packs métier**, which is why they need no new machinery
later: effective entitlements = plan ∪ pack, most-permissive-wins for booleans, max for limits.

### 5. Pricing is versioned data, never code

`credit_pricebook` rows are closed and superseded, never updated in place; a hold pins the version it
was priced with so a mid-flight change cannot corrupt settlement. `1 credit = 1,000 tokens on the
default local chat model`, frozen here — model cost changes move the pricebook, never the credit
definition. ArchUnit bans plan-key and price literals in Java: a hardcoded plan name means a deploy
is required to add a plan, which is exactly the failure the product brief asks to avoid.

Phase 0 ships **shadow metering** — workers report `gpuSeconds`/`frames`/`steps`, `usage_event` rows
are written, nothing is enforced or debited — so the first real pricebook is measured rather than
guessed.

### 6. Enforcement is a three-state DB switch, not a yaml boolean

Applying ADR-031's tiers to the monetisation plane splits one apparent switch into two, in two homes:

- **`orazaka.billing.enabled`** (yaml + `.env`, typed `@ConfigurationProperties`, default `false`) —
  a **bootstrap** decision: are the billing beans wired at all? It cannot be DB-driven because it is
  read before the service knows whether it has a billing database. Selection is by
  `@ConditionalOnProperty`, with a `NoOpCreditAuthorizationClient` Null Object as the fallback bean so
  that no producer ever carries an `if (billingEnabled)` branch (ERR-127).
- **`billing.enforcement.mode ∈ {OFF, DRY_RUN, ENFORCING}`** (DB, `billing_runtime_config`) — a
  **post-startup behaviour** an admin flips live, exactly the tier-3 definition, and exactly the
  precedent already set by `rate-limit.enabled`. If it lived in yaml, "stop refusing users" would be a
  redeploy — unacceptable for the one subsystem that takes money from people.

`DRY_RUN` is a state, not a nicety: it is what makes phase 0's shadow metering possible and what lets
enforcement reach production gradually instead of as a step change.

The mode is read by the **billing service alone**; the hold protocol returns the *outcome*
(`GRANTED` / `GRANTED+dryRun` / `INSUFFICIENT`), never the policy. Consumers stay dumb, so the
enforcement state cannot diverge between the conversation, job and automation services.

### 7. Everything commercial is admin-editable data; only wiring is yaml

Plans, entitlements, packs, pricebook rates, and the behavioural switches are **rows**, edited
from `orazaka-web-admin` through resource controllers under `hasRole('ADMIN')`, every mutation
snapshotted into `billing_version_history` (attributable, diffable, rollback-able). Changing what
Orazaka sells is never a deploy. Only service ports, timeouts, the Lago URL/key and the master wiring
switch stay in `application.yml` + `.env`.

Manual `ADJUSTMENT` is the only write that creates credits without a hold, so it carries stricter
guardrails, not looser: mandatory reason, the admin's `created_by`, explicit bucket choice, and a
per-admin daily ceiling above which a second admin is required.

**Invariant**: a billing switch is either read before the DB exists (yaml) *or* flipped live by an
admin (DB) — never declared in both (AGENTS.md §4, "each value declared once").

### 8. Lago is an opt-in Compose profile with its own database and volume

Lago runs under `profiles: [billing]`, so the default `orazaka start` path — which passes explicit
service names — never selects it and needs no CLI change. It gets its **own** Postgres container and
volume rather than a database inside `orazaka-db-vector`, for two reasons: Lago manages its schema
with Rails migrations, which does not belong in `infra/initdb/` (one file per Orazaka bounded
context, scanned by `SqlBoundaryRules`); and `orazaka stop --purge` must never be able to delete
financial records alongside disposable dev data. Host ports are remapped (API 3000 → 8098, front
80 → 8097) because Lago's defaults collide with `orazaka-web-client` and the conversation-service.

## Options considered

| Option | Why not |
|:---|:---|
| **Stripe Billing as the engine** (Meters GA, billing credits with an immutable ledger; Metronome now a Stripe product) | Fastest to ship and genuinely excellent, but it places the authorisation decision and the full usage history inside a proprietary SaaS — a direct contradiction of the Loi 25/GDPR sovereignty positioning that is the product's differentiator, and of §0's remote-dependency ban. **Retained as PSP only.** |
| **Kill Bill** (Apache 2.0) | The most complete open-source subscription/invoicing engine and Java-native, but heavier operationally and its usage-based metering is the weaker half. Its opinionated domain model would fight ours rather than sit behind a port. |
| **OpenMeter** (Apache 2.0) | Best-in-class AI token/GPU metering and entitlements — but **acquired by Kong in 2026** and folding into Konnect. Vendor absorption makes the open-source trajectory uncertain, which is an unacceptable strategic risk for a sovereignty-positioned product. |
| **100% in-house, no external engine** | Full control and zero dependency, but invoicing, prorata, dunning, tax and payment-retry logic carry legal exposure when wrong and are not a differentiator. Chosen *partially*: in-house for the ledger (where it matters), Lago for the rest. |
| **Post-paid metering only** (no hold) | Economically the fairest, but permits a zero-balance user to launch an hour of GPU work. Unacceptable when compute is the cost. |
| **Fixed pricebook only** (no settle) | Simple and predictable for the user, but margin is imprecise where real cost varies by an order of magnitude within one capability. Kept as the *hold estimate*; reality settles it. |
| **Authorisation over AMQP** | Would make one transport for everything, at the cost of a queue hop on every interactive turn and a broker outage becoming a product outage. Violates §6's sync/async rule. |
| **A single `billing.enabled` boolean in `application.yaml`** | The obvious answer, rejected twice over: it collapses `OFF`/`DRY_RUN`/`ENFORCING` into two states (losing shadow metering), and it makes disabling enforcement a redeploy — see decision 6. |
| **Plans/prices as a Java enum or yaml block** | Adding a plan would require a deploy, contradicting the product requirement that new subscription types be addable later. Banned by an ArchUnit rule, not just by convention. |
| **Lago sharing the `orazaka-db-vector` container/volume** | Fewer containers, but `orazaka stop --purge` could then delete financial records with dev data, and Lago's Rails migrations would sit inside `infra/initdb/` (an Orazaka-bounded-context-only directory). |

## Consequences

- **A new bounded context and deployable** (`orazaka-billing-service` :8095, `orazaka_billing_db`,
  role `orazaka_billing`) following ADR-032's extraction doctrine. Three producers — conversation,
  job, automation — debit one wallet through one owner, avoiding a distributed race.
- **A new SPOF on the hot path**, mitigated by `billing.fail-mode` per capability in
  `billing_runtime_config` (`FAIL_OPEN` for chat, `FAIL_CLOSED` for media) plus the entitlement
  cache. The fail mode is a runtime key precisely because it is the lever pulled during an incident.
  (It is the billing service's **own** config table, per decision 7 and the contract-copy consequence
  below — never the config plane's `orazaka_runtime_config`, which would be a cross-database read.)
- **Every executor must report consumption metrics** in `job.{id}.done`. Additive field on an
  existing contract, guarded by the existing `AmqpContractIT` fixtures — no breaking change.
- **A typed `TokenUsage`** must replace the untyped usage entries in `InternalChatResponse.metadata`
  (ERR-127: no `Map<String,Object>` leaking into business logic).
- **Two sources of truth for usage** (local ledger, Lago) require a nightly reconciliation job that
  replays `balance_after` and diffs against Lago. Drift alerts; it never auto-heals — a drift is an
  incident.
- **AGPLv3**: running unmodified Lago as a separate process reached over REST does not make Orazaka a
  derivative work. **Never fork Lago** — extend on the Orazaka side; buy the commercial licence if
  that constraint becomes uncomfortable.
- **Phase 4 (PSP, real money) is explicitly gated** on the decision to leave the 100% local phase.
  Phases 0–3 deliver a complete, enforcing credit system with zero remote dependency; the external
  coupling columns (`external_plan_code`, `external_subscription_id`, `external_synced_at`) stay NULL
  until then.
- **Packages métier become an admin screen, not an architecture change** — provided workflow
  templates are tagged with a `pack_key` and the orchestration `CALL` fee is metered (at zero
  credits) from day one.
- **A fresh clone runs with billing off.** `BILLING_ENABLED=false` and `LAGO_ENABLED=false` are the
  defaults in `exemple.env.txt`; unit and integration tests pin the wiring switch off via
  `@DynamicPropertySource`. A billing system that must be running for the chat E2E to pass is a
  billing system that blocks every contributor, so enforcement is enabled only where it is the
  subject under test.
- **The billing service carries its own `billing_runtime_config`** rather than reading the config
  plane's `orazaka_runtime_config` — contract-copy doctrine, no cross-database read. The cost is a
  duplicated table shape; the benefit is that the service stays independently deployable.
- **The admin console gains a Settings surface** whose dangerous transitions (into `ENFORCING`, and
  every pricebook publication) are whitelisted, typed, confirmed and snapshotted, with one-click
  rollback. Without the rollback path, the "flip it live during an incident" argument that justifies
  putting the mode in the DB does not actually hold.
