---
title: "ADR-079 — Automations and local agents: one run model, a device runner, MCP tools behind approvals"
description: "Scheduled and event-triggered runs of a Studio, a pack or a prompt, and agents that act on the user's own machine. A run is a job (metered, policy-checked, audited); schedules, budgets and grants are rows; the runner is a Rust core shared by the Mac app and a later headless daemon; tools are MCP servers limited to granted folders; every side effect waits for a human or a grant; no shell in v1."
category: ADR
order: 79
---

# ADR-079 — Automations and local agents

- **Status**: Accepted (slice 1 shipped in `apps/desktop`; slices 2–7 are the roadmap below)
- **Date**: 2026-10-16
- **Builds on**: ADR-027 (DB-driven configuration), ADR-033 (metering: hold → settle), ADR-035 (service tokens),
  ADR-064 (trust boundaries), the content policy (`docs/CONTENT_POLICY.md`), the Desktop app (`apps/desktop`, Delivery 12)
- **Scope**: `orazaka-automation-service`, `apps/desktop`, `orazaka-cli`, `orazaka-conversation-service` (agent stream),
  `orazaka-web-client` (`/automation`), `orazaka-packs`
- **Issues**: orazaka#108/#109 (code), orazaka-packs#24 (the Contributor, GitHub MCP), discussion #122 (the Flock),
  orazaka-cli#48 (daemon), orazaka-automation-service#7/#8, orazaka-ai-engine#19 (WASI sandbox)

## Context

Orazaka runs work when someone clicks. Users ask for the other half: *"every morning, read what arrived and prepare it"*,
on their own machine, with their own models — the sovereign promise applied to automation. What exists today:

| Piece | What it really does (2026-10-16) |
|---|---|
| `orazaka-automation-service` | A RabbitMQ listener. `ConnectorDispatcher` **logs** Jira/Slack/WhatsApp/Messenger actions (stubs) and forwards `CLI_AGENT` payloads to `cli.{userId}.dispatch`. Quartz is configured (JDBC store) but schedules nothing. Its DB holds `connector_credentials` and an execution log. |
| `orazaka-conversation-service` `AgentController` | An SSE tunnel (`GET /api/v1/agent/stream`) a CLI can hold open, and `POST /api/v1/agent/report`. In-memory registry, one emitter per user. |
| `orazaka-cli agent listen` | Receives `automation_payload` events and runs `payload.command` with `child_process.exec` — **any shell command, no approval, no scope**. |
| `McpController` + ai-engine `McpService` | Platform and per-user MCP server rows, tool listing and execution on the server. No permission model, no approval. |
| `apps/desktop` (Tauri 2) | A control panel, a least-privilege **folder scope** (`scope.rs`: canonical paths, no `..`/symlink escape, sensitive folders refused), folder watches, the CLI as an allow-listed sidecar. |
| Web `/automation` | A connector catalogue and a job grid **on demo data**. |

So there is a tunnel and a scope, but no automation model, no schedule, no permission model for tools, and one path —
remote shell execution — that must not survive.

## Decision

### 1. One model: an automation is *trigger + recipe + policy*, and every run is a job

An **automation** belongs to a tenant and a user and says:

- **trigger** — `schedule` (cron with a time zone; slice 1: daily at a time, chosen weekdays), `folder_watch`,
  `webhook`, `email` (IMAP, later). What to do with a missed slot is data (`catch_up`: `once` | `skip`, default `once`).
- **recipe** — what runs: a Studio, a pack Studio, a chat prompt, or a built-in recipe (slice 1:
  `summarise-new-pdfs`). Inputs come from a granted folder or a URL; outputs go to a folder, a notification or a webhook.
- **where** — `device:<id>` (the user's machine) or `cloud` (the engine). Model choice is data: a local endpoint and
  model id, or a model of the connected install routed as usual (ADR-029).
- **policy** — budgets (per run: files, tokens, credits; per day: runs, credits), retries and backoff, dry-run,
  approvals. Defaults come from a versioned settings rule set (v1 seeded by migration, bounded in code, edited in the
  admin console) — never constants (organisation rule of 2026-10-15).

A **run** is a normal Orazaka job: it has a job id, a feature key (`automation.<recipe>`), a status
(`QUEUED → RUNNING → AWAITING_APPROVAL → SUCCEEDED | FAILED | CANCELLED | HALTED | SKIPPED_BUDGET`), a usage record
(model, tokens in/out, duration, credits) and a **trace**: one step per tool call or model call, with timings and a
summary of inputs and outputs (never secrets, never the full untrusted content).

- *Connected* runs call the engine with the device's token: the chat/Studio gate already applies the content policy and
  takes the billing hold (ADR-033) — nothing new to meter twice.
- *Local* runs are priced by the pricebook like any job (local inference on the user's own hardware is 0 credits
  today) and reported to the workspace as jobs of feature key `automation.local.*`, so Jobs and Usage show them.

**Server tables** (`orazaka_automation_db`, Flyway, enums as Postgres enums): `automation`, `automation_trigger`,
`automation_policy`, `device`, `tool_grant`, `approval_request`, `automation_run`, `run_step`, `audit_event`,
`mcp_server` (catalogue: command, pinned version, the **effect of each tool**), `automation_settings` (rule set).
`audit_event` is insert-only for the service's role (`REVOKE UPDATE, DELETE`).

### 2. The runner: one Rust core, on the Mac now, headless later

The device runner is **Rust**, in `apps/desktop/src-tauri/src/automation/` (scheduler, store, MCP client, model client,
recipes, approvals, audit). The Mac app embeds it; the headless runner for Linux and Windows (slice 6) is the same core
in a small binary (`orazaka-runner`, systemd unit / Windows service, device-code login). This answers orazaka-cli#48:
the resident process is the Rust runner, not a Node daemon; the CLI stays a developer tool.

- **Scheduling happens on the device** for device automations: no server needs to wake a sleeping Mac, and it works
  offline. Cloud automations are scheduled by the automation service's Quartz (already configured; the trigger rows
  are the truth, Quartz executes them).
- **Models**: one port, the OpenAI-compatible `chat/completions` API, which Ollama, LocalAI, `mlx_lm.server` and vLLM
  all serve — so "local model" is a base URL and a model id (data), and the connected engine is a second adapter.

### 3. Tools are MCP servers, launched per run, limited to what was granted

The runner is an **MCP client** (stdio JSON-RPC). It launches only the servers an automation declares, pinned to a
version from the catalogue, with **roots = the granted folders** (the filesystem server: `@modelcontextprotocol/
server-filesystem` with the one folder as its only allowed directory). Two locks, not one: the server refuses paths
outside its roots, and the runner checks every path through the app's scope (`scope.rs`) before the call.

Every tool has an **effect**, declared as data in the catalogue: `read`, `write`, `external` (leaves the machine:
GitHub, mail, webhooks), `exec`. A tool the catalogue does not know is `exec`. The runner exposes to a recipe or an agent
only the tools it declared (least privilege per agent), and filters `tools/list` accordingly.

### 4. The permission model: a human before any side effect

- **`read`** runs inside the granted scope without asking (the user granted the folder).
- **`write` and `external`** need an **approval** unless an active **grant** covers *(automation, server, tool, scope)*.
  The run stops in `AWAITING_APPROVAL` with its drafted outputs; the **approvals inbox** (app and web) shows exactly what
  would be written or sent. Decisions: **approve once**, **approve always for this tool and folder** (creates a grant,
  listed and revocable), **deny**. Requests expire (rule set; default 24 h) — an unanswered run ends `CANCELLED`.
- **`exec` is refused in v1.** No shell, no interpreter. Code execution arrives only inside a sandbox (WASI,
  orazaka-ai-engine#19) with its own ADR. Consequently the `orazaka agent listen` path that `exec`s `payload.command` is
  **retired** (orazaka-cli PR), and `CLI_AGENT` payloads carrying `command`/`script` are refused by the runner.
- **Dry-run**: every side effect is recorded in the trace as *would write / would send* and nothing happens. New
  automations created from a template can start in dry-run.
- **Kill switch**: one control on the device (*Stop all agents*) halts running runs at the next step and pauses every
  schedule until released; the server can set the same flag on a device (slice 2) and the runner obeys on next contact.
- **Budgets**: checked before a run starts (runs per day) and before each model call (tokens, credits, files). A run
  that would exceed ends `SKIPPED_BUDGET` with what it did so far.
- **Audit**: every decision (created, edited, run started, tool called, approval asked/decided, grant created/revoked,
  kill switch) is an append-only event, **hash-chained** (each event carries the SHA-256 of the previous one), stored on
  the device and pushed to `audit_event`. The app shows the log and whether the chain verifies.

### 5. Safety

- **Prompt injection.** Content read by a tool is *data*. Slice 1 recipes are **fixed plans**: the model only produces
  text; it never chooses a tool, a path or a recipient, so a PDF that says "delete everything" changes nothing but a
  summary. Untrusted text is fenced and labelled in the prompt and size-capped; outputs are written only to the recipe's
  declared output path, as plain Markdown, size-capped. For agents (slices 4–5), where the model proposes tool calls,
  **taint**: once untrusted content entered the context, a proposed side effect always asks, even when a grant exists,
  unless its arguments were fixed by the plan.
- **Secrets** live in the macOS Keychain (device token, GitHub token) and reach an MCP server only as an environment
  variable of its process — never in a prompt, a trace or the audit log.
- **Content policy** applies to every connected run at the engine; local runs evaluate the same rule rows, synced to the
  device (slice 2). The one rule nobody can change (`MINORS_RISK`) is enforced on the device too.

### 6. Sync: the device belongs to a workspace, and works without it

The runner registers with the user's Orazaka workspace — **PKCE** sign-in in the Mac app (the page's own login; the app
never sees a password), **device authorization grant** (RFC 8628) for the headless runner. The device gets a revocable
token (Keychain) and an id. It **pulls** the automations assigned to it (`GET /api/v1/devices/{id}/automations?since=`)
and **pushes** runs, steps and audit events (idempotent by event hash). The existing agent SSE stream becomes the nudge
(`automations_changed`, `halt`) instead of a command channel. In **local mode** (no workspace) everything works offline:
the device store is the source of truth for its own automations.

### 7. UX — names agreed with the information architecture (docs/ux/information-architecture.md)

- **Automations** — scheduled or triggered recipes: list · *New from a template* · run history with step-by-step traces ·
  pause/resume · *Run now*. **Approvals** is its inbox (a count on the entry). On the web it joins the rail after Jobs
  when it leaves preview (the IA left that decision to this work); on the Mac it is a tab of the app; on the phone,
  approvals only (Settings › Automations), so a write can be approved from anywhere.
- **Agents** — the model-driven kind (slice 4+): the same list, history, approvals and audit, plus the team view of the
  Flock. One concept per word: an automation runs a fixed plan, an agent chooses its steps.

## Roadmap (slices)

| # | Slice | What a user can do at the end |
|---|---|---|
| 1 | **Mac: a scheduled local automation** *(this ADR, shipped)* | "Every morning at 8:00, summarise the new PDFs in ~/Documents/Inbox and save a note next to them": template, local model, filesystem MCP limited to that folder, approval before the first write and *approve always*, dry-run, kill switch, budgets, run history with trace, hash-chained audit. Local only. |
| 2 | **Sync, metering, connected engine** | Sign the Mac in to the workspace; automations assigned from the web; runs, traces and audit in Jobs; local runs reported as jobs; connected-engine model; server-side kill switch; content-policy rows on the device. |
| 3 | **Folder watch and webhook triggers; notification and webhook outputs** | "When a PDF lands in Inbox…"; a signed webhook starts a cloud automation; results notify or post. |
| 4 | **The GitHub agent** (orazaka-packs#24, the Contributor) | The first agent: GitHub MCP, token in the Keychain, dry-run first, approvals for every issue/PR, taint rule. |
| 5 | **The Flock** (discussion #122) | An agent team pack: roles as pack data, a plan shown before the run, the falcon's review as a gate, a human approves what leaves the machine. First case: the Loi 25 compliance file. |
| 6 | **Headless runner for Linux and Windows** | `orazaka-runner` with device-code login, as a service. |
| 7 | **Email/IMAP trigger; sandboxed execution** | Inbox triggers; code tasks (orazaka#109) through a WASI sandbox. |

## Consequences

- The automation service changes role: from connector stubs to the owner of automations, devices, grants, runs and
  audit; the stub connectors stay stubs until a pilot needs one (automation-service#8 stays *later*).
- `orazaka agent listen` loses its shell. Anyone relying on it (nobody in dev) gets the runner instead.
- The desktop app grows a second responsibility (running automations) next to the control panel; the runner core is
  kept free of Tauri types so slice 6 can lift it into its own crate.
- A grant is a durable permission: it is listed, revocable, audited, and narrow (one tool, one folder, one automation).

## Refused

- **Running automations on the server against the user's files** (upload, process, download): breaks the sovereign
  promise and the least-privilege scope; the server never sees the folder.
- **A Node daemon** (`orazakad`) as the runner: two runtimes on the device and a second implementation of the scope.
- **Letting the model call write tools freely with a "safe" system prompt**: prompt injection makes any instruction-based
  defence advisory; the plan and the approval gate are structural.
- **Shell commands from the server** (today's `CLI_AGENT`): remote code execution by design.
- **Storing schedules and budgets in code or config files**: they are business parameters (ADR-027).
