# ADR-034 — Studios: installable business workflows as data, not code

- **Status**: Accepted (design; phases 0–5 local per AGENTS.md §0)
- **Date**: 2026-08-05
- **Scope**: `products/orazaka` — new `orazaka-studio-service` :8096, new Tier-1 contract
  `orazaka-libs/contracts/orazaka-studio-api`, `infra/initdb/80-studio.sql`,
  `orazaka-business/usecases/studio/`, `orazaka-interceptors/enrichment/`,
  `orazaka-web-client` + `orazaka-web-admin`, `orazaka-cli`
- **Extends**: ADR-027 (DB-driven config), ADR-031 (config governance), ADR-032 (service
  decomposition), ADR-033 (credit metering — this ADR delivers the "curated workflow bundles per
  profession" its Context anticipates)
- **Design**: [`docs/STUDIO_ARCHITECTURE.md`](../STUDIO_ARCHITECTURE.md)

## Context

Orazaka sells AI capability, but a professional does not buy "video generation" — a real-estate agent
buys *"five photos become a Reel"*, a plumber buys *"my week's jobs become a week of posts"*. The
platform today exposes atomic capabilities (`orazaka_capabilities`: chat, image, video, speech,
vision) and the user must compose them by hand. That gap is the difference between a tool and a
product.

The commercial half of the answer already exists: `billing_pack` (ADR-033) is a priced bundle with
a `profession` column and an entitlement matrix, and ADR-033 §Context names "a path to selling curated
workflow bundles per profession" as a requirement. What is missing is the **executable** half — the
workflow itself, and the browse/install/configure/run lifecycle around it.

Three constraints shape the answer. **New professions must not require a deploy** — the business model
is breadth of métiers, and one Java class per Studio makes the roadmap linear in engineering cost.
**Execution must reuse the existing job plane** — Orazaka already has `orazaka.jobs`, `JobCommand`,
per-job SSE relay, DLQ, dedup and the hold/settle protocol; a second execution path would duplicate
all of it and diverge. And **AGENTS.md §0 forbids cloud dependencies**, so the media assembly runs on
the same native MLX/ffmpeg worker as everything else, under the same MLX memory budget (COMP-04).

## Decision

### 1. A Studio is data: a versioned declarative DAG over existing `feature_key`s

A `Blueprint` is JSON in `studio_blueprint.definition` — steps, a JSON Schema for the run form, an
install-time config schema, outputs. Each `CAPABILITY` step names a `feature_key` that already exists
in `orazaka_capabilities`. Publishing a new Studio is therefore an **admin action**, the same rule
ADR-027/ADR-031 impose on models, interceptors and pricing.

The templating grammar is **deliberately not Turing-complete**: `{{inputs.x}}`, `{{config.x}}`,
`{{steps.<out>.<field>}}`, `{{item}}`, a `${key:default}` fallback (reusing the grammar
`orazaka_capabilities.payload_template` already defines), and four comparison forms. A blueprint is
untrusted input even from an admin; a scripting engine there is a sandbox-escape surface that review
does not make safe. Capability that the grammar cannot express becomes a **new step kind**, which is
reviewable, not a new expression, which is not.

A `PUBLISHED` blueprint is immutable by construction — a `BEFORE UPDATE OR DELETE` trigger raises,
the same mechanism ADR-033 uses for `credit_ledger_entry` and for the same reason (a `REVOKE` does not
hold against the table owner). Editing means minting a version.

### 2. A separate Tier-3 service, owning the interpreter, reached through a Tier-2 SDK

`orazaka-studio-service` (:8096, `orazaka_studio_db`, role `orazaka_studio`) owns the catalogue,
installations, runs **and the DAG interpreter**.

> **Amended during implementation.** This clause originally placed the interpreter in
> `orazaka-business/usecases/studio/`, hosted by the studio service. That is not buildable: SEAM-002
> lists `com.orazaka.business..` as a foreign Tier-3 implementation, and §15 of the design requires
> `StudioServiceGovernanceTest` to enforce SEAM-002 — so the service could not both host `business`
> and pass its own governance test. AGENTS.md wins.
>
> The interpreter therefore lives in the service, and the `Intention` path reaches it through the
> Tier-1 `StudioRunClient` port whose HTTP adapter is `orazaka-libs/orazaka-studio-client` — the
> exact arrangement `orazaka-billing-client` already uses for `CreditAuthorizationClient`.
> `StudioRunUseCase` still lives in `orazaka-business` and still resolves by `Capability.STUDIO`; it
> depends on the port, never on the service.
>
> The rejected alternative is worth naming: hosting `business` inside the studio service would have
> given that library a *second* owner, which is precisely the distributed monolith AGENTS.md §2 calls
> the primary health gauge. "Layer ≠ process" is still honoured — the interpreter is a library-shaped
> collaborator behind two ports (`BlueprintRepository`, `StepExecutionClient`) and can be re-hosted
> without moving code; it simply is not `business`'s library.

A separate service rather than a pack in `orazaka-conversation-service` for three independent
reasons: it owns durable state with its own lifecycle (Tier-3 = one owner, one schema); its write
pattern is hour-long sagas, which has no business sharing a connection pool with sub-second
interactive chat; and a marketplace is the natural seam for third-party publishers, which is strictly
cheaper to draw now than to retrofit.

### 3. Execution reuses the job plane verbatim; the exchanges are the API

The Studio service never calls the job service over HTTP. It publishes `JobCommand`s onto
`orazaka.jobs` and consumes `job.{jobId}.done|error` to advance the DAG — the ADR-032 mechanism. The
existing conversation-service SSE relay carries progress to the browser unchanged, so the UI gets live
per-step feedback with **no new transport**.

Exactly one new capability is required: `orazaka.studio.media.compose` (photos + clip + voiceover +
captions + brand overlay → 9:16 MP4), registered as a seed row and executed by the existing Python
`orazaka-worker-media`. It is a capability, not Studio code.

### 4. One credit hold per run, entitlement keyed `studio.<studioKey>`

A run acquires a single `hold` for the blueprint's estimate. Per-step holds are rejected: discovering
mid-run that step 5 is unaffordable is a worse product than a conservative estimate.

> **This clause once read "and closes it with `release` — on success as on failure".** That sentence
> was never edited, and it stopped being true anyway: phase C changed what it describes without
> changing a word of it. On **success** the run now *settles* the measured sum ([ADR-041](ADR-041-run-settlement.md)),
> so the release half is simply gone. On **failure** it is still a release, and that half is now an
> open question rather than a decision — see [ADR-046](ADR-046-asset-lists-and-failed-run-settlement.md),
> which measured a `realestate-reels` run that consumed three real inferences, failed on its last
> step, and was billed nothing.
>
> Recorded rather than quietly rewritten: a policy whose meaning drifts while its text holds still is
> the failure this repository keeps finding, and the only defence is to say so where the text is.

> **Amended twice (2026-08-31). This clause now describes what the code does.**
>
> It originally read "then `settleMeasured` against the sum of its steps' actual consumption" — a
> protocol nothing implemented. The first amendment corrected the prose to the behaviour of the day
> (`CreditReservationService.settle` was a `release`) and recorded why that behaviour was itself
> wrong: the single hold was passed to every step, so the first step to finish settled the whole run
> at the `AGENT`/`CALL` rate — 5 credits, `quantityFor(CALL)` being a constant `1` — and every later
> step found it closed. **480 reserved, 5 debited.**
>
> [ADR-041](ADR-041-run-settlement.md) implemented the original intent. Steps no longer carry the
> run's hold at all — `StepDispatch.holdId` is gone, so a step cannot settle the run by accident.
> Each step's measurements are stored on its `studio_run_step` row, and at the run's terminal
> transition the saga settles the hold **once**, through `settleAggregate`, against the sum of every
> step priced at **its own** capability's rate. Pricing stays inside billing, at the pricebook
> version the hold pinned.
>
> The text above is therefore accurate again, with one clarification it always needed: the hold is a
> guarantee of solvency taken once, **and at the end it becomes the debit**. Measured: the same
> `realestate-reels` run now reserves 480 and is debited 480 (`b-roll` 450 + `assemble` 30), against
> 5 before. Two of its four metered steps still contribute nothing because their executors report no
> priceable measurement — a distinct reporting gap, now visible as a warning per step, recorded in
> ADR-041's consequences.

Access is gated by `EntitlementSnapshot.allows("studio.<studioKey>")`, or a wildcard
`studio.tier.<tier>` for "all Studios included". Because ADR-033 already reads arbitrary entitlement
keys, **adding a Studio requires zero billing code** — one `billing_pack_entitlement` row. Locked
Studios are shown greyed in the catalogue with the upsell, never hidden: hiding them destroys the
funnel and every refusal writes a `credit_refusal` row, which makes the funnel measurable.

### 5. Upgrades are explicit

An `Installation` pins a blueprint version. A new publish sets `UPGRADE_AVAILABLE` and shows a banner;
it never migrates silently. A prompt change is a product change, and silently altering a professional
user's output is how the product loses them. Runs denormalise `blueprint_version` so they remain
reproducible after an upgrade.

### 6. Naming: `Studio`, because `Package` is taken

`billing_pack` already means "priced bundle for a profession". Reusing the word would create two
subtly different notions of "package" — precisely the drift `CatalogPack`'s own javadoc warns
against. `Studio` (item) / `Blueprint` (version) / `Installation` (an actor's copy) / `Run`
(execution) / `Package` (the price) is a partition with no overlap. Rejected: `Playbook` (collides
with `docs/BUSINESS_IMPLEMENTATION.md`), `Atelier` (French term in an English codebase), `Solution`
(no evocative power), `Module`/`Plugin` (implies deployed code, the opposite of the decision).

## Consequences

**Positive.** A new profession ships with zero Java and zero deploy. The two launch Studios
(`realestate-reels`, `outbound-prospection`) exercise five step kinds between them, so the third and
fortieth Studio are configuration. Billing, SSE, DLQ, dedup, rate limiting, RAG, connectors and the
sandbox are all reused rather than re-implemented. `Capability.STUDIO` makes a run a first-class
`Intention`, reachable from REST, CLI and the agent loop alike.

**Negative.** A DSL is a product surface: it needs a validator, a version story, documentation and an
authoring UI, and phase 5 is not optional polish. One more process and one more database to run
locally. Estimates will drift against measured consumption until the pricebook is calibrated from
real runs.

**The failure mode to guard.** A crashed worker leaves an outstanding hold and freezes a paying user's
balance. `RunSweeper` + release-on-failure + the "no non-terminal run older than 2× step timeout"
fitness function are therefore build-enforced, not a TODO — the same omission ADR-033 calls out for
`credit_hold`, and the one that never appears in a happy-path test.

**Reversibility.** Phase 1 (catalogue read-only) and phase 2 (install) are independently shippable and
independently revertible: rollback is deleting the edge route entry, after which requests fall back to
the `/` catch-all. Phase 3 is the risk concentration and is validated first with `trade-showcase`,
which requires no new capability, so any failure there is unambiguously an engine bug.

## Implementation notes (added after phases 0–5)

Three corrections the build forced, each recorded where it applies in
[`docs/STUDIO_ARCHITECTURE.md`](../STUDIO_ARCHITECTURE.md):

1. **The interpreter's home** — §2 above.
2. **The capability check at publish time** is impossible: `orazaka_capabilities` belongs to another
   context's database, and reading it is the coupling SEAM-001/002 forbid. §15's fitness-function
   framing was already correct, and that is where the check lives (`BlueprintSeedFitnessTest`).
3. **`orazaka.core.chat.completion` did not exist.** `ChatGenerationStrategy` (handler key
   `text.generate`) had always been in the job service with no capability row pointing at it, so the
   async text path was unreachable and the first blueprints had to abuse a vision capability to
   generate prose. Registering the row — one seed line, no new Java — is what makes the design's own
   `script` and `caption` steps expressible.

**What is not built.** `KNOWLEDGE` steps are parsed, validated and skipped: no knowledge capability is
registered, and a published blueprint may only name capabilities that exist and are enabled. The
`outbound-prospection` blueprint of §11.2 therefore ships without its KNOWLEDGE step. Making it real
is a one-row decision (register a knowledge capability against a retrieval handler) that belongs to
the knowledge context, not to this one.

## Alternatives considered

**One `UseCase` bean per Studio in `orazaka-business`.** Simplest, fully type-safe, no DSL. Rejected:
it makes every profession a deploy and an ArchUnit-governed code review, which is the business model
inverted. It also puts marketing copy and prompt tuning behind a Java release.

**A general workflow engine (Temporal, Camunda, Flowable).** Correct sagas, mature tooling. Rejected
under §0 — it is a new stateful runtime, a second source of truth for execution state, and an
operational surface an order of magnitude larger than the DAG this product needs, whose steps are
already durable jobs with their own retry and DLQ.

**Studios as a pack inside `orazaka-conversation-service`.** Cheapest to start. Rejected for the
three reasons in §2; notably the connection-pool and virtual-thread contention between hour-long
sagas and interactive streaming, which is invisible in development and severe under load.

**Reusing `orazaka_capabilities` rows to represent Studios.** Tempting — the UI already renders them.
Rejected: a capability is atomic, stateless and platform-owned; a Studio is composite, versioned,
per-actor-configured and sellable. Overloading the table would put installation config, versioning and
pricing into the conversation context's schema, violating the Tier-3 ownership rule.

**A Studio-specific exchange (`orazaka.studios`).** Cleaner isolation on paper. Rejected: it would
duplicate the SSE relay, the dedup table, the DLQ topology and the job dashboard for no behavioural
gain, and it contradicts ADR-032's "the exchanges are the API".
