---
title: "ADR-042 — A Studio step resolves its assets at receipt, inside their owner's directory"
description: "Why no Studio step consuming an uploaded asset had ever run, why the resolution belongs in the job service rather than the studio dispatch, how ownership is enforced by the path, and why the fixture's onError SKIP is what hid it for three phases."
category: ADR
order: 42
---

# ADR-042 — A Studio step resolves its assets at receipt, inside their owner's directory

- **Status**: Accepted
- **Date**: 2026-09-01
- **Scope**: `products/orazaka` — `AssetFileResolver` and `JobListener.resolveAssets` in
  `orazaka-job-service`; `onError` on the `describe` fan-out of
  `orazaka-packs/trade-showcase`; `StudioLifecycleIT.runOverRealAssetsCompletesEveryStep`.
- **Extends**: [ADR-041](ADR-041-run-settlement.md), whose amendment recorded this as open.

## Context

**No Studio step consuming an uploaded asset had ever run.** Not once, in any pack, since Studios
existed.

`AmqpStepExecutionAdapter` copies a step's `resolvedInputs` into the job payload verbatim. A
blueprint step declares `assetId: {{item}}`; the executors read `filePath`. Nothing in between
converted one into the other, because nothing could: the studio context has no upload root.
`VisionAnalysisStrategy` therefore threw *"Payload does not contain filePath field"* on every
invocation, for every actor, always.

The conversation service never had the problem — `MediaAnalysisController` resolves the asset itself
and hands `JobSubmissionService` a `File`. Two paths to the same executors, one of which had a step
the other did not.

## Decision

### 1. Resolution lives in the job service, at receipt

The job service already holds the upload root (`spring.servlet.multipart.location`) and already
writes into `{uploadDir}/{userId}/{jobId}/` through `MediaFileStore`. Resolving there adds no
knowledge the module did not have.

The studio service has no upload root at all. Giving it one would put storage layout into a service
that owns a catalogue and a saga, and would couple two contexts by a shared filesystem mount they
otherwise do not share (SEAM-001). The alternative — the studio asking the conversation service over
HTTP — puts a synchronous hop on the dispatch path of every fan-out item.

Resolving at **receipt** also means every producer gets it. The conversation service resolves assets
in its own controller today; a pack's dispatcher would otherwise have to reimplement it, which is
the opposite of "a new capability is a row".

**The cost, stated:** a missing asset is now discovered when the job is consumed rather than when it
is dispatched, so the run fails a step instead of refusing at submit. That is a failure mode the
saga already handles, and with the fixture's `onError: FAIL` (below) it fails loudly.

### 2. Ownership is the path, and the containment check states the intention

Every lookup is rooted at `{uploadDir}/{userId}/` for the acting user of **this** job — taken from
`JobCommand.userId`, never from the payload. An asset belonging to another actor is not *denied*, it
is *not found*: the same answer as one that never existed, which leaks nothing about which it was.
An `assetId` inside a blueprint is user input, and this is the audit's finding #1 in another shape.

Two guards, because one is only true by accident. The prefix is matched against `listFiles` names,
which cannot contain a separator, so `../` in an asset id matches nothing rather than escaping — but
that is a property of the matching, not an intention. `withinOwnerRoot` canonicalises and asserts
containment, so a later change from `listFiles` to a path join cannot silently become a traversal.

An id that resolves to nothing is **left alone** rather than blanked: the executor's own missing-
`filePath` failure names the problem better than a silently emptied payload, and a capability that
never wanted a file is unaffected.

### 3. The fixture fails now, because a fixture that cannot go red proves nothing

`trade-showcase` is the acceptance fixture — the Studio whose job is to prove the engine works. Its
`describe` fan-out carried `onError: SKIP`, so a run in which **nothing analysed anything** finished
`SUCCEEDED`, artefacts and all. That is what hid this defect for three phases. It is now `FAIL`.

`realestate-reels` keeps `SKIP` on its own vision fan-out, deliberately: it is a product pack, and a
user who supplied five photos should still get their reel when one fails to analyse. The argument
that makes `SKIP` wrong for a fixture is what makes it right for a product.

### 4. The suite had the same shape of hole as the job suite before it

`StudioLifecycleIT.runIsAccepted` asserted a run was **accepted** and fanned out — both true of a
run whose every vision step then fails. Acceptance is not execution.
`runOverRealAssetsCompletesEveryStep` uploads real images, runs the fixture, waits for a terminal
state and names every step that is not `SUCCEEDED`.

**Proved in that order.** With the fixture flipped and the resolution disabled, the run is `FAILED`
— `describe#1` on *"Payload does not contain filePath field"*, `describe#0` `CANCELLED`. With the
resolution restored, the same run reaches `SUCCEEDED` with four steps out of four.

## Consequences

- **Measured — `trade-showcase`, two real uploaded photos, reserved 100:**

  | step | model | measured | credits |
  |:---|:---|---:|---:|
  | `describe#0` | `llava:latest` | 787 tokens | 1 |
  | `describe#1` | `llava:latest` | 744 tokens | 1 |
  | `caption#0` | CHAT default | 513 tokens | 1 |
  | `showcase#0` | image generation | `gpuSeconds` only | 0 |

  **Debited 3.** Vision produces non-zero credits for the first time, and the per-model pricebook row
  of ADR-041 is what prices it — `describe` bills against `(IMAGE, llava:latest)` in `KILOTOKEN`,
  while `showcase` still falls to `(IMAGE, NULL)` in `IMAGE_STEP` and measures nothing.

- **Two steps across the three shipped packs were affected**, both vision fan-outs:
  `trade-showcase/describe` and `realestate-studio/describe`. `outbound-prospection` declares no
  asset and was never blocked.

- **The seeded vision default did not load, and is changed.** `llama3.2-vision:latest` fails with
  *"unknown model architecture: 'mllama'"* against the pinned `llama-server`; `llava:latest`,
  `llava:v1.6` and `bakllava:latest` all load. Found only because closing the asset gap let a vision
  step reach its model for the first time — the previous failure masked it entirely.

  The seed now defaults to `llava:latest`. Changing it is a product decision and it was made
  deliberately rather than avoided: **a default that cannot load is a default that makes the whole
  capability look broken**, and every image analysis on a stock install died on it.
  `llama3.2-vision:latest` stays in the catalogue — it is the better model where the runtime
  supports it — so an operator can select it per request or promote it back. This is also what makes
  `StudioLifecycleIT.runOverRealAssetsCompletesEveryStep` meaningful rather than permanently red:
  the suite exercises the default, so the default has to work.

- **Image generation still measures nothing** (`ImageResponse` carries no dimensions or steps), and
  the blueprint estimate remains ~5× conservative. Both are ADR-041's open items, untouched here.
