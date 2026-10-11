---
title: Packs & Studios
description: The packs that extend Orazaka without code — the reference catalogue, every manifest field, and how to write, validate and install a pack — read from orazaka-packs.
category: Business
order: 5
generated: true
---

# Packs & Studios

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.

A **Studio** is a business workflow — a versioned DAG of steps (model calls, transforms, human approvals,
connectors) with its own input form. A **pack** is a directory that ships Studios: a `pack.yaml` manifest,
its translations, the blueprints and, for a `WORKER` pack, its own worker. Installing a pack writes data —
capability rows, a price, catalogue entries — and changes no code.

> **Packs are not use-cases.** A pack is a business offer — Studios a customer installs and runs. A
> [use-case](USE_CASES.md) is a technical entry point of the engine (`chat.assistant`, `studio.run`…) declared
> in Java in `orazaka-business` ([business layer](BUSINESS.md)); every Studio run goes through the `studio.run` one.

## The packs

### Real-Estate Studio

**Your listings become Reels ready to publish.**

The real-estate agent's pack: the Real-Estate Reels Studio and the credits to run it.

Pack `realestate-studio` 1.0.0 · tier DATA · OSS · regulatory class STANDARD.

| Studio | What it does | Asks for | Steps | Credits held |
|:---|:---|:---|:---|:---|
| **Real-Estate Reels** (`realestate-reels`) | Five photos become a Reel ready to publish. Property photos, a three-line brief, and you leave with a 9:16 Reel, its caption and its hashtags. | `photos`, `clip`, `propertyBrief`, `platform` | 4 (CAPABILITY, APPROVAL) | 2800 |

### Media Studios

**Generate, listen, describe — without leaving a run.**

Pack `orazaka-media` 1.0.0 · tier DATA · kind TOOLKIT · OSS · regulatory class STANDARD.

| Studio | What it does | Asks for | Steps | Credits held |
|:---|:---|:---|:---|:---|
| **Image generation** (`image-generation`) | One sentence, one image. | `prompt`, `size`, `model` | 1 (CAPABILITY) | 200 |
| **Video generation** (`video-generation`) | A few seconds of footage, described then rendered. | `prompt`, `durationSeconds`, `image`, `model` | 1 (CAPABILITY) | 3600 |
| **Speech synthesis** (`speech-synthesis`) | Your text, read aloud. | `text`, `voice`, `model` | 1 (CAPABILITY) | 40 |
| **Image analysis** (`image-analysis`) | What an image shows, in words. | `assetId`, `prompt`, `model` | 1 (CAPABILITY) | 30 |
| **Audio transcription** (`audio-analysis`) | What was said, written down. | `assetId`, `model` | 1 (CAPABILITY) | 60 |
| **Video analysis** (`video-analysis`) | A video's speech, and its keyframes. | `assetId`, `model` | 1 (CAPABILITY) | 90 |

### Outbound Prospecting

**From a prospect list to a sequence that ships.**

The salesperson's pack: qualify a list, write each prospect's angle, and get the follow-ups out — three Studios over the same list.

Pack `outbound-prospection` 1.1.0 · tier DATA · OSS · regulatory class STANDARD.

| Studio | What it does | Asks for | Steps | Credits held |
|:---|:---|:---|:---|:---|
| **Outbound Prospecting** (`outbound-prospection`) | Your prospect list becomes a sequence ready to send. Describe your target and your offer: Orazaka writes a per-prospect angle, then a sequence ready to leave for your channel. | `prospects`, `offer`, `icp` | 4 (CAPABILITY, TRANSFORM, APPROVAL, CONNECTOR) | 250 |
| **Lead Research** (`lead-research`) | Your raw list becomes a prioritised dossier. One brief per prospect — sector, buying trigger, expected objection — then a ranking so you know who to call first. | `prospects`, `offer`, `icp` | 3 (CAPABILITY, TRANSFORM) | 380 |
| **Follow-up Sequences** (`followup-sequences`) | Your first contacts become follow-ups that go out. A multi-touch follow-up per prospect, unified into one voice, approved by you, then posted to your channel. | `prospects`, `offer`, `context` | 5 (CAPABILITY, TRANSFORM, APPROVAL, CONNECTOR) | 510 |

### Wellbeing

**Put into words what you live through, and bring it to your sessions.**

Guided journaling, session preparation and mood tracking. Not care: no diagnosis, no advice on treatment, no emergency service — what you bring to a professional, not instead of one. Health data, kept 30 days at most, never used to train a model.

Pack `bien-etre` 1.0.0 · tier DATA · CLOUD · regulatory class REGULATED.

Declares a scope guard (refused domain), versioned consent before install, a fixed, reviewed crisis response; the engine adds the controls of its regulatory class.

| Studio | What it does | Asks for | Steps | Credits held |
|:---|:---|:---|:---|:---|
| **Guided Journaling** (`guided-journaling`) | Your words, put in order — in your own voice. Write what you want to set down, as it comes: the Studio tidies it into a clean entry, in the first person, without adding advice or interpretation. | `entry` | 1 (CAPABILITY) | 40 |
| **Session Preparation** (`session-preparation`) | Your notes since the last session become the points to raise. Paste what you noted, in any order: the Studio turns it into the list of points to bring to your next session, without interpreting anything. | `notes` | 1 (CAPABILITY) | 40 |
| **Mood Tracking** (`mood-tracking`) | What your daily notes show, described — never concluded. One line a day is enough: the Studio describes what the entries show over time, and draws no conclusion from them. | `entries` | 1 (CAPABILITY) | 40 |

### Document Verification

**Check a contract against the rules, and a PDF for signs of tampering.**

Check a document against a versioned body of rules — every finding cites its rule, its source and the passage that justifies it — and examine a PDF file for the signals that something was altered. Reports, never legal advice.

Pack `document-validation` 1.0.0 · tier WORKER · CLOUD · regulatory class SENSITIVE · own worker `orazaka-worker-validation`.

Declares a scope guard (refused domain); the engine adds the controls of its regulatory class.

Rulesets: Bail de résidence principale — Région wallonne (BE-WAL, 4 rules, versions 2025-01-01); Bail d'habitation — France (FR, 10 rules, versions 2024-07-01, 2026-07-01).

| Studio | What it does | Asks for | Steps | Credits held |
|:---|:---|:---|:---|:---|
| **Document Authenticity** (`document-authenticity`) | A PDF's metadata, structure and fonts, examined for signs of tampering. Examines the file itself — who produced it, when, with what, and whether it was edited afterwards — and lists the points worth clearing up. It never judges what the document says. | `documentBase64`, `expectedIssuer` | 1 (CAPABILITY) | 30 |
| **Compliance Check** (`compliance-check`) | Your lease or contract, checked against the rules of its jurisdiction. Runs a lease or a contract against the rules of its jurisdiction, as they stood on a date you pick. Each finding gives its rule, its source and the passage of the document. | `document`, `jurisdiction`, `asOf` | 3 (CAPABILITY) | 120 |

### Trade Showcase

Pack `trade-showcase` 1.0.0 · tier DATA · OSS · regulatory class STANDARD · installed without a catalogue entry.

| Studio | What it does | Asks for | Steps | Credits held |
|:---|:---|:---|:---|:---|
| **Trade Showcase** (`trade-showcase`) | Your job sites become a showcase that sells. Drop in photos of your work: Orazaka describes them, then composes a branded showcase visual. | `photos`, `trade` | 3 (CAPABILITY) | 210 |

Kept off the shelf (`catalog.status: DRAFT`): `echo-toolkit` — installable for the platform's tests, never sold.

## The reference packs (`orazaka-packs`)

| Pack | Version | Tier | Distribution | Regulatory class | Catalogue entry | Studios | Own capabilities |
|:---|:---|:---|:---|:---|:---|:---|:---|
| `document-validation` | 1.0.0 | WORKER | CLOUD | SENSITIVE | yes | `document-authenticity`, `compliance-check` | `orazaka.validation.document.screen`, `orazaka.validation.document.signals`, `orazaka.validation.document.assemble` (worker `orazaka-worker-validation`) |
| `echo-toolkit` | 1.0.0 | WORKER | OSS | STANDARD | yes | `echo-reverse` | `orazaka.echo.text.reverse` (worker `orazaka-worker-echo`) |
| `orazaka-media` | 1.0.0 | DATA | OSS | STANDARD | yes | `image-generation`, `video-generation`, `speech-synthesis`, `image-analysis`, `audio-analysis`, `video-analysis` | — |
| `outbound-prospection` | 1.1.0 | DATA | OSS | STANDARD | yes | `outbound-prospection`, `lead-research`, `followup-sequences` | — |
| `realestate-studio` | 1.0.0 | DATA | OSS | STANDARD | yes | `realestate-reels` | — |
| `trade-showcase` | 1.0.0 | DATA | OSS | STANDARD | no | `trade-showcase` | — |
| `bien-etre` | 1.0.0 | DATA | CLOUD | REGULATED | yes | `guided-journaling`, `session-preparation`, `mood-tracking` | — |

## From the terminal

| Command | What it does |
|:---|:---|
| `orazaka pack validate <directory>` | Check a bundle's manifest, and whether this platform can run it |
| `orazaka pack install <directory>` | Install a bundle: capabilities, billing and catalogue, or none of them |
| `orazaka pack publish <directory>` | Put an installed bundle's pack and Studios on the shelf |
| `orazaka pack list [directory]` | List the bundles this deployment's pack sources offer |
| `orazaka studio list` | Browse the Studio catalogue |
| `orazaka studio installed` | List the Studios you have installed |
| `orazaka studio install <studioKey>` | Install a Studio into your workspace |
| `orazaka studio run <installationId>` | Run an installed Studio |
| `orazaka studio logs <runId>` | Show a run's per-step state and results |

## Manifest fields

From `pack.schema.json` — the schema `orazaka pack validate` checks against.

| Field | Required | Values | Meaning |
|:---|:---|:---|:---|
| `apiVersion` | yes | — | Manifest grammar version. |
| `key` | yes | — | The bundle's stable identity. |
| `version` | yes | — | — |
| `tier` | — | `DATA` · `CAPABILITY` · `WORKER` | What the pack needs from the platform. |
| `distribution` | — | `OSS` · `CLOUD` · `PARTNER` | Where the pack may be obtained. |
| `regulatoryClass` | — | `STANDARD` · `SENSITIVE` · `REGULATED` | Drives the seven controls of phase I. |
| `kind` | — | `VERTICAL` · `TOOLKIT` | How the pack reaches the user (ADR-061). |
| `requires` | — | — | What must already be true of the platform for this pack to run. |
| `catalog` | — | — | The shelf entry: a `pack` row, its category and its bundling of Studios. |
| `pricing` | — | — | What the pack costs and what buying it grants — the billing_pack half. |
| `studios` | yes | — | The Studios this bundle ships. |
| `scopeGuard` | — | — | The domain this pack REFUSES to answer in. |
| `consent` | — | — | The versioned consent a REGULATED pack requires before it may be installed. |
| `safety` | — | — | A REGULATED pack's crisis handling. |

## Writing a pack

A pack is a **directory**. It does not live in this repository, it is not compiled, and installing
one changes no code. If you can write YAML and JSON, you can ship a Studio.

This guide was written by installing a pack from outside the repository and writing down every
place it went wrong. Each **⚠** below is a mistake that actually happened, in the order it happened.

---

### 1. The shape

```
my-pack/
  pack.yaml                          # the manifest — the only required file
  i18n/
    en.yaml                          # one file per locale, discovered by convention
    fr.yaml
  studios/
    my-studio/
      blueprint.json                 # the workflow
  worker/                            # Tier-W only: your worker process
    worker.yaml
    …
```

Nothing here names a path inside Orazaka. Put the directory anywhere you like — `~/packs/my-pack`
is fine.

### 2. The manifest

```yaml
apiVersion: orazaka.dev/v1
key: my-pack                          # kebab-case, globally unique
version: 1.0.0                        # semver
tier: DATA                            # DATA | CAPABILITY | WORKER
distribution: OSS                     # OSS | CLOUD | PARTNER
regulatoryClass: STANDARD             # STANDARD | SENSITIVE | REGULATED

requires:
  capabilities: []                    # empty for DATA: you reuse orazaka.core.*

catalog:
  categoryKey: business
  iconKey: sparkles

pricing:
  priceCents: 0
  includedCredits: 0

studios:
  - key: my-studio
    profession: general
    iconKey: studio
    pricing: FREE                     # FREE | INCLUDED | PAID
    entitlementKey: studio.my-studio  # by convention studio.<key>
    blueprint: studios/my-studio/blueprint.json
```

> ⚠ **`tier` is `DATA`, not `D`.** The tiers are spelled out: `DATA`, `CAPABILITY`, `WORKER`.
>
> ⚠ **`regulatoryClass` has no `NONE`.** The floor is `STANDARD`.
>
> ⚠ **`blueprint` is a path, not an inline object.** The manifest names files; it does not embed
> them.
>
> ⚠ **There is no `i18n:` key.** The `i18n/` directory is found by convention. The manifest rejects
> unknown properties outright, so an invented key fails validation rather than being ignored.
>
> ⚠ **`pricing` is `priceCents` + `includedCredits`.** Not `bundledCredits`.

Everything else is optional and has a default. `orazaka pack validate` names the exact line when
something is wrong, so run it before you run anything else.

#### 2.1 Declaring `SENSITIVE`

Raise `regulatoryClass` above `STANDARD` and the engine applies four controls to every run of your
pack. You do not implement them and you cannot opt out of them; you declare one thing, and the
platform owes you the rest.

```yaml
regulatoryClass: SENSITIVE

scopeGuard:                           # REQUIRED once regulatoryClass is not STANDARD
  refusedTerms:                       # the domain your pack does NOT serve
    - conseil juridique
    - avocat
  refusal: >-                         # what a refused turn is told, verbatim
    Je rédige et relis des documents. Je ne donne pas de conseil juridique —
    pour cela, adressez-vous à un professionnel du droit.
```

What you get:

| Control | What the engine does | What you declare |
|:---|:---|:---|
| Data class | every run, input and artefact is stamped `SENSITIVE`; it is excluded from analytics and never used for training | nothing |
| Shortened retention | runs are purged after 30 days instead of the platform's 180 | nothing; an installation may set `retentionDays` in its config to go **lower**, never higher |
| Audit log | `RUN_STARTED` and a terminal row per run, append-only, `UPDATE` and `DELETE` refused by the database | nothing |
| Scope guard | a turn naming a refused term is stopped before any inference, and answered with your sentence | `scopeGuard` |

The publish gate is code, not a checklist: a pack that declares a regulatory class above `STANDARD`
without a `scopeGuard` **fails to install**, naming the missing key. A second condition is not yours
to satisfy: your pack is also refused by a **platform** that stores assets in the clear. That is the
platform operator's declaration, not yours, and the error names the key they must set. On a local
developer machine it is already satisfied. A pack that refuses nothing has
not stated a domain, and a legal-drafting Studio with no scope guard is one that answers legal
questions.

`refusedTerms` is matched on whole words, accent- and case-insensitively, against the turn as the
user wrote it. Name the *domain you decline*, not every phrasing of it — the list is a declaration,
not a filter, and the engine never adds terms of its own.

### 3. The blueprint

```json
{
  "version": "1.0.0",
  "status": "PUBLISHED",
  "estimatedCredits": 40,
  "createdBy": "you",
  "definition": {
    "studioKey": "my-studio",
    "version": "1.0.0",
    "steps": [
      { "id": "brief", "kind": "CAPABILITY",
        "featureKey": "orazaka.core.chat.completion",
        "dependsOn": [],
        "inputs": { "prompt": "Write about {{inputs.subject}}." },
        "out": "brief", "onError": "FAIL", "maxAttempts": 1, "timeout": "PT2M" }
    ],
    "outputs": [
      { "key": "brief", "label": "Your brief", "from": "{{steps.brief.content}}", "type": "TEXT" }
    ]
  },
  "inputSchema": { "type": "object", "required": ["subject"],
                   "properties": { "subject": { "type": "string", "title": "Subject" } } },
  "configSchema": { "type": "object", "properties": {} }
}
```

> ⚠ **An output needs `label` and `type`, not just `key` and `from`.** A missing label is a `400`
> on the first run, not at install.

**Step kinds**: `CAPABILITY` (runs a model), `TRANSFORM` (reshapes values), `APPROVAL` (parks for a
human), `CONNECTOR` (calls out), `KNOWLEDGE`. **`onError`**: `FAIL` | `SKIP` | `RETRY` — and a
`SKIP` needs a written `skipRationale`, which a fitness function checks.

**Templates.** `{{inputs.x}}`, `{{config.x}}`, `{{steps.<out>}}`, `{{item}}` inside a `forEach`. A
template that is *exactly one placeholder* over a list stays a list; anywhere else it renders as
text. That is what lets a step take a list of asset ids.

**`estimatedCredits` is a hold, not a price.** Size it for your blueprint's *worst legal input* —
the maximum `forEach` fan-out, every optional step firing. It is released, not charged: a run
settles what it measured.

### 4. Install it

```bash
orazaka pack validate ~/packs/my-pack     # shape, then the platform's own checks
orazaka pack install  ~/packs/my-pack
```

`validate` checks your manifest against **the platform's** schema — the one the CLI carries, not
one you ship — and then asks the running platform whether every `featureKey` you name resolves.

> ⚠ **A published version is immutable.** Re-installing `1.0.0` after editing the blueprint does
> nothing and reports success. Bump the version. Editing means minting a version (ADR-034 §4).

### 5. Make it runnable

Installing puts a Studio in the catalogue; it does not entitle anyone to it. Your pack's
`entitlementKey` is granted to whoever holds the pack:

```bash
curl -X POST localhost:8088/api/v1/billing/pack-subscriptions/me/my-pack \
     -H "Authorization: Bearer $TOKEN"
```

> ⚠ **The entitlement cache is 60 seconds.** A pack subscription does not evict it today, so a
> Studio you just bought can stay `REQUIRES_PLAN` for up to a minute. Wait, do not re-install.

Plans are the platform's commercial offer, so bundling your Studio into `free`/`premium` is a
deployment decision, not something a pack can do to itself.

### 6. Tier-W: bringing your own worker

Declare it in the manifest —

```yaml
requires:
  capabilities:
    - key: orazaka.echo.text.reverse   # your namespace, your key
      label: Reverse text
      routingKey: job.echo.reverse     # job.<family>.<action>
      handlerKey: echo.reverse
      billableCapability: CHAT
      billableUnit: KILOTOKEN
  workers:
    - name: orazaka-worker-echo
      bindings: ["job.echo.*"]
```

— and write a process that honours [`docs/WORKER_PROTOCOL.md`](../WORKER_PROTOCOL.md). **The
broker is the plugin boundary**: your worker links no Orazaka library and implements no interface.
It must

1. **declare its own topology** — exchange, queue, bindings, DLQ — so installing your pack needs no
   change to the platform's broker configuration;
2. **decide from the routing key**, never from a capability name;
3. answer `job.{jobId}.done` or `job.{jobId}.error` on `orazaka.events`;
4. report **measurements** (`tokens`, `frames`, `gpuSeconds`, …), never units or prices;
5. be **idempotent by `messageId`** — delivery is at-least-once.

> ⚠ **The success key is `result`, not `output`.** Getting it wrong gives you a `SUCCEEDED` run
> with an empty output and no error anywhere.

The worked example is [`orazaka-packs/echo-toolkit`](https://github.com/krizaka/orazaka-packs/tree/main/echo-toolkit) — a manifest, a
Studio and a ~120-line Python worker that reverses a string. It is deliberately trivial: everything
in it that is not about the extension point would hide the extension point.

#### 6.1 Three things that would otherwise cost you an hour

Found by shipping `document-validation` (ADR-052 §6), and none of them visible from reading the code.

**The broker credentials are the `RABBITMQ_*` family** — `RABBITMQ_HOST`, `RABBITMQ_PORT`,
`RABBITMQ_USER`, `RABBITMQ_PASS`. They used to have two names each depending on how your `.env`
was generated, and picking the wrong one got you `ACCESS_REFUSED (403)` with no diagnosis; ADR-053
§8 settled it. The old `SPRING_RABBITMQ_*` and `RABBITMQ_PASSWORD` names are still read for one
version, with a warning naming what to rename — so an older `.env` keeps working and tells you.

**Re-installing at the same blueprint version keeps the stored one.** A `PUBLISHED` blueprint
version is immutable by design — shipping a change means shipping a new version. `pack install`
still says *"Installed"*, and your edit is not what runs. Bump `version` in the blueprint (and in
`definition.version`) every time you change it. The installer logs what it kept, so check the
studio service's log if a change seems to have no effect.

**`{{steps.out}}` is for prompts, `{{steps.out.field}}` is for data.** A whole-step reference
interpolates the value's `toString` — fine inside a prompt, useless to a JSON parser. If your step
must hand structured data to a later step, emit it as an explicit JSON string field and reference
that field.

### 7. Where packs come from

One property decides, and it is the only difference between an open-source deployment and a hosted
one:

```bash
ORAZAKA_PACKS_SOURCES=orazaka-packs                       # OSS: this repo's reference packs
ORAZAKA_PACKS_SOURCES=orazaka-packs,~/packs               # plus your own
ORAZAKA_PACKS_SOURCES=~/packs,registry:https://…          # plus a hosted registry
```

`orazaka pack list` shows the configured sources and what they offer. A registry source is listed
and marked unavailable on a local deployment rather than silently ignored.

### 8. Licence

Your pack is yours. See [docs/LICENSING.md](../LICENSING.md).
