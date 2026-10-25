---
title: "ADR-088 — Runs as background tasks: names, events & notifications, steering, resume, budgets & approvals, heavy-job lock"
description: "A Studio run becomes a long-lived background task you address by id or by a per-workspace name, follow by a numbered event log over SSE, signed webhooks and desktop notifications (exactly one « finished » per run, across retries), steer with a message applied only at the next step boundary, resume from a chosen step with a new instruction (reusing the exact result cache), stop cooperatively or hard, cap by cost and time, gate outward or costly steps behind an approval, bound heavy local jobs with a named lock, and show the folded timeline with the model the routing policy chose and why. No new runtime, no new state store: it extends studio_run, its event log and studio_runtime_config."
category: ADR
order: 88
---

# ADR-088 — Runs as background tasks

- **Status**: Accepted — « validé » by the CTO on 2026-10-23 (Phase 1: this ADR and its design). Review points folded in on 2026-10-25: event identity, cache key, caps vs threshold, resume target and lineage, the existing approval flow, the resource class, the job → saga protocol, the routing policy.
- **Date**: 2026-10-23
- **Builds on**: [ADR-059](ADR-059-run-saga-split.md) / [ADR-060](ADR-060-the-saga-write-boundary.md) (the run saga and its write boundary), [ADR-067](ADR-067-the-run-path-becomes-load-bearing.md) (the run path, the two lanes, sweeper ceilings), [ADR-068](ADR-068-one-door.md) (every job command has a run behind it; the outbox is the only producer), [ADR-083](ADR-083-client-connectivity-and-capacity.md) (run idempotency, the numbered event log, SSE with `Last-Event-ID`, signed webhooks), [ADR-086](ADR-086-durable-agent-sessions-on-studio-runs.md) (`studio_run_checkpoint`, `PAUSED`, lease, `resume` / `retry --from-step` / `fork`, step memo, result cache), [ADR-053](ADR-053-typed-failure-cause.md) (typed failure cause), [ADR-033](ADR-033-credit-metering-and-billing.md) (hold → settle), [ADR-027](ADR-027-db-driven-configuration.md) (limits are rows), [ADR-050](ADR-050-declared-not-inferred.md) (declared, not inferred), [ADR-079](ADR-079-automations-and-local-agents.md) (the device runner, grants, the approvals inbox, the kill switch)
- **Scope**: `orazaka-studio` (owner of the run, its steps, its event log, its webhooks, its settings), `orazaka-job-service` (the heavy-job lock on the two lanes), `orazaka-contracts` (the event and REST contracts), `orazaka-cli`, `orazaka-web-client` (web console, host `admin.*`), `orazaka-mobile-client`, the Mac app (`apps/desktop`), `krizaka-notifications` (desktop/push channel)
- **Credit**: the model is the way a coding-agent orchestrator drives its sub-agents, read against the run model we already have.

## Context

A run is already a background task in all but name. `studio_run` / `studio_run_step` hold its state and attempts; a
per-run gapless `event_seq` with a `studio_run_event` row per number, written by triggers, lets every instance and every
reconnecting client agree on what happened (`infra/migrations/2026-10-20-run-events.sql`); `GET
/api/v1/studios/runs/{runId}/events` streams it over SSE honouring `Last-Event-ID`, and `GET
/api/v1/studios/runs/events` fans one actor's in-flight runs onto one connection (`docs/STUDIO_GUIDE.md`). A run start
can carry an `Idempotency-Key`, backed by `ux_studio_run_idempotency (actor_id, idempotency_key)`
(`2026-10-18-studio-run-idempotency.sql`). Signed, retried, idempotent webhooks already tell a server-to-server client
that a run is over (`studio_webhook_endpoint` / `studio_webhook_delivery`, Standard Webhooks HMAC-SHA256,
`2026-10-20-studio-webhooks.sql`). ADR-086 added `studio_run_checkpoint`, a `PAUSED` status, a lease, `resume` /
`retry --from-step` / `fork`, and a step memo; `2026-10-23-studio-run-result-cache.sql` added the exact result cache
(`input_fingerprint`, `cached_from`) and `2026-10-23-studio-run-parent.sql` added `parent_run_id` and `resumed_from`.
Every runtime limit is a `studio_runtime_config` row carrying a default and bounds, an admin edit is audited
(`studio_runtime_config_audit`), and the workspace already has `run.max-concurrent-per-actor` (default 2, 1..100) and
`run.max-seconds` (default 14400, 60..86400) (`2026-10-23-studio-runtime-config-admin.sql`).

What a coding-agent orchestrator has and a run does not:

1. **A human name.** You address a run by its UUID only. A name you chose, unique in your workspace, is missing.
2. **A named vocabulary of lifecycle events.** The event log carries `run.created`, `run.updated` and a step kind only
   (`detail = {status}`), so a webhook or a notification cannot subscribe to « waiting for approval » or « step started »
   by name, and *one* « finished » notification per run — across the saga's retries and a webhook's at-least-once
   redelivery — is not guaranteed.
3. **Steering.** You cannot send a running run a message that changes its next step. The saga runs the frozen blueprint
   to the end; the only inputs mid-run are approve and cancel.
4. **Resume with a new instruction.** ADR-086 resumes a run from a step, but as a *retry* of the recorded plan. Appending
   a *new* instruction at the resume point — the orchestrator's « now also do this » — has no column and no endpoint.
5. **A cost cap and a permission mode.** `run.max-seconds` caps time; there is no per-run **credit** cap, and no
   workspace permission mode (ask / auto-within-caps / read-only). A Studio run already has *explicit* approvals: an
   `APPROVAL` step parks the run in `AWAITING_INPUT` (`RunSagaService.park`) and `StudioRunService.approve` resumes it.
   What is missing is the *automatic* gate: nothing parks a step because it is `outward` or above a cost threshold.
6. **A heavy-job lock.** ADR-067's two lanes (`orazaka.jobs.interactive`, `orazaka.jobs.batch`) each have a consumer pool
   and a ceiling, but nothing caps *concurrent heavy local jobs* (one GPU, large models) or tells a queued job *why* it
   waits.
7. **The model choice, shown.** The routing policy picks a model per step (ADR-030, ADR-057), but the step row does not
   record which model it chose or why, so the timeline cannot show it.

So the task is not a new engine. It is to name what the run already emits, add the few columns and endpoints the
orchestrator pattern needs, and gate the dangerous steps — reusing the lease, the event log, the result cache, the saga
write boundary and the settings table, and inventing no second source of truth for run state.

## Decision

Each point below gives the owning service, the API (REST + events), the tables/columns, the settings keys (default,
bounds, description), and the test that proves it. Everything is additive to `studio_run*` and `studio_runtime_config`;
the saga stays the only writer of run state (ADR-060) and the outbox the only producer of job commands (ADR-068).

### 1. Names and addressing — *owner: orazaka-studio*

A run keeps its UUID `id` and gains an optional `name`, unique per workspace (per `workspace_id`, which equals the
`actor_id`'s workspace; a run already carries `actor_id`). Every surface that takes a run id takes a name too; the
service resolves a name to an id once at the edge of the request and the rest of the code sees only the id.

- **Tables** — `ALTER TABLE studio_run ADD COLUMN name VARCHAR(80)`;
  `CREATE UNIQUE INDEX ux_studio_run_name ON studio_run (workspace_id, lower(name)) WHERE name IS NOT NULL`.
  The name is case-insensitively unique and may be reused after a run leaves (retention purges the row). A `workspace_id`
  column is derived from `actor_id` at insert (opaque, no FK — ADR §5). A name matches `^[a-z0-9][a-z0-9._-]{0,79}$`, is
  **never UUID-shaped** (a name the UUID parser accepts is refused, so `{ref}` is never ambiguous) and is never a reserved
  collection segment (`events`, `messages`, `resume`, `stop`, `approve`, `deny` — the list lives beside the routes and a
  test walks the controllers to keep it complete). Both rules hold at creation and at rename.
- **REST** — `POST /api/v1/studios/runs` accepts `{ "name": "nightly-digest", ... }`; `409 NAME_IN_USE` if taken in the
  workspace. `GET /api/v1/studios/runs/{ref}` and every `.../runs/{ref}/…` resolve `{ref}` as a UUID or, failing that, as
  a name scoped to the caller's workspace. `PATCH /api/v1/studios/runs/{ref}` sets or clears the name (`{ "name": null }`).
- **Events** — a name change is `run.renamed` (`detail = {name}`).
- **Settings** — none (a name is a property of a run, not a limit).
- **Test** — `RunNameIT`: two runs cannot share a name in a workspace; the same name in two workspaces is allowed; every
  run endpoint answers by name; an 81st character, an empty name, a UUID-shaped name and `events` are rejected by the
  compact constructor of the request record (ERR-106), at creation and at rename; reusing a purged run's name succeeds.

### 2. Lifecycle events & notifications — *owner: orazaka-studio (log, webhooks); krizaka-notifications (desktop/push)*

The run already numbers its changes; this names them. The `studio_run_event.kind` becomes a closed, documented
vocabulary — **the receiver never infers the meaning from the status** (ADR-050):

| Event kind | When | `detail` |
|---|---|---|
| `run.queued` | run inserted, not yet dispatched | `{name}` |
| `run.started` | first step dispatched | `{}` |
| `run.step.started` | the job service reports the job started (point 8), not the dispatch | `{stepIndex, stepKey, model, modelReason}` |
| `run.step.finished` | a step reaches `SUCCEEDED`/`FAILED` | `{stepIndex, status, cause, durationMs, tokensIn, tokensOut, credits, cacheHit}` |
| `run.waiting.approval` | a gated step parks the run in `AWAITING_INPUT` | `{stepIndex, reason, estimatedCredits}` |
| `run.steered` | a steering message is accepted | `{messageId, intent}` |
| `run.finished` | run reaches `SUCCEEDED` | `{credits, durationMs}` |
| `run.failed` | run reaches `FAILED` | `{cause}` (typed, ADR-053) |
| `run.stopped` | run reaches `HALTED` (cooperative or hard) | `{mode, stepIndex}` |

- **Tables** — the migration backfills nothing (old rows keep `run.created`/`run.updated`); the trigger of
  `2026-10-20-run-events.sql` is rewritten to emit the named kind from the `NEW`/`OLD` diff (status transition and step
  transition both known in the trigger). `studio_run` gains `finished_notified_at TIMESTAMPTZ` and a partial unique guard
  so the terminal notification is emitted once (see below).
- **Delivery.**
  - *SSE* — unchanged transport; each event now carries its named `kind`. Clients filter by name instead of re-deriving
    from a snapshot.
  - *Webhooks* — `studio_webhook_endpoint.events` already holds a CSV of event names (default
    `run.completed,run.failed`); this ADR aligns the default on the new vocabulary
    (`run.finished,run.failed,run.stopped,run.waiting.approval`) and keeps the old names as accepted aliases for one
    release. A delivery's identity is the **occurrence**, not the kind: a non-terminal event is one
    `(endpoint, run, event_seq)` row, so two gated steps of one run each get their `run.waiting.approval`; a terminal
    event keeps one row per `(endpoint, run, terminal)`. The identity is fixed when the row is written and reused by every
    retry of that delivery (the `webhook-id` header), so a receiver deduplicates on it.
  - *Desktop / push notifications* — the studio service emits `evt.notification.requested` on `orazaka.events` for the
    terminal and the approval events, consumed by `krizaka-notifications` (its `krizaka.notifications.requests` queue
    already exists, binding `evt.notification.requested`), which fans out to the registered channel (the Mac app, the
    phone). No new queue.
- **Exactly one « finished » per run, across retries.** The `finished` **notification** (webhook + push) is driven off a
  single DB fact: the terminal transition sets `finished_notified_at` in the *same* transaction as the status change,
  under the run's row lock, and the webhook/notification producers read only rows where `finished_notified_at` was just
  set. The saga's retries re-enter the same transition idempotently (the status is already terminal, the timestamp is
  already set, no second request is enqueued); the webhook ledger's terminal key `(endpoint, run, terminal)` makes a
  redelivery a no-op; the push side carries `(run, event_seq)` as its idempotency key so the notifications service
  deduplicates. Belt and suspenders because the two planes (webhook, push) fail independently.
- **Settings** — webhook limits already exist (`webhook.*`); add `notify.terminal.enabled` (default `true`, bool,
  "Emit a desktop/push notification when a run finishes, fails or stops.") and `notify.approval.enabled` (default `true`,
  bool, "Notify when a run waits for approval.").
- **Test** — `RunEventVocabularyIT`: a full run emits exactly the named sequence in order with no `run.updated`; a run
  that the saga retries twice produces exactly one `run.finished` event, one webhook delivery per endpoint and one
  `evt.notification.requested`; a run with two gated steps delivers two `run.waiting.approval` webhooks with distinct
  ids, and a retried delivery keeps its id; `RunEventContractTest` asserts the vocabulary matches `orazaka-contracts` so a webhook
  payload cannot drift from the enum.

### 3. Steering — *owner: orazaka-studio*

A message sent to a running run is **queued and applied at the next step boundary, never mid-step** — the saga reads the
queue only between steps, after a step's write has committed and before the next is dispatched.

- **Tables** — `CREATE TABLE studio_run_message ( id UUID PK, run_id UUID NOT NULL REFERENCES studio_run(id) ON DELETE
  CASCADE, seq BIGINT NOT NULL, intent VARCHAR(20) NOT NULL CHECK (intent IN ('ADD_CONTEXT','SET_NEXT_INSTRUCTION',
  'STOP_AFTER_STEP')), body TEXT, created_by VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), applied_at
  TIMESTAMPTZ, applied_at_step INT )`. `seq` orders messages per run; `applied_at`/`applied_at_step` record that the
  boundary consumed it. The message is **in the run's history**: accepting it raises `event_seq` and writes a
  `run.steered` event (point 2), so the timeline shows it between the two steps it sat between.
- **What a message can change** (the only three intents, each validated in the compact constructor):
  - `ADD_CONTEXT` — appends `body` to the context the next step receives, under `preference.` (caller data never shares a
    key space with trusted platform context — ADR-064). It cannot overwrite a platform declaration.
  - `SET_NEXT_INSTRUCTION` — replaces the next step's instruction text with `body`. It is caller data like
    `ADD_CONTEXT`: it crosses the same ADR-064 boundary (never a system message) and the step's output contract still
    applies. The step's *kind* and *effect class* (point 6) are not changed by a message; a message cannot turn a `READ`
    step into an `EXTERNAL_EFFECT` one.
  - `STOP_AFTER_STEP` — a cooperative stop request (point 5); `body` is ignored.
- **REST** — `POST /api/v1/studios/runs/{ref}/messages` `{ "intent": "...", "body": "..." }` → `202` with the queued
  message; `409 RUN_NOT_RUNNING` if the run is terminal (resume instead, point 4). A message is accepted while the run is
  `RUNNING` or `AWAITING_INPUT`.
- **Settings** — `run.steering.max-queued` (default `10`, 0..100, "Unapplied steering messages a run may hold; 0 disables
  steering."); `run.steering.max-body-bytes` (default `8192`, 0..65536, "Largest steering message body.").
- **Test** — `RunSteeringIT`: a message posted during step *k* is visible in history immediately but changes only step
  *k+1*'s input, proven by the recorded step input (the message never mutates a step already `RUNNING`);
  `SET_NEXT_INSTRUCTION` changes the next step and nothing after; the queue cap rejects the 11th with `429`; a message to
  a `SUCCEEDED` run is `409`.

### 4. Resume with a message — *owner: orazaka-studio*

A `SUCCEEDED`, `FAILED` or `HALTED` run resumes from a chosen step with a new instruction appended, reusing ADR-086's
exact cache / step memo for the steps it does not redo.

- **Tables** — reuse `studio_run.resumed_from` (`2026-10-23-studio-run-parent.sql`): the resumed run names its origin
  (no FK — retention may purge the origin), and `studio_run` gains `resume_depth INT NOT NULL DEFAULT 0`, set to the
  origin's depth + 1 at insert, so the chain cap never depends on ancestors that retention may have purged. The
  instruction is **appended**, not substituted: the stored `studio_run_message` (intent `SET_NEXT_INSTRUCTION`,
  `applied_at_step = fromStep`) holds the *effective* instruction — the origin step's instruction followed by the new text
  — written atomically with the new run so it is in history from seq 1.
- **Cache key** — a steered or resumed run must never reuse a result computed for other instructions: the run's
  `input_fingerprint` is the hash of the origin's fingerprint **and** every applied message (intent, body, step), so
  `JdbcRunResultCacheAdapter` cannot return the origin's whole-run result for a changed run, and a step at or after a
  changed instruction is keyed by its new input hash. Only steps strictly before the target reuse the origin's outputs. Steps before `fromStep` are not re-dispatched: the saga seeds the new run's steps from the origin's recorded
  outputs via the step memo keyed `(run, step, input-hash)` (ADR-086 §3) and the result cache
  (`input_fingerprint` / `cached_from`); a reused step is **not re-billed** (ADR-086 §7) and is marked `cacheHit` in its
  `run.step.finished` event (point 2 / point 7).
- **REST** — the existing `POST /api/v1/studios/runs/{ref}/resume` keeps its contract (`ResumeRequest(String fromStep)`,
  a stable **blueprint step id**, never a position) and gains optional fields:
  `{ "fromStep": "summarise", "instruction": "...", "name": "nightly-digest-2" }` → `201` with the new run (its
  `resumed_from` = `{ref}`). `fromStep` must be a step of the origin's frozen blueprint; it may be unstarted, failed or
  interrupted (a cooperative stop after step *k* resumes at *k+1*; a hard stop in the first step resumes at it). Reuse is
  limited to the steps that completed before it. `instruction` is optional (a bare resume re-runs from `fromStep` with the
  origin's plan). An `Idempotency-Key`
  makes a double-click one resume (existing `ux_studio_run_idempotency`).
- **Events** — the new run emits the normal vocabulary; reused steps emit `run.step.finished` with `cacheHit=true` and no
  model call.
- **Settings** — `run.resume.max-chain` (default `20`, 1..100, "How many times a run may be resumed from another before
  the chain is refused; guards runaway cost."). The chain is `resume_depth`, never a walk of `resumed_from`.
- **Test** — `RunResumeIT`: resume from the third step re-dispatches only it and the steps after; earlier steps carry
  `cacheHit=true` and add zero credits (asserted against `consumption`); the effective input of the target step contains
  both the origin's instruction and the appended text, from seq 1; a resume with a new instruction never returns the
  origin's cached whole-run result; resuming at an unstarted step after a cooperative stop works; resuming a `RUNNING`
  run is `409`; the chain cap holds after an ancestor has been purged.

### 5. Stop — *owner: orazaka-studio*

Two stops, one terminal status.

- **Cooperative** — a `STOP_AFTER_STEP` steering message (point 3) or `POST /api/v1/studios/runs/{ref}/stop`
  (`{ "mode": "cooperative" }`, the default): the saga finishes the current step, settles it, then moves the run to
  `HALTED` and emits `run.stopped` (`detail = {mode: "cooperative", stepIndex}`). The current step's output is kept; a
  later resume (point 4) starts after it.
- **Hard cancel** — `POST /api/v1/studios/runs/{ref}/stop` `{ "mode": "hard" }`, a last resort: the run moves to `HALTED`
  at once; the in-flight job is cancelled through the existing cancel path; its hold is released as an `EXECUTOR_FAULT`
  settlement (ADR-053 — a cancel is not a user-caused refusal). What is kept: every completed step's output and billing;
  the interrupted step is discarded (no partial output trusted) and not billed.
- **Events** — `run.stopped` (point 2). The terminal notification fires once (the `finished_notified_at` guard covers
  `HALTED` too).
- **Settings** — `run.stop.hard-grace-seconds` (default `30`, 0..300, "How long a hard stop waits for the worker to
  acknowledge the cancel before the run is marked HALTED regardless.").
- **Test** — `RunStopIT`: a cooperative stop keeps the current step's output and bills it; a hard stop discards the
  in-flight step and does not bill it, while earlier steps stay billed; both reach `HALTED` with exactly one
  `run.stopped` and one terminal notification.

### 6. Budgets and approval gates — *owner: orazaka-studio*

**Per-run caps.** A run carries a credit cap and a time cap. Admin sets the defaults (as `studio_runtime_config` rows);
the workspace overrides them within the admin's bounds.

- **Tables** — `studio_run` gains `credit_cap INT` and `time_cap_seconds INT` (both nullable; null = the resolved
  default). A `studio_workspace_policy` table holds a workspace's overrides and its permission mode:
  `CREATE TABLE studio_workspace_policy ( workspace_id VARCHAR(255) PRIMARY KEY, permission_mode VARCHAR(12) NOT NULL
  DEFAULT 'ASK' CHECK (permission_mode IN ('ASK','AUTO','READ_ONLY')), credit_cap INT, time_cap_seconds INT,
  approval_credit_threshold INT, updated_by VARCHAR(255) NOT NULL, updated_at TIMESTAMPTZ DEFAULT now() )`, audited the
  same way as `studio_runtime_config` (an append-only `..._audit`). A workspace cap is clamped to the admin bounds at
  write time (ERR-106 in the policy record); a per-run value is clamped to the workspace value.
- **One budget.** ADR-087's `research.max-calls` and its holds, and ADR-089's `law.derive.max-credits`, count inside the
  run's `credit_cap`: a research or derivation hold is a step hold like any other, never a second budget.
- **Enforcement.** The time cap extends the existing `run.max-seconds` sweep per run. The credit cap is checked by the
  saga *before each step's hold*, **independently of the approval threshold**: a step that would push the run's
  held+settled credits past the cap never runs on its own, in any mode — it parks the run in `AWAITING_INPUT` under
  `ASK`/`AUTO`, and only an approval that raises the run's cap (within the workspace bound) lets it proceed; under
  `READ_ONLY` it ends the run `HALTED` (`SKIPPED_BUDGET`). The threshold only adds gates below the cap.
- **Approval gate.** A step whose declared **effect class** is `EXTERNAL_EFFECT` (*outward* — sends, publishes, pays;
  ADR-086 §4 already defines `READ`/`SANDBOX_WRITE`/`EXTERNAL_EFFECT` as capability-registry data) **or** whose estimated
  cost exceeds the threshold waits for approval — **the step declares its class; the saga never sniffs the tool name**
  (ADR-050). The run parks in `AWAITING_INPUT` with `run.waiting.approval` (`detail = {stepIndex, reason,
  estimatedCredits}`). **It reuses the existing flow** rather than adding one: the automatic gate parks the run exactly as
  an `APPROVAL` step does (`RunSagaService.park`, status `AWAITING_INPUT`, the hold outstanding), with a `gate_reason`
  (`EXTERNAL_EFFECT`, `COST_THRESHOLD`, `CREDIT_CAP`) on the step, and `StudioRunService.approve` clears either kind.
  Approval comes from the CLI, the web console or the Mac app and is one decision on the run's current gated step.
  - **REST** — `POST /api/v1/studios/runs/{ref}/approve` `{ "stepIndex": n, "creditCap": m }` (`creditCap` only for a
    `CREDIT_CAP` gate, clamped to the workspace bound) → the saga resumes past the gate;
    `POST /api/v1/studios/runs/{ref}/deny` → the run ends `HALTED`. (The automation runner's approvals inbox of ADR-079
    is the device-side surface; this is the Studio-run surface. Same vocabulary, different owner.)
- **Permission modes per workspace** — `ASK`: every gated step waits. `AUTO`: gated steps proceed **within the caps**
  (above the cost threshold still waits; `EXTERNAL_EFFECT` still waits — auto applies to cost, not to outward effects,
  which always ask). `READ_ONLY`: a run that reaches any `SANDBOX_WRITE`/`EXTERNAL_EFFECT` step ends `HALTED`
  (`reason = READ_ONLY`) instead of waiting.
- **Settings** — `run.budget.default-credit-cap` (default `500`, 0..1000000, "Per-run credit cap a workspace inherits; 0
  = uncapped."); `run.budget.default-time-cap-seconds` (default `14400`, 60..86400, "Per-run wall-clock cap; mirrors
  run.max-seconds."); `run.approval.credit-threshold` (default `100`, 0..1000000, "A step whose estimated cost exceeds
  this waits for approval; 0 = every costed step waits."); `run.permission-mode.default` (default `ASK`, enum
  `ASK|AUTO|READ_ONLY`, "Default permission mode for a workspace with no override."); `run.approval.ttl-hours` (default
  `24`, 1..720, "How long a run waits in AWAITING_INPUT before it ends HALTED unanswered.").
- **Test** — `RunBudgetIT`: with 490 credits spent, a 500 cap and a 100 threshold, a 20-credit step parks under `ASK`
  **and** `AUTO` (the cap is independent of the threshold), ends `SKIPPED_BUDGET`→`HALTED` under `READ_ONLY`, and runs
  only after an approval that raises the cap; under the cap, `AUTO` runs a step below the threshold and parks one above it;
  `RunApprovalIT`: an `EXTERNAL_EFFECT` step waits under `ASK` and `AUTO` and halts the run under `READ_ONLY`; an
  `APPROVAL` step and an automatic gate are cleared by the same endpoint; approve resumes, deny halts; an unanswered gate
  ends `HALTED` after `run.approval.ttl-hours`; `WorkspacePolicyClampTest` proves a workspace cap above
  the admin bound is rejected.

### 7. The folded timeline contract — *owner: orazaka-contracts (shape), orazaka-studio (data)*

Per step the timeline shows: input and output (truncated with « show more »), duration, the model's reported thinking
time when it reports it, the tools called, tokens and cost, the cache hit, and the model the routing policy chose with
its reason.

- **Tables** — `studio_run_step` gains `model VARCHAR(120)`, `model_reason VARCHAR(200)` (the routing policy's reason,
  point 9), `thinking_ms BIGINT` (nullable — only when the model reports it), `tools_called JSONB` (array of tool keys
  and effect classes), `cache_hit BOOLEAN DEFAULT FALSE`. Tokens, cost and duration already live in `consumption` /
  timestamps; input and output already in the step row (truncated to a cap on read, full behind « show more » which reads
  the asset by id — ADR-065, never the raw payload inline past the cap).
- **Contract** — `orazaka-contracts` defines `RunStepView` carrying exactly these fields, and `RunTimelineView` the list;
  the web console and the Mac app render only from it, no re-derivation.
- **Settings** — `run.timeline.truncate-bytes` (default `2048`, 0..65536, "Bytes of a step's input/output shown before « show more »; the rest is fetched by id.").
- **Test** — `RunTimelineContractTest`: every field is present and typed; a step with no reported thinking time has a null
  `thinking_ms`, not `0`; a reused step (point 4) has `cache_hit=true`, no `model` call and `credits=0`;
  `RunTimelineTruncationIT`: output past the cap is truncated and « show more » returns the full asset.

### 8. The resource lock — *owner: orazaka-job-service*

At most **N heavy local jobs at once** (media, large models), configurable; a queued job says why it waits. ADR-067's two
lanes already separate interactive from batch; this bounds **concurrency** inside the heavy lane, not a third lane.

- **Mechanism** — a named lock keyed by **resource class** (not by lane): a capability declares its resource class in the
  registry (`gpu`, `large-model` or an explicit `none`) — **declared, not inferred from the model name** (ADR-050). There is
  no default: a capability with a missing or unknown class is refused when the registry is loaded (fail closed), and a
  governance test lists every capability row with its class. The job
  service holds at most N permits per resource class (a Postgres advisory-lock pool or a `job_resource_lease` row set,
  reusing the lease pattern of ADR-086), acquired before the worker starts and released on terminal/crash (lease
  expiry). The saga stays the only writer of run state (ADR-060), so the wait travels as events: the job service
  publishes `evt.job.waiting` (`{jobId, reason: "RESOURCE_BUSY:gpu"}`) when it cannot get a permit and `evt.job.started`
  when it does, on `orazaka.events`; the Studio consumes them and the saga writes the step's `waiting_reason` and its
  `started_at`. `run.step.started` (point 2) fires on `evt.job.started`, not on dispatch — today's insert of the step as
  `RUNNING` with `started_at` before consumption is split: the dispatch records the `jobId`, the start event stamps
  `started_at`. The UI shows *why* a step waits — not a bare spinner.
- **Tables** — `studio_run_step.waiting_reason` (nullable); the job service's `job_resource_lease ( resource_class
  VARCHAR(30), lease_id UUID, holder VARCHAR(255), acquired_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, PRIMARY KEY
  (resource_class, lease_id) )` in the job service's own DB (opaque ids, no cross-context FK — ADR §5).
- **Settings** — `jobs.resource.max-concurrent.gpu` (default `1`, 0..16, "Concurrent jobs holding a GPU permit; 0 blocks
  all GPU jobs."); `jobs.resource.max-concurrent.large-model` (default `2`, 0..64, "Concurrent large-model jobs.");
  `jobs.resource.lease-seconds` (default `1800`, 60..14400, "How long a resource permit is held before it is reclaimed on
  a crash."). These are job-service `studio_runtime_config`-style rows (the job service owns `30-jobs-config.sql`).
- **Test** — `ResourceLockIT`: with `gpu=1`, a second GPU job stays `QUEUED` with `waiting_reason=RESOURCE_BUSY:gpu`
  while the first runs, then starts when the first finishes; a crashed holder's permit is reclaimed after
  `lease-seconds`; an explicit `none`-class job is never throttled; a capability without a class is refused at load;
  `run.step.started` is emitted after `evt.job.started`, never at dispatch.

### 9. Model economy — *owner: orazaka-studio (record), orazaka-ai-engine routing policy (choice)*

The routing policy (ADR-030 universal proxy, ADR-057 one-capability-model) picks the **cheapest adequate** model per step
**inside the selected routing policy**: engine v2's policy (orazaka-ai-engine#53) defaults to `SOVEREIGN_LOCAL_ONLY` and
follows the administrator-declared primary/fallback candidates, so the ranking only orders the candidates that policy
allows — a cheaper hosted model never wins under a local-only policy. Among them it picks the lowest-priced model of the
DB registry (`2026-10-14-model-registry.sql`) whose quality tier meets the step's declared requirement, honouring the
workspace's model grants. The choice and its one-line reason are **recorded on the step** (point 7: `model`, `model_reason`, e.g.
`"cheapest tier-B chat model for capability=chat.completion under workspace grants"`), and the run shows it in the
timeline and the `run.step.started` event. No new table — the registry and the grants already exist; this ADR only
records the decision on the step so the run can show it.

- **Settings** — `run.routing.record-reason` (default `true`, bool, "Record the routing policy's model choice and reason
  on each step; off records only the model.").
- **Test** — `ModelEconomyIT`: given two enabled candidates of the same capability at different prices, a step records
  the cheaper one and a non-empty reason; disabling the cheaper makes the step record the dearer with a reason naming the
  constraint; under `SOVEREIGN_LOCAL_ONLY` a cheaper hosted model is never chosen.

## Settings summary (new rows; all `studio_runtime_config` unless marked job-service)

| Key | Default | Bounds | Owner |
|---|---|---|---|
| `notify.terminal.enabled` | `true` | bool | studio |
| `notify.approval.enabled` | `true` | bool | studio |
| `run.steering.max-queued` | `10` | 0..100 | studio |
| `run.steering.max-body-bytes` | `8192` | 0..65536 | studio |
| `run.resume.max-chain` | `20` | 1..100 | studio |
| `run.stop.hard-grace-seconds` | `30` | 0..300 | studio |
| `run.budget.default-credit-cap` | `500` | 0..1000000 | studio |
| `run.budget.default-time-cap-seconds` | `14400` | 60..86400 | studio |
| `run.approval.credit-threshold` | `100` | 0..1000000 | studio |
| `run.approval.ttl-hours` | `24` | 1..720 | studio |
| `run.permission-mode.default` | `ASK` | `ASK\|AUTO\|READ_ONLY` | studio |
| `run.timeline.truncate-bytes` | `2048` | 0..65536 | studio |
| `run.routing.record-reason` | `true` | bool | studio |
| `jobs.resource.max-concurrent.gpu` | `1` | 0..16 | job-service |
| `jobs.resource.max-concurrent.large-model` | `2` | 0..64 | job-service |
| `jobs.resource.lease-seconds` | `1800` | 60..14400 | job-service |

Existing rows reused unchanged: `run.max-concurrent-per-actor`, `run.max-seconds`, `run.step-timeout-seconds.*`,
`run.events.*`, `webhook.*`, `retention.run-days` / `retention.sensitive-run-days`.

## Rejected options and their costs

- **A new orchestration runtime (Temporal, Restate, langgraph4j) to carry steering, resume and the heavy-job lock.**
  Refused in ADR-034 and re-refused in ADR-086: a second stateful store outside our audit, actor scoping and the small
  managed Postgres, on a sub-100 $/month budget. Cost of refusing: steering and the lock are hand-built on the saga and
  the lease — more code here, but one source of truth.
- **A separate `background_task` table parallel to `studio_run`.** It would duplicate status, events, idempotency,
  retention and billing, and split « what is a run » in two. A run *is* the background task; naming it one does not need a
  second row. Cost: `studio_run` grows a handful of columns.
- **Infer « finished once » from the status alone.** The saga retries and the webhook ledger redelivers; the status is
  terminal many times. A `finished_notified_at` fact set under the row lock, plus the delivery ledger's unique key and a
  push idempotency key, is the only way to guarantee one notification across two independently-failing planes (ADR-050).
  Cost: one column and two dedup keys.
- **Infer the approval gate from the tool name** (« anything called `send*` is outward »). A new outward tool with a
  different name would ship un-gated and nobody would find out until it fired (ADR-050 — the party who knows declares it).
  The step declares its effect class as registry data; the saga fails closed on an undeclared effect (treated as
  `EXTERNAL_EFFECT`, so it waits). Cost: every capability must declare its class — a one-line registry row, caught by a
  governance test if missing.
- **A third RabbitMQ lane for heavy jobs.** ADR-067 chose two lanes deliberately; a third would not bound *concurrency*
  (a lane is a pool, not a semaphore) and would re-open the lane debate. A named lock inside the heavy lane bounds exactly
  N and names the wait. Cost: a lease table in the job service.
- **Steering mid-step.** Applying a message while a step runs would make a step's input non-deterministic and break the
  step memo and the result cache (a cached step must have a stable input hash — ADR-086 §3). The boundary is the only
  place a message is safe. Cost: a message waits up to one step; acceptable, and shown in history.
- **A per-run credit cap in `application.yaml`.** A business parameter (ADR-027); it must be a row with a default and
  bounds, admin-set and workspace-overridden, audited. Cost: a settings row and a policy table instead of a constant.

## The cut — issues in order

Phase-1 is this ADR only. Validated on 2026-10-23; the work splits per service, each slice test-first, each a PR in its
own repository (AGENTS §13.4), smallest dependency first — the order is contracts → studio A–E → job-service lock →
notifications → CLI (orazaka-cli#90) → web console (orazaka-web-client#270) → Mac and mobile (krizaka-tauri-kit#4):

1. **orazaka-contracts** — the named event vocabulary (point 2), `RunStepView` / `RunTimelineView` (point 7), the
   steering/resume/stop/approve request records. *Nothing runs without the shared shapes.*
2. **orazaka-studio** — slice A: run `name` + addressing (point 1) and the named event trigger (point 2). Slice B:
   steering (point 3) and cooperative/hard stop (point 5). Slice C: resume-with-message (point 4). Slice D: budgets,
   workspace policy and the approval gate (point 6). Slice E: the terminal-notification guard and
   `evt.notification.requested` (point 2) and the timeline fields + routing-reason recording (points 7, 9).
3. **orazaka-job-service** — the resource lock and `waiting_reason` (point 8).
4. **krizaka-notifications** — the desktop/push channel for the terminal and approval notifications (point 2); only the
   consumer mapping, the queue already exists.
5. **orazaka-cli** — `runs` (list by name/id), `inspect` (the folded timeline), `message`, `resume --from-step … --instruction …`, `stop [--hard]`, `approve`/`deny`, SSE follow with `Last-Event-ID`.
6. **orazaka-web-client** — the run console (host `admin.*` for the operator view): the timeline, the steering box, the
   approvals inbox, the budget/policy editor, the model-choice column; renders only from the contract.
7. **orazaka-mobile-client** / **apps/desktop (Mac)** — approvals and the terminal notification, so a gate can be cleared
   and a finish seen from anywhere.

## Consequences

- Positive: no new runtime, no new state store, no second approval flow; idempotency, the event log, SSE, webhooks, retention, billing, the lease,
  the step memo and the result cache are all inherited. A run becomes addressable, steerable, resumable, capped and gated
  with a dozen additive columns and one new table (`studio_run_message`, `studio_workspace_policy`, `job_resource_lease`).
- Cost: the event trigger grows a vocabulary; the saga reads a message queue at each boundary and checks caps before each
  hold; every capability must declare an effect class and a resource class (governance-tested, fails closed if absent);
  the step's start moves from dispatch to the job service's start event.
- Security: a steering message is caller data, merged only under `preference.`, never over a platform declaration
  (ADR-064); an outward step always asks, even in `AUTO`; the approval decision is an audited row; budget caps are
  clamped to admin bounds so a workspace cannot raise its own ceiling; the terminal notification cannot fire twice; the
  resource lease is reclaimed on crash so a dead holder cannot starve the GPU forever.
