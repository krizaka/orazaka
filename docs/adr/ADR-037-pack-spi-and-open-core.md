---
title: "ADR-037 — Pack SPI: routing as data, purity as a build rule, and the AMQP worker contract"
description: "Why capability routing became a database column instead of a substring chain, why there is deliberately no fallback routing key, why JobCommand moved into a Tier-1 module, what the anti-pollution rules cost, and why the worker SPI is the AMQP contract rather than a Java interface — with the two-repository open-core split that enables."
category: ADR
order: 37
---

# ADR-037 — Pack SPI: routing as data, purity as a build rule, and the AMQP worker contract

- **Status**: Accepted
- **Date**: 2026-08-28
- **Scope**: `products/orazaka` — `infra/initdb/30-jobs-config.sql` (`orazaka_capabilities`);
  the new Tier-1 `orazaka-libs/contracts/orazaka-jobs-api` (`CapabilityRoute`, `JobCommand`,
  `CapabilityRoutingClient`, `UnroutableCapabilityException`); `CapabilityRoutingAdapter` in
  `orazaka-persistence-app`; `CapabilityController` in `orazaka-job-service`;
  `HttpCapabilityRoutingAdapter`, `AmqpStepExecutionAdapter`, `BlueprintPublishService` and
  `RunSagaService` in `orazaka-studio-service`; `PackPurityRules` in `orazaka-test-support`;
  `orazaka-worker-media/app/consumer.py`.
- **Implements**: `docs/PACK_EXTENSIBILITY_ARCHITECTURE.md` §3.3 (S1), §4.2 (P1/P2) — phases A and B.
- **Absorbs**: production-readiness audit finding #17 (`JobCommand` duplicated across two services).
- **Defers**: S2/S3 (the executor SPI and worker registration) to phase C, S4 (the pack bundle) to
  phase D. This ADR states the worker-SPI decision now because it is what makes those phases
  cheap — and because deciding it late would mean building S2 as though it were the extension
  point, which it is not.

## Context

The architecture promises *"a new pack is a row, never a deploy"*. That held only while a pack
reused capabilities that already existed. Three seams made it false the moment one did not
(`PACK_EXTENSIBILITY_ARCHITECTURE.md` §2). This ADR closes the first and the anti-pollution rules
that stop it reopening.

The first seam was a routing heuristic in `AmqpStepExecutionAdapter`:

```java
if (key.contains("compose")) return COMPOSE_ROUTING_KEY;
if (key.contains("video"))   return VIDEO_ROUTING_KEY;
if (key.contains("image") || key.contains("media")) return MEDIA_ROUTING_KEY;
return TEXT_ROUTING_KEY;                       // ← everything else lands here
```

A new capability — `orazaka.doc.validate`, say — matches nothing and is **silently** published to
`job.text.process`. Not a compile error, not a test failure: a text worker fails a document
validation job, or a language model answers it fluently and wrongly. The failure surfaces to the
user as an answer.

Three properties of that code are worth separating, because only one of them is the defect:

1. It is a **substring match on a business identifier** — a routing table pretending to be a
   heuristic.
2. It is **in code**, so extending it needs a deploy.
3. It has a **default branch**, so being unrecognised produces a plausible-looking wrong answer
   rather than an error.

(3) is the defect. (1) and (2) are why nobody noticed it.

## Decision

### 1. Routing is a row, and there is no default

`orazaka_capabilities` gains `routing_key` (`NOT NULL`, `CHECK (routing_key LIKE 'job.%')`),
`worker_family` (`NOT NULL`) and `billable_unit` (nullable). A producer resolves a capability
through the Tier-1 port `CapabilityRoutingClient`, which returns `Optional<CapabilityRoute>` and
**never a default**. An unresolved capability raises `UnroutableCapabilityException`:

- **at publish**, in `BlueprintPublishService` — every `CAPABILITY` step must resolve to an
  *enabled* route, and the 400 names the step id and the capability, so an admin can act without
  reading logs;
- **at dispatch**, in `AmqpStepExecutionAdapter` — resolved *before* the message is built, so
  nothing reaches a queue; `RunSagaService` catches it and fails the run with the capability named,
  releasing the hold.

**Degradation is not permitted here.** `PackPricingClient` may fail open because an unknown price
renders "—" and the page is still correct. A step with no route has no correct rendering: every
available queue is the wrong one. `HttpCapabilityRoutingAdapter` therefore returns empty when the
job service is unreachable, and the caller refuses. The user gets an error instead of an answer
nobody can trust — which is the trade this whole phase is about.

Its cache draws one distinction the refusal does not: a 404 is an *answer* ("no enabled route") and
is held for the configured TTL; an unreachable job service is not an answer and is retried after
five seconds. Both refuse the dispatch. Caching the outage would let one dropped connection refuse
every step of every run for a whole minute — turning a blip into an outage, which is what the TTL
exists to avoid rather than to cause.

A disabled capability returns **empty**, not a route flagged disabled. Handing back the row and
trusting each caller to check `enabled()` would make "did anyone remember to look?" the property
that decides whether disabled work still gets dispatched.

### 2. `orazaka-jobs-api` is the Tier-1 home of the job wire contract

`JobCommand` existed **twice** — once in `orazaka-conversation-service`, once in
`orazaka-job-service` — and the copies had diverged: the producer's had grown `withReservation` and
`resolvedModel` for billing (ADR-033) while the consumer's had not. The executor was deserialising a
shape its own class no longer described. A contract with two definitions has none (audit #17).

It now lives in `orazaka-libs/contracts/orazaka-jobs-api` alongside the routing contract, as the
superset of the two copies. Phase C needs this module for `JobExecutor`; creating it once is
cheaper than creating it twice.

### 3. The studio service reads the route over HTTP, not from the table

`orazaka_capabilities` belongs to the job plane's database; the studio service owns
`orazaka_studio_db`. Reading the table directly is exactly the cross-context coupling SEAM-001/002
forbid. So the job service exposes `GET /internal/v1/capabilities/{featureKey}/route`
(`SERVICE` authority, ADR-035) and the studio service reads it through a TTL-cached adapter — the
shape and the reasons of `HttpEntitlementProvider`: dispatch is a hot path, the table changes at
admin speed, and no new caching library is warranted.

This is a **correction to the phase plan**, which assumed the studio service could inject the
persistence-side adapter. It cannot, and the workflow's file manifest has been corrected. What the
design required — one owner, resolution through a Tier-1 port, no second copy — is unchanged.

### 4. The engine does not know a pack by name — enforced, not asked for

`PackPurityRules` in `orazaka-test-support`, run by every `<Module>GovernanceTest`:

- **[PACK-002]** no pack, studio, or *pack-capability* key as a literal in engine code under
  `orazaka-libs/**`, `orazaka-apps/services/**`, `orazaka-apps/workers/**`;
- **[PACK-003]** no branch on one of those identifiers — inline **or through a constant declared in
  the same file**, which is the shape both known violations actually took.

The rules are **source-scanned and repository-wide** rather than ArchUnit and per-module, for two
reasons: the subject is a string, not a type relationship; and the worst offender was **Python**.
`orazaka-worker-media` is in no Maven reactor, so no bytecode rule could ever have seen it.

Two boundaries are drawn deliberately, and both are narrowings of the rule rather than exemptions
from it:

- **`orazaka.core.*` is not pack knowledge.** Chat, image, video and vision are the engine's own
  capabilities; a rule that flagged them would have been met with an allowlist rather than a fix.
  The pack namespaces are a *set* (`studio`, `doc`) so that a new pack extends it by one line.
- **A capability key never ends in a separator.** `"orazaka.studio.brand."` is the Context
  preference prefix the brand interceptor concatenates onto (ADR-034 §9.1), a sibling of
  `orazaka.pipeline.*` and `orazaka.user.*`. `"orazaka.studio.media.compose"` is a row in the
  registry. A rule that cannot tell them apart is one whose only available repair is an allowlist,
  and an allowlist is how a fitness function becomes decorative.

`infra/initdb/**` and `orazaka-packs/**` (which does not exist yet — allowed now so phase D needs no
rule change) are outside the scanned roots entirely: seeds and bundles are where a pack key belongs.

The Studio-specific "no studio key literal in Java" rule that used to live in
`StudioServiceGovernanceTest` is folded into [PACK-002] — same keys, same reason, wider scope. Two
rules that can disagree about one property are worse than one that cannot.

### 5. The media worker decides from the message, never from a name

`consumer.py` compared the message's `featureKey` against `COMPOSE_FEATURE_KEY =
"orazaka.studio.media.compose"`. A general-purpose media worker was thereby coupled to one pack: a
fourth media capability meant editing Python.

It now reads the **routing key the broker delivered under**, derived from the binding it declares
(`COMPOSE_BINDING = "job.compose.*"`, so `COMPOSE_PREFIX = "job.compose."` — one source, so the two
cannot disagree). That routing key is the dispatcher's decision, taken from the capability's row. A
new capability bound to `job.compose.*` works here with no change, and a capability this worker was
never bound to never arrives.

### 6. The worker SPI is the AMQP contract, not a Java interface

Stated here although it lands in phases C–G, because it decides how those phases are built.

`orazaka-worker-media` is **Python**. It participates fully in the job plane: it consumes
`job.video.*` and `job.compose.*` on `orazaka.jobs` and answers `job.{jobId}.done|error` on
`orazaka.events`. It implements no Java interface and links no Orazaka library. **A worker is
therefore anything that honours the message contract** — and that is already true, it simply was
not written down.

The consequence inverts the plan's emphasis: publishing `docs/WORKER_PROTOCOL.md` as a versioned
specification (envelope, correlation, progress events, consumption reporting, DLQ and idempotency)
is the extension mechanism, and the Java `JobExecutor` of phase C is a *convenience* for in-process
executors. **The broker is the plugin boundary** — which is also what keeps a badly-behaved
third-party worker from taking the platform down with it, something an in-process SPI cannot offer.

That in turn makes the open-core split a packaging decision rather than an architectural one:
**two repositories, one manifest format.** The engine and the Pack SPI stay Apache-2.0 in this
repository with at least one Tier-D and one Tier-W reference pack; commercial packs live in a
private `orazaka-packs-cloud`. The manifest's `distribution` field drives *catalogue visibility per
deployment*, never secrecy.

## Alternatives rejected

**A `Map<String, String>` in code, replacing the `switch`.** Fixes property (1) of the defect and
neither of the others: extending it is still a deploy, and it still needs a `getOrDefault`. Moving a
routing table from one Java construct to another is not making routing data.

**A YAML routing table.** Fails AGENTS.md §4 outright — a capability registry is domain data an
admin changes at runtime, and the registry already exists as `orazaka_capabilities`. A YAML copy
would be a *second* source of truth for a mapping that already has one, which is worse than the
`switch` because it looks like configuration and drifts silently.

**Keeping a fallback routing key "just in case".** The fallback *is* the bug. Every argument for it
is an argument for the silent misroute, restated as robustness. A capability with no route is a
deployment error, and a deployment error should be loud on the day it is made rather than on the day
a user is charged for a wrong answer.

**A `distribution:` flag in a single public repository.** A cloud-only pack sitting in a public
repository is readable by everyone, which defeats the purpose of having one. The flag stays in the
manifest for catalogue visibility; it is not a secrecy mechanism.

**Leaving publish-time validation to a build-time seed rule** (the previous decision, recorded in
`BlueprintPublishService`). Sound while every capability shipped in this repository's seeds — and
structurally unable to see the one set that matters, which is the capabilities a pack brings. The
seed rule stays; it is no longer the only gate.

## Consequences

- Adding a capability is a row with a `routing_key`. Nothing in Java or Python decides where it goes.
- A capability that resolves nowhere fails **loudly, twice**: at publish in front of the admin, and
  at dispatch with the run failed and the hold released.
- The studio service gains a runtime dependency on the job service for publishing and dispatching.
  That is a real cost: a job service outage now blocks Studio dispatch rather than misrouting it.
  The TTL cache bounds it for capabilities already seen, and the exchange was deliberate — the
  alternative to failing is dispatching wrongly.
- `JobCommand` has one definition. The two copies cannot drift again.
- A pack key literal, or a branch on one, **fails the build** — in Java and in Python alike.
- `worker_family` and `billable_unit` are populated but unread. They exist so that phases C and F
  add behaviour to a populated table rather than a migration.
- **Two substring chains on `featureKey` remain**, both outside this phase's manifest and both
  recorded rather than silently fixed: `JobQueuePublisherService.getDefaultRoutingKey` (the
  conversation service's own routing default — and notably *without* the `compose` branch, so the
  two copies had already diverged) and `JobMeteringService.capabilityOf` (feature key → billable
  capability). PACK-003 does not catch them because they branch on fragments (`"video"`, `"media"`)
  rather than on capability keys. They are phase C work: the same table now holds the answer both
  need.

## References

- `docs/PACK_EXTENSIBILITY_ARCHITECTURE.md` §2 (the seams, with evidence), §3.3 (S1), §4.2 (P1–P4), §6
- `docs/PACK_CATALOGUE_ARCHITECTURE.md` · [ADR-036](ADR-036-pack-catalogue-and-regulatory-class.md)
- [ADR-034](ADR-034-studio-marketplace.md) — the Studio run saga this routing serves
- [ADR-033](ADR-033-credit-metering-and-billing.md) — the hold a failed dispatch must release
- [ADR-035](ADR-035-service-to-service-authentication.md) — the `SERVICE` authority on `/internal/v1`
- `docs/PRODUCTION_READINESS_AUDIT.md` #17 — the duplicated `JobCommand`
