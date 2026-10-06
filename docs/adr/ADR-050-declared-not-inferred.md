---
title: "ADR-050 — Declared, not inferred: the guard inverts, the namespace moves, the cache listens"
description: "PackPurityRules becomes a whitelist of engine namespaces because the two failure modes are asymmetric; the enrichment namespace becomes a producer's declaration; and buying a pack finally evicts the entitlement cache."
category: ADR
order: 50
---

# ADR-050 — Declared, not inferred

- **Status**: Accepted
- **Date**: 2026-09-04
- **Scope**: `products/orazaka` — `PackPurityRules`, `BrandContextInterceptor`, `JobCommand`,
  `AmqpStepExecutionAdapter`, `EntitlementCacheInvalidationConfiguration`, **AGENTS.md §12**
- **Closes**: the three findings [ADR-049](ADR-049-open-core-split.md) reported and did not repair

## 1. [PACK-002] inverts: a whitelist of engine namespaces

ADR-049 §5 measured that the rule let through everything it did not already name: two pack
namespaces and seven pack keys, hand-maintained. It is now the complement — **the engine declares
its own namespaces, and every other `orazaka.<ns>.…` is a pack's.**

**The argument is the asymmetry of the two failure modes.** A new *engine* namespace is added by
somebody editing the engine, in review, who can add one line to the set in the same change. A new
*pack* namespace arrives from outside the repository, from an author who has never read that file
and cannot be asked to remember it. **A guard must fail closed against the party who is not in the
room** — which is [BILL-001]'s reasoning applied to vocabulary instead of to metering.

**Proven, both directions.** The four literals of ADR-049 §5, replanted verbatim:

| literal | before | after |
|:---|:---|:---|
| `"hello-world"` | passed | **PACK-002 + PACK-003** |
| `"acme-compliance"` | passed | **PACK-002 + PACK-003** |
| `"orazaka.validation.pdf.ocr"` | passed | **PACK-002 + PACK-003** |
| `"orazaka.wellbeing.mood.score"` | passed | **PACK-002 + PACK-003** |

15 tests, 0 failures before; 15 tests, **2 failures** after, naming all four. And no legitimate
engine namespace goes red: the twelve in the set are the twelve observed in engine production
code, none added speculatively.

**A bare pack key has no namespace to judge**, so it is judged by what the code calls it:
`CLOUD_PACK = "acme-compliance"` states what the string is, and that statement is the violation.
The *identifier* must name a pack or studio, never the value — `CONSUMER = "studio-saga"` and
`"orazaka-studio-service"` are a consumer tag and a token subject, and a rule that flagged them
would be suppressed within a week. Measured: **0** false positives, against **58** for the variant
that also read the value.

**The rule fired on its own author, and that is the argument working.** Introducing
`orazaka.enrichment.namespace` in §2 below failed [PACK-002] until `enrichment` was added to the
set — one line, in the same change, in review. That is exactly the cost the asymmetry predicts for
the party who *is* in the room.

**Also found**: the scan walked into the vendored Python environment — **12 198 files where 888 are
ours**. Eleven thousand third-party modules whose only possible contribution was a false positive.
`/.venv/` and `/site-packages/` are excluded; the gate went from 14.2 s to 3.9 s.

## 2. The enrichment namespace becomes a declaration

`BrandContextInterceptor` — an engine module — held `BRAND_PREFIX = "orazaka.studio.brand."`. The
engine therefore enriched exactly one namespace and it was the Studio product's: **an external pack
could not have a context of its own without editing an engine library** (ADR-049 §6).

The producer now declares it. `JobCommand.ENRICHMENT_NAMESPACE_KEY` travels in the payload;
`AmqpStepExecutionAdapter` sets it to its own prefix; the interceptor enriches whatever it is told
and **nothing at all when nothing is declared**. A default would have been the engine assuming one
product's vocabulary — which is how it came to know it in the first place.

Criterion, pinned by test: a pack the engine has never heard of declares
`orazaka.acme.voice.` and its `register: formel` reaches the prompt, while an undeclared
`orazaka.studio.brand.tone` does not. A blueprint step can set the key among its inputs, so this
needs no engine change per pack.

## 3. Buying a pack evicts the entitlement cache — and the eviction had never worked

The reported symptom was sixty seconds of *"requires plan"* at the moment a customer has just paid
(ADR-049 §1), and the expected repair was one binding: `evt.pack.subscribed` already existed, the
per-host queue already existed, and only `evt.subscription.*` was bound to it.

**Adding the binding changed nothing, and that is how the real defect surfaced.**

```
$ rabbitmqctl list_queues name messages consumers
orazaka.events.entitlement-cache.orazaka-router           2   0
orazaka.events.entitlement-cache.orazaka-job-service      2   0
orazaka.events.entitlement-cache.orazaka-studio-service   2   0
orazaka.events.entitlement-cache.orazaka-automation-worker 0  0
```

**Zero consumers on every host, messages accumulating.** The listener was
`@ConditionalOnBean(HttpEntitlementProvider.class)` on a configuration `@Import`ed *by* the class
that defines that provider — so the condition asked whether a bean existed before the class
creating it had been processed, and answered no, every time, on every host. **Entitlement
invalidation had therefore never worked at all**: not for pack purchases, and not for the plan
changes it was written for. The sixty-second TTL was doing the whole job, and the queue bound to
`evt.subscription.*` was decoration.

The repair is the same principle as everything else here: guard on the **declared** switch
(`orazaka.billing.enabled`, the property that decides whether the provider exists) instead of on
the bean graph's registration order.

**And that fix exposed a third defect, which the broken condition had been hiding.** With the bean
finally being created, every host failed to start:

```
BeanDefinitionOverrideException: Invalid bean definition with name 'subscriptionChangeListener'
… there is already [com.orazaka.studioservice.infrastructure.adapter.amqp.SubscriptionChangeListener]
```

Two classes, one simple name, one of them in a library — the default bean name collided. A
condition that is always false hides everything behind it. The library's bean is now named for what
it evicts rather than for what it listens to.

**Measured after all three:** one consumer per queue, queues drained, and a Studio bought at t₀ is
unlocked at **t₀ + 0.49 s** — against a sixty-second TTL that was, until now, the only mechanism
there had ever been.

## 4. The principle is now in the contract

Three independent problems resolved the same way is not a coincidence, so **AGENTS.md §12** states
it as a rule with a test for the next case: *if this fact is wrong or absent, who finds out?* When
the answer is "nobody, and the behaviour is silently wrong", the fact is declared by the party who
knows it and the receiver fails closed without it.

With the corollary that decided §1 — where the failure modes are asymmetric, the guard protects
against the absent party — and the limit that keeps it honest: **declaring is not trusting.**
`EntitlementInterceptor` honours the metering marker and still runs the entitlement check;
`MeteringMarkerRules` fails the build for a producer that declares nothing. Declared, then verified.
