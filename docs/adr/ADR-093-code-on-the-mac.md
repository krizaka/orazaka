---
title: "ADR-093 — Code on the Mac: from a GitHub issue to a pull request, pack-gated, a human at every write"
description: "Orazaka for Mac reads and writes code in a repository the user grants and carries a GitHub issue into a draft pull request. The loop runs on the Mac (tools, approvals, git, audit); the model turn runs on the engine as a Studio run, which is also the pack gate. GitHub is a per-repository GitHub App with a device-flow user token in the Keychain that the model and the webview never see. Issue text is data in a fenced channel; the model has read tools, propose_diff and run_check by name, nothing else. Writes are approved per hunk, checks are user-confirmed argv commands in a Seatbelt sandbox, and push and PR happen only on an explicit click, never to the default branch."
category: ADR
order: 93
---

# ADR-093 — Code on the Mac: from a GitHub issue to a pull request

- **Status**: Proposed. Slices [orazaka#448](https://github.com/krizaka/orazaka/issues/448) →
  [#452](https://github.com/krizaka/orazaka/issues/452), each test-first. The dogfood test (#452) validates the feature.
- **Date**: 2026-10-27
- **Input**: [orazaka#109](https://github.com/krizaka/orazaka/issues/109) (the read/write scope) and Oussama's extension
  of 2026-10-27 (the issue → PR flow, the safety rules, the dogfood acceptance test).
- **Builds on**: [ADR-079](ADR-079-automations-and-local-agents.md) (the Rust runner in `apps/desktop`, effects, approvals,
  grants, taint, the hash-chained audit), [ADR-091](ADR-091-access-at-retrieval-and-at-the-tool.md) (the verified actor,
  per-tool roles, failing closed), [ADR-092](ADR-092-own-the-core-integrate-the-edges.md) (own the core, integrate the
  edges), [ADR-086](ADR-086-durable-agent-sessions-on-studio-runs.md) (durable agent sessions on Studio runs),
  [ADR-029](ADR-029-db-driven-ai-providers.md) (routing is data), ADR-033 (hold → settle), ADR-034 §8.3 and ADR-055
  (entitlement read twice, versioned consent), [ADR-064](ADR-064-trust-boundaries.md) (trust boundaries).
  krizaka/.github ADR-005 (the Tauri kit: `scope`, `secrets`).
- **Amends**: ADR-079 §4 (« `exec` is refused in v1 »): one narrow `exec` is allowed, the **check** (§4.4). ADR-079
  slice 4 (« GitHub MCP »): GitHub is a fixed port of the runner, not an MCP server (§2).
- **Scope**: `apps/desktop` (`src-tauri/src/automation/`, a new `code/` module), `krizaka-tauri-kit` (`scope`,
  `secrets`), `orazaka-packs` (the Contributor, orazaka-packs#24), `orazaka-studio` (entitlement, consent, the run),
  `orazaka-ai-engine` (routing rows, tool roles), `orazaka-automation-service` (`audit_event`).

## Context

The epic orazaka#108 puts Orazaka to work on code, and #109 is its local half: the Mac app is where Orazaka touches the
user's files. Oussama's extension makes it concrete and sellable. With the right pack, a user picks a GitHub issue, Orazaka
reads it and the repository, does the work locally, runs the declared tests, and opens a pull request. The user approves
every write and every push. The proof is a real krizaka issue carried to a green PR.

What exists (checked 2026-10-27):

| Piece | State |
|---|---|
| `apps/desktop` (Tauri 2) | Control panel, the ADR-079 runner (`automation/`: runner, store, MCP client, model client, approvals, grants, hash-chained `audit.rs`), the CLI sidecar. `fence()` keeps a document from closing its fence. |
| `krizaka-tauri-kit` | `scope` (granted folders, canonical paths, no `..` or symlink escape, sensitive folders refused), `secrets` (`SecretStore`, the macOS Keychain, one service per app), `files`, `access`. |
| MCP catalogue | `mcp-catalogue.json`: the filesystem server, each tool with an effect (`read`, `write`); an unknown tool counts as `exec`, which is refused. |
| Pack gate | `StudioAccessService`: billing's entitlement **or** an operator grant (`studio_entitlement_grant`), read cosmetically by the catalogue and authoritatively by the install and run paths. Consent is versioned (ADR-055). |
| GitHub | Nothing in the app. No Keychain item for it yet. |

## Decision

Decided in the DecisionList style: **✓** chosen, **✕** refused, **→** because, **!** what it costs.

### 1. GitHub connection: a GitHub App, a device-flow user token, the Keychain

- ✓ **One GitHub App, « Orazaka for Mac »**, owned by the krizaka org, public, **installed per repository** by the user.
  Repository permissions: **Metadata** read, **Issues** read, **Contents** read & write, **Pull requests** read & write.
  Nothing else: no Administration, Actions, Workflows, Secrets, Members or Checks write. The App id and client id are
  settings rows (data), so a firm on GitHub Enterprise Server can register its own App against its own host.
- ✓ **User-to-server token through the device flow.** No client secret on the Mac. The token is the intersection of
  what the App may do and what the user may do, limited to the repositories where the App is installed. It expires after
  8 h and is refreshed with a refresh token.
- ✓ **Both tokens in the macOS Keychain, Rust side only** (`krizaka-tauri-kit` `SecretStore`, keys `orazaka.github.access`
  and `orazaka.github.refresh`). They are **not** exposed to the webview's `KeyValueStorage` port, so the page sees only
  « connected as @login, N repositories ». A token is never in a prompt, a trace, the audit, a log, a URL, `.git/config`,
  argv or a check's environment. Git gets it through an in-memory askpass for the one push the user clicked.
- ✓ **Never the default branch.** Contents write cannot be narrowed to one branch on GitHub's side, so the runner enforces
  it: the only push is `HEAD:refs/heads/orazaka/<issue>-<slug>`. The runner refuses before git runs if the target is the
  default branch, a branch the rules endpoint reports as protected, or anything outside `orazaka/*`. `--force` is not
  reachable. Krizaka repositories also protect `main` server-side (PR + required CI), so the two locks are independent.
- ✓ **Rate limit**: a token bucket from the settings rule set (per minute and per run), plus `x-ratelimit-remaining` and
  the secondary-limit `Retry-After`, both honoured.
- ✓ **Revocation**: *Disconnect* deletes both Keychain items in one step and opens the GitHub page where the user
  uninstalls or revokes the App. Uninstalling the App on GitHub cuts the token without the Mac. An expired refresh token
  means reconnecting. The App's webhook is not used: the Mac needs no inbound call.
- ✕ **An OAuth App.** Its `repo` scope covers every repository the user can reach, private ones included, with full write
  and no expiry. → That is too much reach to hand to an agent that reads untrusted text.
- ✕ **A fine-grained personal access token pasted by the user.** → It works, but every user would handle a secret by
  hand, set the expiry and the scope themselves, and rotate it themselves. One supported way is the App.
- ✕ **The token on the engine** (server-side GitHub calls). → The engine would hold write access to customers' code, and
  the sovereign promise (ADR-079 « Refused ») says the server never touches the user's files.
- ! The App must be created on the krizaka org by its owner (an account action: Oussama, #451). Device flow must be
  enabled on the App. A user with many installations has to pick repositories on GitHub's install screen, which is one
  more step than OAuth.

### 2. A fixed GitHub port, not a GitHub MCP server

- ✓ The runner holds a **closed GitHub port** with four operations, `get_issue`, `list_comments`, `get_branch_rules` and
  `create_pull` (plus `whoami` and the installations list). Each is called by the **fixed plan** of the flow (§4), never by
  the model.
- ✕ **The GitHub MCP server** (ADR-079 slice 4's first idea). → It offers dozens of tools, merge and delete included. It
  would hold the token in its environment, and its tool surface changes with its version. ADR-092 says to integrate the
  edges behind our ports; here the edge is four REST calls.
- ! A small client to maintain (typed, recorded fixtures in tests). The model cannot « comment on the issue » or « request
  a review »; that is on purpose, and it can come later as a fixed, approved step.

### 3. Pack gating: a Studio of the Contributor pack, checked twice

- ✓ The feature is two Studios of the **Contributor** pack (orazaka-packs#24): `code.read-write` (#109's original scope)
  and `code.issue-to-pr`. Their entitlement keys are `studio.code.read-write` and `studio.code.issue-to-pr`, and
  `billable_capability = AGENT`. Billing sells them (plan rows or the pack purchase); dev, pilots and dogfooding use an
  operator grant (`studio_entitlement_grant`, with a reason and an expiry).
- ✓ **Consent** is a versioned statement (the ADR-055 mechanism; the pack is not REGULATED, so there is no age gate):
  « Orazaka reads the repositories you grant and sends the excerpts it needs to the model your workspace routes to. It
  writes nothing and pushes nothing without your approval. » A new version asks again.
- ✓ **How the Mac checks it**, mirroring `StudioAccessService`: cosmetically, the catalogue's access answer (for the
  signed-in actor, ADR-091) shows or hides the *Code* tab. Authoritatively, every model turn of a session is a step of a
  **Studio run** (ADR-086). The engine refuses it with `studio_not_entitled` (no entitlement) or `consent_required` (old
  or missing consent) before any token is spent. Credits gate volume through hold → settle (ADR-033).
- ✕ **A local flag, a licence file or a cached « entitled » boolean** unlocks nothing. → A Mac binary can be patched;
  only the server's answer to a real run is a gate. A patched app that shows the tab still gets no model turn.
- ! The feature needs a signed-in workspace (cloud, or a sovereign install, which can be on the same Mac). There is no
  offline mode for `code.issue-to-pr`, and that is deliberate: GitHub is online anyway.

### 4. Injection safety: data is data, the model has four verbs

1. ✓ **A data channel.** The issue title and body, each comment, file contents, search hits and check output are
   **untrusted data**. They travel as tool results or labelled user-role data parts, fenced (the `fence()` escaping,
   generalised to every untrusted source: `<untrusted source="github-issue" author="…" association="…">`), size-capped
   per source and per turn. Nothing untrusted is ever interpolated into the system or developer instructions. A governance
   test reads the prompt templates and fails on an untrusted field. Comments keep their author and their GitHub
   `author_association`, so the plan shows « from a maintainer » versus « from anyone ».
2. ✓ **The tool allow-list** offered to the model is closed and declared by the runner, effects as data (ADR-079 §3):
   `read_file`, `list_dir`, `search_text`, `outline` (`read`), `propose_diff` (`write`, but it produces a **pending**
   diff and writes nothing), and `run_check(name)` (`exec`, by **name** from the confirmed list only). There is no shell,
   no network tool, no git tool and no GitHub tool. On the engine side the same list passes ADR-091's per-tool roles; a
   tool the actor lacks is never offered.
3. ✓ **Taint** (ADR-079 §5): a code session is tainted from its first untrusted byte, which in practice is the issue
   itself. So every side effect asks, even under a grant, unless the plan fixed its arguments: every hunk, a check after
   a « changes what runs » hunk (§4.4), the commit, the push and the PR.
4. ✓ **Checks are the only `exec`** (amends ADR-079 §4). A check is `{name, argv[], cwd, timeout, network}`. The repository
   may **suggest** checks (`package.json` scripts, `Cargo.toml`, `pom.xml`, `.orazaka/checks.json`), but the **user
   confirms each one** in the app, once per repository and device. The confirmation is a listed, revocable, audited
   `exec` grant. A repository, an issue or a diff can therefore never add a command to the allow-list. A check runs with
   argv and no shell, cwd = the repository, an environment from an allow-list (no Keychain item, no token), inside a
   **Seatbelt profile** (`sandbox-exec`): writes only under the repository, `$TMPDIR` and the toolchain caches, and network
   denied unless the check declares it and the user confirmed it. Timeouts, output caps and runs per session come from the
   rule set. A hunk that touches what a check runs (`package.json` scripts, `Makefile`, `build.rs`, `.husky/`,
   `lefthook.yml`, `.pre-commit-config.yaml`, `.github/workflows/`, test configs) carries a « changes what runs » badge,
   and the next check asks again.
5. ✓ **Path scoping**: `krizaka-tauri-kit` `scope` resolves every path (canonical, inside the granted repository, no
   `..`, no symlink out, checked at the call and again at the write). `.git/**` is never a write target, and a new file's
   parent is resolved before it is created.
6. ✓ **Secrets never enter the prompt.** One visibility function feeds every read tool. Gitignored files, `.git/`, and the
   secret patterns of the rule set (dotenv files, keys and certificates, SSH keys, registry credentials, cloud credential
   files) are invisible even when tracked, and are refused as write targets. A redactor strips known token shapes (GitHub,
   Orazaka `oz_`, OpenAI-style `sk-`, AWS key ids, PEM blocks) from file text and check output before anything leaves the
   runner. The redactor runs on what goes **to** the model, and once more on what the model **proposes**: a diff that
   introduces a token-shaped string is flagged.
7. ✕ **« A good system prompt »** as the defence. → Instruction-based defences are advisory under injection (ADR-079
   « Refused »). The structure is the defence: the closed tool list, pending diffs, the approval gates and the push lock.
- ! Seatbelt (`sandbox-exec`) is deprecated by Apple yet still shipped and used by today's coding agents. If Apple removes
  it, the fallback is a separate, App-Sandboxed helper; that would be its own ADR. Some test suites need the network (a
  registry, a container), so the user confirms that per check, and it is shown as such.

### 5. The local flow

The flow is a **fixed plan**. The model fills in its contents (the plan text, the diffs, which confirmed check to run)
but never its steps.

1. **Choose**: repository (granted folder whose `origin` is a repository where the App is installed) and issue (list or
   number). The working tree must be clean; otherwise the app says so and stops.
2. **Read**: issue and comments through the port, into the data channel (§4.1). Hashes of the bodies are kept, not the
   text.
3. **Plan**: the model proposes steps and the files it expects to touch. The user reads it and goes on, edits the goal,
   or stops.
4. **Branch**: `orazaka/<issue>-<slug>` from the fetched head of the default branch; the base sha is recorded; a snapshot
   ref `refs/orazaka/snapshots/<run-id>` makes *Undo* one click.
5. **Diffs**: proposed per file, reviewed side by side, **approved or rejected per hunk**, applied exactly against the
   recorded base blob (if the base changed, the diff is refused and re-proposed). Nothing reaches the disk without
   approval.
6. **Checks**: confirmed checks run through the runner (§4.4); output goes back to the model as data; the model may
   iterate within the run's budget (turns, hunks, check runs, credits).
7. **Commit**: with a message the user edits, under the **user's** git identity, with the trailer `Orazaka-Run: <run-id>`.
   Hooks run as configured in that repository (inside the same profile); `--no-verify` is never passed.
8. **Push and PR, only on an explicit click**: push to the `orazaka/*` branch only (§1), then `create_pull`: a **draft**
   by default, body = the plan, the checks run with their results, `Closes #<issue>` (editable) and the run id.
9. **Audit**: one run record (ADR-079 run model, feature key `agent.code.issue-to-pr`) with the issue ref and body hash, the
   base sha, the branch, each hunk approved or rejected (hash), each check (name, argv hash, exit, duration, `timed_out`),
   the commit sha, the PR URL, the models used and the credits. It is hash-chained on the device and pushed to
   `audit_event` (append-only) when signed in. The **run id** is the Studio run's, so the engine's proof sections and the
   PR point to the same id.

- ✕ **Auto-push, auto-PR, or « approve all hunks »** in v1. → The extension says the user approves every write and every
  push. A grant for « every hunk of this run » would turn the review into a single click.
- ✕ **Working in the user's current branch or a dirty tree.** → Undo and the audit need a known base.

### 6. Where the code lives, and which model

- ✓ **The loop runs on the Mac**, in the ADR-079 Rust runner (`apps/desktop/src-tauri/src/code/`, free of Tauri types so
  the headless runner can lift it). It owns the tools, the scope, the approvals, git, GitHub, the Keychain and the audit.
  **The engine owns the model turn**: each turn is a step of the Studio run (ADR-086 durable session), so gating, consent,
  metering, routing, the content policy and the per-tool roles apply unchanged. The repository never leaves the Mac; only
  the excerpts the model asked for, already filtered and redacted, go to the engine.
- ✓ **Model choice is routing data** (ADR-029): the feature key `agent.code.issue-to-pr` maps to code models in the
  registry, local first in a sovereign install (`qwen2.5-coder`, …), provider models only where the workspace opted in.
  The Mac never names a provider or a base URL for this feature.
- ✕ **The agent on the engine with a server-side clone.** → It breaks the sovereign promise and ADR-079's refusal (the
  server never sees the folder), and it would need the GitHub token on the server.
- ✕ **The Mac calling a local model directly** (ADR-079's OpenAI-compatible port) for this feature. → It bypasses the pack
  gate, the metering and the routing. Fixed-plan automations keep that port; the paid code agent does not use it.
- ✕ **A new agent framework** (LangChain4j, LangGraph4j, a Node agent). → ADR-092: we own the loop. ADR-079: one runtime on
  the device.
- ! Each turn costs a round trip to the engine, and a sovereign install on the same Mac makes it local again. The
  runner's session state must survive an app restart (ADR-086 leases).

### 7. What is refused

- ✕ Any push to the default branch or a protected branch; any `--force`; any `--no-verify`.
- ✕ Commands the user did not confirm; a shell; commands from the issue, the repository or the model.
- ✕ The model calling GitHub, git or the network; a GitHub MCP server holding the token.
- ✕ A token in a prompt, a URL, `.git/config`, a log, argv, an environment variable of a check, or the webview.
- ✕ Reading gitignored or secret-pattern files; writing outside the repository, into `.git/`, or through a symlink.
- ✕ Issue or comment text as instructions; untrusted text in the system prompt.
- ✕ OAuth App `repo` scope, pasted PATs, server-side clones, a local unlock flag.
- ✕ Merging, closing issues, labelling, commenting or requesting reviews in v1: a human does that on GitHub.

### 8. Cost

- **Per run**: model tokens through the engine, billed as `AGENT` with hold → settle; 0 credits on a sovereign install's
  local models (pricebook). Budgets per run (turns, tokens, credits, files read, hunks, check runs, wall time) come from
  the settings rule set, bounded in code; a run that hits one stops with what it did (`SKIPPED_BUDGET`). GitHub calls
  are free within the rate limit.
- **To build**: five slices, all in this repository except the pack data (orazaka-packs) and the Studio rows
  (orazaka-studio). Slices 1 and 2 are independent of GitHub and of the pack, so they can start now.
- **Outside the code**: the GitHub App (#451, Oussama). Developer ID signing and notarisation (orazaka#87, .github#85) are
  needed before the feature is offered to anyone else. The dogfood run on Oussama's Mac can use the unsigned build
  (krizaka-ui#762: the Keychain prompt).
- **Price of the pack**: Oussama's call, not this ADR's; until then, operator grants.

## Slices

| # | Issue | What works at the end | Acceptance (summary) |
|---|---|---|---|
| 1 | [#448](https://github.com/krizaka/orazaka/issues/448) | Grant a repository; read tools behind the visibility filter and redactor; pending diffs reviewed and approved per hunk; exact apply; undo | Rust: `..`, symlink (before and during the run), hard link, tracked dotenv and gitignored files refused or invisible; token redacted; conflict detection; undo byte for byte. UI: 2 of 3 hunks applied |
| 2 | [#449](https://github.com/krizaka/orazaka/issues/449) | User-confirmed checks: argv, no shell, scrubbed environment, Seatbelt, timeouts, redacted output | Unknown name refused; metacharacters literal; no token in the environment; no write outside, no socket without `network`; « changes what runs » asks again; timeout kills the tree |
| 3 | [#450](https://github.com/krizaka/orazaka/issues/450) | The Contributor pack's Studios, consent, the twice-read gate; the agent loop with the engine as the model turn; the data channel; routing rows | No entitlement: hidden, and a forged call gets `studio_not_entitled`. The injection suite (issue, file, test output) yields no off-list tool, no unapproved write, no token in a captured prompt. Template governance test |
| 4 | [#451](https://github.com/krizaka/orazaka/issues/451) | The GitHub App, device flow, Keychain; the fixed port; the full flow up to a draft PR on click; rate limit; audit; disconnect | Default, protected and non-`orazaka/*` targets refused before git; token absent from every sink; recorded-fixture flow end to end, no click no push; disconnect clears both secrets |
| 5 | [#452](https://github.com/krizaka/orazaka/issues/452) | **Dogfood**: a real small krizaka issue carried from Oussama's Mac to a PR with green CI, reviewed by a human | Run id, PR link, verified audit chain, a recording on Bunny under `pr-assets/orazaka/109/`; every surprise becomes a guard |

Order: 1 and 2 (in parallel), then 3, 4, 5. Slice 1 is *Next* on the board.

## Consequences

- `apps/desktop` gains a *Code* tab and a `code/` module next to `automation/`. They share the run model, approvals,
  grants and audit.
- ADR-079's `exec` refusal now has one exception, the user-confirmed check in a sandbox, and its slice 4 goes through a
  fixed port. Every other `exec` stays refused.
- The engine sees code excerpts that the user's own actions granted, filtered and redacted, under the content policy and
  retention of ADR-064/065. The repository and the GitHub token stay on the Mac.
- The web client gets **no** write path for code (parity is the read-only view of #108). The phone may approve a pending
  PR click later, as an ADR-079 approval.
