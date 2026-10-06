---
title: "ADR-049 — The open-core cut, tested from outside"
description: "A pack in a directory outside this repository installs and runs with zero repository edits — after four platform defects the criterion exposed. And what PackPurityRules lets through, proven by planting a proprietary pack's vocabulary in the core."
category: ADR
order: 49
---

# ADR-049 — The open-core cut, tested from outside

- **Status**: Accepted
- **Date**: 2026-09-04
- **Scope**: `products/orazaka` — `LICENSE`, `NOTICE`, `docs/LICENSING.md`,
  `CONTRIBUTING-PACKS.md`, `orazaka-packs/echo-toolkit/**` (new Tier-W reference pack),
  `pack.sources.ts`, `pack.bundle.ts`, `pack.command.ts`
- **Implements**: [`docs/PACK_EXTENSIBILITY_ARCHITECTURE.md`](../PACK_EXTENSIBILITY_ARCHITECTURE.md) §4
- **Depends on**: [ADR-048](ADR-048-optional-on-the-wire.md), which is what the criterion found

## 1. The criterion, and what it cost

> A pack living in a directory **outside** this repository installs and runs, with **zero** edits
> to the repository.

**It now holds.** Reproduction, verbatim:

```bash
# 1. A pack that lives nowhere near Orazaka
mkdir -p ~/packs/acme-brief/studios/acme-summary ~/packs/acme-brief/i18n
#    …pack.yaml, blueprint.json, i18n/{en,fr}.yaml per CONTRIBUTING-PACKS.md

# 2. Install and run
orazaka pack validate ~/packs/acme-brief
orazaka pack install  ~/packs/acme-brief
curl -X POST localhost:8088/api/v1/billing/pack-subscriptions/me/acme-brief -H "Authorization: Bearer $TOKEN"
#    …install the Studio, submit a run
```

Measured on `/Users/oussamaabid/orazaka-external-packs/acme-brief`: run `SUCCEEDED`, one step,
201 tokens, **40 reserved / 3 settled**, and `git status` byte-identical before and after.

**It did not hold when it was first tried, and that is the finding.** The criterion failed four
times, each on a platform defect that no bundle inside `orazaka-packs/` could have exposed:

| # | What failed | Why it was invisible from inside |
|:--|:---|:---|
| 1 | `pack validate` — *"No pack.schema.json found above …"* | `locateSchema` walked up from the **bundle**. Inside the repo that finds the platform's schema by accident; outside it finds nothing — or worse, a schema the author shipped, letting a bundle validate against its own claim. The error message already said what the rule should be: *"validated against the schema of the platform installing it."* It now resolves from the CLI's own tree. |
| 2 | `400`, no message | Five schema-optional fields received into primitives — [ADR-048](ADR-048-optional-on-the-wire.md). |
| 3 | `500`, no message | `orazaka_capabilities.uri_path` was `NOT NULL` while every contract said "null when it has none". A Tier-W pack was the first to have none — ADR-048. |
| 4 | Studio installed but `REQUIRES_PLAN` | Not a defect in the cut: an external pack's Studios are unlocked by **holding the pack**, not by a plan. Plans are the platform's commercial offer and bundling a Studio into one is a deployment decision. *But* the entitlement cache (60 s) is not evicted by a pack subscription the way it is by a plan change, so a pack you just bought stays locked for up to a minute. **Open, not fixed here** — it is a billing eviction gap, and it costs a wait rather than a repository edit. |

Three of my own authoring mistakes are not in that table because they were mine, not the
platform's — `tier: D` instead of `DATA`, an inline blueprint instead of a path, an output without
a `label`. They are in `CONTRIBUTING-PACKS.md`, each marked **⚠**, in the order they happened.

## 2. `orazaka.packs.sources` — the one line

```bash
ORAZAKA_PACKS_SOURCES=orazaka-packs                              # OSS
ORAZAKA_PACKS_SOURCES=orazaka-packs,/srv/packs,registry:https://registry.orazaka.dev   # cloud
```

`orazaka pack list` enumerates the configured sources and what each offers. A `registry:` source is
**listed and marked unavailable** on a local deployment rather than silently skipped: a deployment
that believes it has a registry and quietly resolves nothing is worse than one that says the
control plane is absent (AGENTS.md §0).

An explicit directory argument still wins over configuration, because installing a bundle you are
holding must not require configuring anything.

## 3. Licences

`LICENSE` (Apache-2.0) and `NOTICE` at the root; the boundary in
[`docs/LICENSING.md`](../LICENSING.md). **Everything in this repository is Apache-2.0 without
exception** — engine, SPI, and the reference packs. What is proprietary lives in another
repository. **The boundary is the repository, not a flag**: a `distribution: CLOUD` pack sitting in
a public repository is readable by everyone, so that field drives catalogue visibility per
deployment and never secrecy.

## 4. Two reference packs, one of them Tier-W

`orazaka-packs/` ships four bundles; two are the reference pair §4.1 asks for:

- **Tier-D — `outbound-prospection`.** Three Studios over one existing capability, zero new
  capability, zero worker (ADR-043).
- **Tier-W — `echo-toolkit`, new.** Its own capability (`orazaka.echo.text.reverse`), its own
  worker (`orazaka-worker-echo`), its own queue. The work is reversing a string, deliberately: a
  reference for an extension point should be readable in a minute, and every line that is not
  about the extension point hides it.

**What the Tier-W pack proves, measured.** Installed with `orazaka pack install`; the worker
started and *declared its own topology* — `orazaka.jobs.echo`, bound `job.echo.*`, with its DLQ —
so nothing in the engine knows that queue exists. A run of `echo-reverse` on
`"la coupure open-core"` returned `"eroc-nepo erupuoc al"`, reserved 30 and settled **1**. The
worker links no Orazaka library and implements no Java interface: **the broker is the plugin
boundary** (ADR-037 §6), and this is the first executable proof of it outside the media worker that
predates the SPI.

Writing it found a fifth thing, and it was mine: the terminal event's key is `result`, not
`output`. Getting it wrong yields a `SUCCEEDED` run with an empty output and no error anywhere.
`docs/WORKER_PROTOCOL.md` had it right; the reference worker now carries the warning in a comment
where an author will meet it.

## 5. What `PackPurityRules` lets through — the question this phase existed to answer

**It lets through every pack it does not already name.** Proven, not reasoned: this was planted in
`StudioAnalyticsService` — engine code, a scanned root — with branching on all of it:

```java
private static final String EXTERNAL_PACK_KEY  = "hello-world";
private static final String EXTERNAL_STUDIO_KEY = "hello-brief";
private static final String CLOUD_CAPABILITY   = "orazaka.validation.pdf.ocr";
private static final String CLOUD_PACK         = "acme-compliance";
… "orazaka.wellbeing.mood.score" …
```

`StudioServiceGovernanceTest`: **15 tests, 0 failures.** [PACK-002] and [PACK-003] saw none of it.

The mechanism is exactly as documented and the limit follows from it:

- capability keys match `orazaka\.(doc|studio)\.…` — a **closed set of two namespaces**. A pack
  introducing `orazaka.validation.*`, `orazaka.wellbeing.*` or anything else is outside it.
- pack and studio keys match a **literal list of seven**, by exact quoted string
  (`line.contains("\"" + key + "\"")`). Note the consequence: `"wellbeing"` is on that list and
  `"orazaka.wellbeing.mood.score"` still does not match it, because the match is the whole quoted
  literal and not a substring.

**So the rule is a regression test for the two violations it was written against, not a guard
against new pack vocabulary.** For the packs in this repository it holds; for a proprietary pack
that introduces its own keys — the entire point of the open-core split — it is silent.

**Not widened here, deliberately.** Two repairs are available and they are not equivalent:

- *enumerate more* — add `validation`, `wellbeing`, `echo` to the namespace set and each new pack
  key to the list. This keeps the rule exact and makes it a list someone must remember to edit,
  which is how a fitness function becomes decorative;
- *invert it* — allow only `orazaka.core.*` and `orazaka.pipeline.*`-style engine namespaces in
  engine code and reject every other `orazaka.<ns>.<...>` literal. That catches an unknown pack by
  construction and needs no edit per pack, but it will fire on engine namespaces nobody has
  invented yet, and the honest cost is that each one must then be justified into the engine set.

The second is the right shape and it is a decision about how much friction the engine's own
vocabulary should carry, which is not mine to take unilaterally. Recorded here; not implemented.

## 6. Pack knowledge still in the core

Searched under the scanned roots, production code only. **The rule's own subjects aside, there is
one, and it is real.**

**`orazaka.studio.brand.` is hardcoded in an engine module.** `BrandContextInterceptor`
(`orazaka-libs/orazaka-interceptors`, Tier-2 — the platform SDK) declares
`BRAND_PREFIX = "orazaka.studio.brand."` and prepends a system message from every preference under
it. `AmqpStepExecutionAdapter` writes the same prefix from the studio side.

[PACK-002] deliberately does not flag it, and the narrowing is sound as far as it goes: a
capability key never ends in a separator, so this is a *preference namespace* and not a pack,
studio or capability key (ADR-037 §4). But the honest reading for phase G is narrower than the
rule's:

> **An external pack cannot have a brand context.** The engine enriches exactly one namespace, and
> it is the Studio product's. A third-party pack that wants its own per-installation context has to
> edit an engine library to get it — which is the coupling this phase exists to find, expressed as
> a namespace rather than as a key.

It is **not fixed here** and the shape of the fix is not obvious: the honest version is probably
that the *producer* declares which preference namespace to enrich from, the way [BILL-001] made the
metering marker declared rather than inferred. That is a change to the step-dispatch contract and
belongs with whoever owns the next pack that needs it.

Everything else that matched is accounted for and is not engine coupling:

- `PackPurityRules` names the four shipped pack keys and `orazaka.studio.media.compose` — it is the
  rule, and a rule must name its subjects;
- `orazaka-packs/echo-toolkit/worker/echo_worker.py` names `job.echo.*` — a pack's own worker,
  outside the scanned roots by design;
- `BlueprintFitnessTest`, `PackCatalogIT` and the media worker's `test_main.py` name shipped packs
  because they assert about them.

**No engine production file names a pack key or a studio key.** One names a pack *namespace*, and
that one is above.
