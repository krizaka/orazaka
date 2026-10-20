---
title: "ADR-084 — Automation triggers: signed inbound webhooks, schedules, and the run they start"
description: "How a cloud automation is started from outside (a signed webhook, Standard Webhooks) or by the clock (a schedule row), where the trigger secret lives (sealed under the master keyring, shown once, rotatable), the one narrow permitAll this needs at the edge (ADR-035 amendment), and how a run is recorded."
category: ADR
order: 84
---

# ADR-084 — Automation triggers

- **Status**: Accepted (decisions taken by the orchestrator, 2026-10-20; implementation slices below)
- **Date**: 2026-10-20
- **Builds on**: [ADR-079](ADR-079-automations-and-local-agents.md) (automation = trigger + recipe + policy; a run is a job),
  [ADR-035](ADR-035-service-to-service-authentication.md) (amended below), [ADR-054](ADR-054-asset-encryption-at-rest.md)
  (the master keyring), [ADR-083](ADR-083-client-connectivity-and-capacity.md) (Standard Webhooks, `Retry-After`, the
  connection budget), [ADR-034](ADR-034-studio-marketplace.md) (a run of a Studio)
- **Issues**: orazaka#195, #196 (and #197–#200, which stay open: they are the Mac, the agents and the sandbox)
- **Scope**: `orazaka-automation-service`, `orazaka-edge`, `orazaka-web-client` (`/automation`)

## Context

`orazaka-automation-service` is today an AMQP listener that logs connector actions: no HTTP surface, no security
configuration, no route at the edge, and it is not deployed on dev. ADR-079 gives it the job of owning automations, and
slice 3 asks for a `webhook` trigger: *a signed call from outside starts a cloud automation*. That is the first endpoint
of the platform that a stranger can reach **without a session or a key**, so it needs its own decision.

Two facts found while reading the code:

- The webhook endpoints of run events (orazaka#189, `studio_webhook_endpoint`) keep their signing secret **in clear** in
  a `VARCHAR(120)` column. There is no secret-sealing mechanism to reuse there. What the platform does have is the
  **master keyring** of the asset store (`MasterKeyProvider`: wrap and unwrap a data key under a keyring outside the
  repository, rotation = one line, a KMS can replace it). This ADR reuses *that*. Sealing the studio endpoints' secrets
  the same way is a follow-up, filed against orazaka-studio, not done here.
- A run of a Studio is started by `POST /api/v1/studios/{key}/runs` as an authenticated actor (the session JWT's subject).
  A webhook has no session. The platform already lets a service mint a token with the shared HS256 secret
  (`ServiceTokenProvider`, ADR-035); the automation service uses it with `sub` = the automation's owner.

## Decision

### 1. The trigger secret

- Each trigger has **its own** random secret: **32 bytes** from `SecureRandom`, presented as `whsec_` + standard base64
  (the Standard Webhooks form; the HMAC key is the decoded bytes).
- It is **sealed at rest** in `orazaka_automation_db`: AES-256-GCM with a fresh per-secret data key, itself wrapped by the
  master keyring (`MasterKeyProvider`, the `keyId` recorded with the row). The column holds `v1.<keyId>.<wrapped>.<nonce>.<ciphertext>`;
  the AAD is the trigger id, so a sealed value cannot be moved to another trigger. A key rotation of the keyring needs no
  rewrite: each row names the key that wrapped it.
- It is **shown once**, in the response that creates the trigger (or rotates it), never returned by a read, **never logged**
  (the logging fitness function `LOG-001` and a test that scans the log output of the whole flow).
- **Rotation**: `POST …/triggers/{id}/rotate` issues a new secret and keeps the previous one valid for a grace period
  (a settings row, default 24 h), so a sender can switch without losing a delivery. After the grace the previous sealed
  value is cleared.

### 2. Verifying an inbound call — the signature is the authentication

`POST /hooks/{triggerId}` carries the three Standard Webhooks headers: `webhook-id`, `webhook-timestamp` (seconds since
the epoch) and `webhook-signature` (`v1,<base64 HMAC-SHA256>`, a space-separated list is accepted). The signed content is
`{webhook-id}.{webhook-timestamp}.{raw body}`. Order of work, each step refusing before the next costs anything:

| # | Check | Refusal |
|:--|:---|:---|
| 1 | `Content-Length` over the **body cap** (row, default 64 KiB); the body is then read with a hard bound, never trusted to its header | `413` |
| 2 | the trigger's **pre-verification bucket** (row, default 600/min per trigger): protects CPU and the database from a flood of bad signatures | `429` + `Retry-After` |
| 3 | headers present and well formed, **timestamp within ±5 min** (row) | `401` |
| 4 | the trigger exists and is enabled, **HMAC verified in constant time** against the current secret and, during a grace, the previous one. An unknown or disabled trigger runs the same work against a dummy key and answers the same | `401`, one generic body for every cause |
| 5 | **replay**: `INSERT (trigger_id, webhook_id)` into `webhook_delivery` (primary key). A second use of the same id is refused *after* the signature checked, so an anonymous caller cannot probe ids | `409` `webhook_replayed`, with the first run's id |
| 6 | the trigger's **run bucket** (row, default 60/min) and the automation's daily run budget | `429` + `Retry-After` |
| 7 | the run row is written and the Studio run is started (below) | `202` with `{runId, deliveryId}` |

A `webhook-id` is remembered for twice the tolerance window plus a margin (row, default 24 h); older ids cannot be
replayed anyway because their timestamp is refused at step 3. All thresholds are **rows** of `automation_settings`
(a versioned rule set, bounded in code), never constants (ADR-027, organisation rule of 2026-10-15). The webhook body is
**data, not instructions**: v1 stores it (capped, as JSON) on the run for the history and forwards **nothing** of it to
the recipe — the Studio run gets the automation's fixed inputs. Mapping a payload field to an input is a later slice with
its own injection analysis (ADR-079 §5).

### 3. Runs

A run is a row (`automation_run`: automation, trigger, status, the Studio run id, the delivery, timestamps, a typed error
code). `RUNNING` means the Studio run was accepted; the service **listens to `evt.studio.run.{succeeded,failed}`**
(AGENTS.md §6) to close it, with a sweeper for a lost event. A run that cannot start (the owner has no entitlement, no
credit, the Studio is gone) is recorded `FAILED` with the engine's refusal, and the webhook still answers `202`: the call
was authentic and accepted, what the engine then did is the run's business and is in the history. Billing is the engine's:
the Studio run takes its hold like any run (ADR-033); nothing is metered twice.

### 4. Schedules (a trigger kind of the same table)

A `schedule` trigger is *daily at HH:mm in a time zone, on chosen weekdays* (ADR-079 §1). The truth is a row with
`next_fire_at`; one sweep every few seconds takes the due rows with `FOR UPDATE SKIP LOCKED`, creates the run, and computes
the next slot. **Not Quartz**: Quartz would add its own tables, a thread pool and connections to a database that gets a
transaction pool of 1 on dev (§6); a due-row sweep needs none of that and survives a restart by construction. Missed
slots follow `catch_up` (`once` | `skip`, default `once`). The Quartz entries of `application.yml` and its dependency
are removed.

### 5. The edge and the exception to ADR-035

The edge routes `/api/v1/automations` to the automation service (session JWT or `oz_` key, like every `/api/v1` route) and
`/hooks` to it **without any authentication of its own** — the edge already forwards a request that carries no
`Authorization`. In the service, `SecurityBaseline.apply` stays the base; the single addition is

```java
.requestMatchers(HttpMethod.POST, "/hooks/{triggerId}").permitAll()
```

**This is the only `permitAll` the platform allows besides the baseline's health/CORS/error paths** (see the amendment in
ADR-035). It is narrow on purpose: one verb, one path pattern with one segment, no `**`. A governance test of the service
fails on any other `permitAll`, on a wildcard in this one, and on `/internal` or `/uploads` anywhere near it. Every other
automation endpoint — the CRUD of automations and triggers, the run history, the secret rotation — stays behind
authentication and is scoped by the caller's id (an owner who is not the caller's gets a `404`, never a `403`).

### 6. Capacity on dev

The service becomes an eighth JVM of the `core` container (heap 128 MiB) and gets a PgBouncer pool `pool-automation` of
**1** connection (DB budget: 22 of 22 — see `docs/DEV_DATABASE.md`). A pool of one is safe only because **no transaction
holds its connection while it calls another service**: the Studio run is started *after* the run row is committed, and the
result is written in a second short transaction. A test pins that (a start that blocks must not hold the pool). The
limiter buckets are in memory, per instance, like the edge's; the shared store of ADR-083 slice 3 covers them when a
second instance exists.

## Alternatives considered

- **A signature in a query parameter or a shared static token.** Rejected: it is replayable, it ends up in access logs,
  and it cannot cover the body. Standard Webhooks is what the platform's own outbound webhooks (#189) already speak, so
  one sender library verifies both directions.
- **A per-automation secret** (ADR-079 / #196 wording: « HMAC secret per automation, stored hashed »). Rejected on two
  counts: a hash cannot verify an HMAC (the server needs the key), and one automation may have several triggers (a
  webhook per sender) that must be rotated or revoked independently.
- **Authenticating at the edge** (the edge verifies, the service trusts it). Rejected: the edge has no database and must
  stay a stateless proxy (ADR-083 §4.3); the service already holds the secret and the replay ledger.
- **Making the webhook idempotent instead of `409`.** Considered (it is how ADR-083 treats `Idempotency-Key`). Kept
  `409` as the answer to a reused `webhook-id` because the requirement is *replay protection*; the body carries the first
  run's id, so a sender that retried after a timeout learns the outcome without a second run.

## Consequences

- A stranger who finds `POST /hooks/{id}` learns nothing: every failure before step 5 is the same `401`, the work done is
  the same, and nothing is stored before the signature is good.
- A leaked secret is contained to one trigger and rotated without a gap. The master keyring becomes a dependency of the
  automation service (it already is one of conversation and job); the dev core already has it.
- The trigger and run history gain a UI in `/automation` of the web client (Krizaka UI, the steel-blue system).
- The studio endpoints' secrets stay in clear until a follow-up seals them with the same mechanism (filed).
- Slices 4 (the GitHub agent), 5 (the Flock), 6 (the headless runner) and 7 (IMAP, WASI) of ADR-079 are not touched.

## Slices

| # | Slice | Issue |
|:--|:---|:---|
| 1 | HTTP surface + security configuration of the automation service (CRUD of automations, ownership, `SecurityConfig`, governance test of the `permitAll`) | #195 |
| 2 | Edge route `/api/v1/automations`, `/hooks` | #195 |
| 3 | Trigger CRUD, sealed secrets, rotation, and the UI in `/automation` | #195, #196 |
| 4 | Signed inbound webhook → run, replay, rate limit, body cap | #196 |
| 5 | Schedule triggers | #196 |
| 6 | Run history (API + UI) | #195 |
