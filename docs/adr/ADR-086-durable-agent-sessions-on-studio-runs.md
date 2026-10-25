---
title: "ADR-086 — Durable agent sessions on Studio runs"
description: "A multi-agent session is a Studio run of kind AGENT. It gains an append-only checkpoint table, a PAUSED status, a lease, pause/resume/retry/fork endpoints, a bounded review loop, tool effect classes, a step memo that returns recorded outputs, a replayable event log and a CLI that resumes. No graph library, no second state store."
category: ADR
order: 86
---

# ADR-086 — Durable agent sessions on Studio runs

- **Status**: Accepted (decided 2026-10-21 by the coordinator; slices below, each test-first)
- **Date**: 2026-10-21
- **Builds on**: [ADR-083](ADR-083-client-connectivity-and-capacity.md) (run idempotency), ADR-034 (Studio marketplace: no external workflow runtime), ADR-054 (sealed assets), ADR-065 (retention by data class), ADR-067 (sweeper ceilings)
- **Scope**: `orazaka-studio`, `orazaka-cli`, `orazaka-ai-engine` (`orazaka-interceptors`, `orazaka-tools`), `orazaka-web-client`
- **Credit**: the design study is by **Oussama Abid (founder)**, 2026-10-21. This ADR keeps its four mechanisms and corrects where the code or the supply chain differs from what the study assumed.

## Context

A complex task (plan, call tools, generate code, validate) cannot be one request and one response. It must survive a
closed laptop, a crashed worker and a rejected draft, without paying twice for the steps already done. Oussama's study
names four mechanisms the industry uses: event-sourced checkpoints, idempotence with step memoization, a multi-agent
graph with a bounded review loop, and a standard client-server session protocol.

Two agents (an architect and a challenger) checked the study against the code. Most of it exists already:

- `studio_run` / `studio_run_step` (status, attempts, output JSONB, job id, consumption), per-run gapless `event_seq`
  and `studio_run_event` written by triggers, SSE honouring `Last-Event-ID`, run-level idempotency `(actor_id, key)`,
  `RETRY` with a DB-read attempt limit, `APPROVAL` and `cancel` (`80-studio.sql:268-400,609-660`, `StudioRunController`,
  `RunSagaService`).
- `ClosedLoopValidationInterceptor` (4 tiers, `maxRetries` 0..5), `SandboxAspect` / `SandboxLifecycle` (Jimfs per job,
  256 MB cap, 300 s eviction, `commit` / `rollback`), a DB-driven interceptor pipeline, MCP client, RabbitMQ with DLQs
  and an outbox.

What is missing is narrow: a checkpoint per step, `pause` / `resume` / `retry --from-step` / `fork`, a lease so that two
clients cannot resume one session, a loop whose back-edge carries the critic's error, a step memo, effect classes for
tools, a sandbox that survives a crash, an event log that is replayable (today the SSE sends full snapshots and
`studio_run_event.detail` holds only kind and status), and a CLI and a web view that use all of it. The names Axiom,
Forge, Lens, QwQ-32B and Qwen2.5-Coder-32B appear nowhere in code or catalogue; only `qwen2.5:7b` and `qwen2.5-coder:7b`
run.

## Decision

All of the following was decided by the coordinator on 2026-10-21, each with its reason.

1. **Decided: extend Studio's run model; no graph library now.** A session is a Studio run of kind `AGENT`
   (`studio_run.kind`, `parent_run_id` for forks). We reuse the `studio_run*` naming (not the study's
   `orazaka_agent_sessions`): one append-only table `studio_run_checkpoint` (immutable trigger, like
   `studio_run_audit_immutable`), a `PAUSED` status (AWAITING_INPUT stays for user input), endpoints `pause`, `resume`,
   `retry --from-step` and `fork`, and a **lease** (`lease_owner`, `lease_expires_at`, taken by one conditional
   `UPDATE`, heartbeat while running) plus an `event_seq` check, so a second resumer gets 409 and the current owner.
   Topology, roles, max retries and backoff are DB rows (`studio_runtime_config`, blueprint JSON, a role-to-model
   table), frozen into the run at start; never Java wiring, never `@Order`. *Reason*: ADR-034 refused a second
   source of truth for execution state; langgraph4j with its own saver tables would recreate it, outside our audit and
   actor scoping.
2. **Decided: the review loop is a bounded step kind.** Planner, then Executor, then Critic, with a back-edge that
   carries the critic's exact error and at most 3 attempts configured in the DB. It builds on
   `ClosedLoopValidationInterceptor` and the saga. *Reason*: a fixed bound keeps the blueprint grammar non-Turing-complete
   (ADR-034) and reuses an audited loop.
3. **Decided: step memo returns the recorded output.** The run key exists; we add a memo keyed on
   (session, step, input hash) that, on resume, returns the output recorded in the step row. LLM output is never
   re-hashed or re-generated. A failed step retries as attempt n+1 and never reuses a failed output; a critic rejection
   changes the input (the error), so the Executor is recomputed by construction. *Reason*: replay is not determinism.
4. **Decided: tool effect classes** `READ`, `SANDBOX_WRITE`, `EXTERNAL_EFFECT`, declared as data in the capability
   registry. An `EXTERNAL_EFFECT` writes an intent record (with the key sent to the target) before the call and a
   completion after it. If resume finds an intent without completion, the session parks in `APPROVAL` and never
   re-fires blindly. *Reason*: a commit, a payment or an e-mail must not run twice.
5. **Decided: Jimfs persistence by manifest.** A checkpoint holds a manifest (path, content hash, size); the blobs are
   content-addressed in the existing asset store (ADR-054, ADR-065), deduplicated across checkpoints, snapshotted on
   step boundaries only. `SandboxLifecycle` gains `snapshot` / `restore`, and the 300 s eviction does not apply to a
   live or paused session. A crash-and-resume integration test is mandatory. *Reason*: a 256 MB blob in a row hurts
   TOAST, WAL and backups on the small managed Postgres.
6. **Decided: the server never writes to a user's disk.** After the Critic validates, the CLI receives the diff and
   applies it locally after a confirmation (`--yes` skips it). *Reason*: the sandbox result is data; applying it is the
   user's act.
7. **Decided: billing per step.** Credits are held and charged per step. A resumed session never re-charges the recorded
   steps, and the session view shows the tokens saved, taken from recorded `consumption` only.
8. **Decided: resilience belongs to ai-engine#39.** Low-level retries, backoff and provider fallback (Resilience4j or
   equivalent, DB-declared) are owned by [orazaka-ai-engine#39](https://github.com/krizaka/orazaka-ai-engine/issues/39).
   We link to it and do not duplicate it; the saga only reads the same backoff keys.
9. **Decided: a replayable event log.** The SSE moves from full run snapshots to events with payloads, so
   `Last-Event-ID` replays the exact missed events. Checkpoint writes share the existing event numbering (one
   checkpoint, one event number).
10. **Decided: the CLI** (`@krizaka/orazaka-cli`). `orazaka run` creates the server session and keeps a local mirror
    `~/.orazaka/sessions/<id>.json` (a pointer and a cache; the server is the truth, resume sends only the id).
    Commands `sessions`, `inspect`, `resume`, `retry --from-step`, `cancel`. SSE reconnects by itself with
    `Last-Event-ID`. SIGINT pauses the session and prints how to resume. `~/.orazaka-cli.json` is never printed and is
    written with mode 600; so are the session mirrors.
11. **Decided: a session timeline view** in the signed-in web client: the three scenarios Oussama sketched (nominal,
    auto-retry, crash and resume), drawn from real run events, with a checkpoint panel and a journal, using
    `@krizaka/ui` components only. No mocked numbers: a figure appears only from a recorded run.
12. **Decided: later phases.** An ACP adapter (`orazaka acp`, stdio) over the same REST contract; a langgraph4j spike,
    gated on Jackson 3 / Boot 4 coexistence, only if branching beyond the review loop is needed.
13. **Decided: branding.** No Axiom, Forge or Lens names and no 32B claims until recorded runs back them. The loop is
    proven on the models we run (`qwen2.5:7b`, `qwen2.5-coder:7b`). Model tiers are DB rows, named when proven.

## Rejected options

- **spring-ai-alibaba**: Spring AI 1.1 and Boot 3.5 (we run Spring AI 2.0.1, Boot 4.0.8), and it pulls DashScope, Nacos
  and other starters.
- **Inngest**: SSPL with a delayed Apache licence (the study assumed Apache-2.0); TypeScript-first, no Java SDK.
- **Temporal**: licence fine, but a new stateful runtime and its operations on a budget under 100 $/month; refused
  already in ADR-034. Revisit only if Postgres is outgrown.
- **Restate**: BSL.
- **trigger.dev**: Apache-2.0 but a TypeScript platform to self-host; patterns only.
- **A2A**: for agents of different organisations; our roles are steps of one run family. MCP stays for tools.
- **langgraph4j now**: MIT, alive, aligned on Spring AI 2.0.1, but a single maintainer, its own Jackson 2
  serialisation and its own tables. Kept as a gated spike (phase 3).

## Phases

- **P1** the run: `kind`, `PAUSED`, `studio_run_checkpoint`, lease, `pause` / `resume` / `retry` / `fork`, step memo; CLI
  `sessions`, `inspect`, `resume`, `retry`, `cancel` with SSE reconnect and SIGINT pause. Test: kill the worker
  mid-run, resume, recorded steps are not re-billed.
- **P2** the review loop; effect classes; Jimfs persistence and atomic local apply; billing per step; the event-log
  SSE; the timeline view. One recorded run on `qwen2.5:7b` / `qwen2.5-coder:7b` with run ids.
- **P3** ACP adapter; langgraph4j spike.

## Consequences

- Positive: no new runtime or dependency in P1 and P2; billing, audit, approval and actor scoping are inherited.
- Cost: the saga gains a cycle (bounded) and a lease; the sandbox gains serialisation; the SSE contract changes
  (versioned, snapshots kept for existing clients until the web client moves).
- Security: checkpoints never hold secrets (connector credentials resolve from the vault at execution time, prompts
  are redacted before persistence, a test scans checkpoint JSON for token patterns); `state_json` is capped
  (larger goes to an asset by id); intermediate snapshots are dropped when a run completes (ADR-065).
