---
title: "ADR-043 — The prospection pack: three Studios, one capability, no new code"
description: "Phase E — why the KNOWLEDGE step is still not shipped and what exactly is missing for it, why no new capability was needed for two more Studios, the onError SKIP rationale rule, and the two defects that only became visible once billing could be switched on."
category: ADR
order: 43
---

# ADR-043 — The prospection pack: three Studios, one capability, no new code

- **Status**: Accepted
- **Date**: 2026-09-01
- **Scope**: `products/orazaka` — `orazaka-packs/outbound-prospection` (manifest, three blueprints,
  fr/en); plan entitlements in `infra/initdb/70-billing.sql`; the billing `service-secret` in four
  services' `application.yml`; the `skipRationale` rule in `BlueprintFitnessTest`;
  `skipRationale` on `realestate-studio`'s vision fan-out.
- **Tests**: [ADR-039](ADR-039-pack-bundle-and-installer.md)'s thesis — *authoring a pack is data*.

## Context

`outbound-prospection` shipped as one Studio where the design described a pack. Phase E completes
it, and it is the first real test of the thesis: **if two more Studios need a line of Java, the
thesis is false.**

## Decision

### 1. Two more Studios, zero new capability

`lead-research` (research → score → dossier) and `followup-sequences` (touchpoints → polish →
assemble → approve → notify) are blueprints over **`orazaka.core.chat.completion` and nothing
else**, plus `TRANSFORM`, `APPROVAL` and `CONNECTOR` steps, which the interpreter executes with no
capability at all. **No capability was added, and none was wanted.** The thesis holds.

### 2. The `KNOWLEDGE` step is still not shipped, and here is exactly what is missing

The step kind exists in the contract and the interpreter has a branch for it — **which skips**
(`RunSagaService`: *"KNOWLEDGE has no executor on this platform yet"*). Three things are missing,
and none of them is data:

1. a capability row (`routing_key` + `handler_key`) for retrieval;
2. a `JobExecutor` in the job service bound to that handler key, calling the knowledge service's
   `POST /internal/v1/knowledge/retrieve`;
3. the interpreter dispatching `KNOWLEDGE` instead of skipping it.

**But the pack does not need it, and that is the interesting part.** `RagInterceptor` is active in
the job service (`orazaka.core.rag.enabled: true`, top-k 3) and prepends retrieved context to
**every chat inference**. Grounding already happens on every `CAPABILITY` step in these three
Studios — implicitly, with no step, no capability and no executor. What `KNOWLEDGE` would add is
*addressable* retrieval, whose output a later step references by name (`{{steps.research.context}}`).
That is a different feature from grounding, and no blueprint here wants it.

So the divergence recorded at `STUDIO_ARCHITECTURE` §11.2 stands, with its reason sharpened: not
"the row does not exist yet" but "the implicit path already covers what this pack needs, and the
explicit one is code".

### 3. `onError: SKIP` must be argued in writing

Generalising ADR-042's lesson. A `skipRationale` on the step, enforced by `BlueprintFitnessTest`:
any shipped blueprint step with `onError: SKIP` and no rationale of at least a sentence fails the
build. `SKIP` is a product claim — *"the run is still worth something without this step"* — and it
is exactly how `trade-showcase` ran green for three phases while its vision fan-out had never
succeeded. The field is invisible to the runtime (`BlueprintMapper` reads named fields and ignores
the rest), so it costs the interpreter nothing.

Four steps across the shipped packs were flagged on the first run; all four now carry a rationale or
were changed to `FAIL`.

### 4. `outbound-prospection` 1.0.0 → 1.1.0

Its connector declared `connectorType: "CRM"`, which **no dispatcher handles** — it would have
thrown `Unknown connector type: CRM`. It never did, because it was also `condition:
{{config.autoPush:false}} == true` (off by default, so SKIPPED) and `onError: SKIP` (so a failure
would have been swallowed). Three layers, each hiding the next. It is now `SLACK`, which the
dispatcher executes, unconditional, and `onError: FAIL`.

## Consequences

**Measured — three runs from a purged database, every step SUCCEEDED, none SKIPPED, none PENDING:**

| run | steps | tokens | debited |
|:---|:---|---:|---:|
| `lead-research` | research#0, research#1, score, dossier | 315 + 247 + 397 | **3** |
| `outbound-prospection` | angle#0, angle#1, sequence, approve, push | 246 + 247 | **2** |
| `followup-sequences` | touchpoints#0, touchpoints#1, polish, assemble, approve, notify | 537 + 415 + 921 | **3** |

The `CONNECTOR` was **called**, not merely dispatched: `ConnectorDispatcher.executeSlackAction` ran
with the sequence body, and the step reached SUCCEEDED only via the `COMPLETED` telemetry the
automation service publishes *after* `dispatch()` returns.

**Two defects surfaced, both invisible until now:**

- **`BILLING_ENABLED=true` crashed every service at startup.** `orazaka.billing.service-secret` was
  absent from all four consumers, so each died with *"the shared identity secret is required to call
  /internal/v1"*. Billing had therefore **never been switched on anywhere** — which is why every
  measurement before this ADR was computed from the pricebook rather than read from the ledger.
  Fixed: one line per service, on the pattern `core.knowledge.service-secret` already used beside it.
- **Each chat step is billed twice.** With billing on, the wallet moved by **16 credits for 8
  inferences**: eleven holds, not three. `EntitlementInterceptor` takes a `CHAT` hold per inference
  and `ChatSettlementListener` settles it (1 credit each = 8), *and* the run's `AGENT` hold settles
  the same steps in aggregate (3 + 2 + 3 = 8). ADR-041 designed the aggregate path on the premise
  that steps carry no hold; the interceptor's own hold is a third metering path it did not account
  for. **Not fixed here**: changing what a run charges is a billing change and deserves its own
  commit with its own before/after, which is ADR-041's own precedent.

**Plan entitlements are data too.** INCLUDED pricing means "granted by the plan the actor already
pays for", so the two new Studios are two rows per plan in `70-billing.sql` — a pack does not decide
which plans include it. Adding a Studio to a plan really is one row.
