---
title: "ADR-085 — One operator audit trail: request id end to end, audit events through the outbox, one read model in the console"
description: "Every operator action leaves one audit event (actor, action, target, request id, outcome — never content), emitted by the service that did it through its outbox, read in one place in the console with filters and a link to the request; the console's actionable queue is driven by the same events."
category: ADR
order: 85
---

# ADR-085 — One operator audit trail

- **Status**: Proposed (design for the Dev preview criteria `admin.audit-log` and `admin.operator-tasks`; slices below, each test-first)
- **Date**: 2026-10-21
- **Builds on**: [ADR-083](ADR-083-client-connectivity-and-capacity.md) (request correlation), the platform kit's transactional outbox
  (`krizaka-platform-kit`; the leasing variant waits for its November release, so the **current** outbox is used),
  [ADR-035](ADR-035-service-to-service-authentication.md) (service identity)
- **Scope**: `orazaka-edge`, `krizaka-users`, `krizaka-billing`, `orazaka-studio`, `orazaka-ai-engine`, `orazaka-web-client` (`src/console`)

## Context

The console (`admin.orazaka.com`) lets an operator suspend or erase an account, grant credits, change prices and plans,
publish a Studio blueprint, change a model. Today the only audit trail is the identity service's `admin_audit` table: account
administration only, no request id, read through one screen. Billing, Studio and the engine record nothing an operator can
read, so « every operator action is in an audit log, with who, what, when, request id » (Dev preview `admin.audit-log`) is
false, and the console has nothing to show for the operator's *to-do* (failed runs, consent withdrawals, quota requests:
`admin.operator-tasks`).

## Decision

1. **A request id, end to end.** The edge gives every request an id (it already answers `x-request-id`); it is forwarded as
   `X-Request-Id` on every service-to-service call and message header, put in the logging MDC, and returned unchanged. A
   service never invents one when it receives one. Test per hop: a request through the edge reaches the service's MDC with the
   same id.
2. **An audit event, by the service that acted.** Each service writes, **in the same transaction** as the action, one row to its
   outbox: `{ eventId, at, actor (user id + role), action (a closed set, e.g. `account.suspend`, `credits.grant`,
   `price.publish`, `studio.publish`, `model.update`), target (type + id), requestId, outcome (`ok` | `refused` | `failed`),
   source service }`. **Never content**: no prompt, no message, no file name, no e-mail address — ids only (Law 25).
3. **One read model.** The outbox relays to one queue; a small consumer in the identity service's audit store (`admin_audit`,
   extended with `request_id`, `outcome`, `source`) is the **single read model**. The console's *Audit log* reads it
   (filters: actor, action, source, outcome, time; export CSV; each row links to the request by its id in the logs). The
   existing account-administration rows keep their shape; the new columns are nullable.
4. **Operator tasks from the same events.** A *Tasks* queue in the console is a view over events and run states, not a new
   store: failed runs the operator can retry (`outcome=failed` on a run), consent withdrawals and erase requests (the wellbeing
   events of orazaka#301), quota refusals. A task closes when its follow-up event arrives (retry succeeded, erase done).
5. **Closed set, tested.** The action names are an enum in `orazaka-contracts`; a test per service fails when an operator
   endpoint (`@PreAuthorize("hasRole('ADMIN')")` write) has no audit emission, so a new action cannot ship unaudited.

## Slices (each test-first, each with live proof on admin.orazaka.com as an operator, request ids in the PR)

1. **Request id propagation** (edge → users, billing, studio, job, engine): the test of each hop; proof: one request id seen
   in the edge answer and in each service's log line.
2. **Audit events from users and billing** (outbox → audit store; `request_id`, `outcome`, `source` columns): suspend/restore,
   erase, credit grant, price/plan publish; proof: perform each in the console, find the row with its request id.
3. **The console view**: Audit log filters, request link, CSV; Tasks queue (retry a failed run, consent withdrawals).
4. **Studio and engine**: blueprint publish, model enable/disable, content-policy changes.

## Consequences

- One place to answer « who did what, when, through which request », across services, without a shared database.
- An operator action that fails still leaves a row (`outcome=failed|refused`): the audit says what was *tried*.
- Costs: one more outbox event type per service and a consumer in the identity service; the leasing variant of the outbox
  (kit 0.3.0) replaces the current one without changing the event.
- Refused: a log-scraping audit (not transactional, loses events); one table written by every service (couples their
  databases, SEAM-001); storing the request's body (content in the audit).

## Delivery: how the services get the kit's building blocks before November (evaluated 2026-10-21)

The request-id filter (`krizaka-web` `CorrelationIdFilter`, same header and rules as the edge's) and the outbox are in
`krizaka-platform-kit` `main`, **unreleased**: Central has 0.2.0 without `krizaka-web`, and Maven Central is frozen until
November. Options weighed:

1. **GitHub Packages (Maven), `0.3.0-SNAPSHOT`.** Not clean today. GitHub Packages requires credentials *even to read a public
   package*: every consumer needs a token in `settings.xml` — the services' own CI (the `packages: read` GITHUB_TOKEN works
   there), but also the **DigitalOcean App Platform image build of `core`** (no GITHUB_TOKEN exists there: it would need a
   long-lived PAT as a build secret) and every developer's machine. It also forks the artefact's address (`maven.pkg.github.com`
   alongside Central) in six poms that must be reverted in November, and kit `main` still carries version **0.2.0** (release-please
   owns the bump), so a snapshot would collide with Central's different 0.2.0.
2. **A workspace build from source.** The Orazaka workspace already builds every repository from source in dependency order
   (`orazaka.workspace.json`, the core image, `component.yml`): the kit is in it. Orazaka-owned services (edge, studio, job service,
   engine) could consume the kit's `main` with no registry, no token, no Central. Cost: the kit's version must differ from
   Central's 0.2.0 while unreleased (a `0.3.0-SNAPSHOT` set by the release PR, krizaka-platform-kit#10, not by hand), and Krizaka's
   standalone, Central-published services (`krizaka-users`, `krizaka-billing`) cannot take it before it is on Central — they stay on
   0.2.0 until then.
3. **Wait for the release** (kit 0.3.0 on Central, November).

**Decision.** Do not publish to GitHub Packages. Build slices in the order the dependency allows:
- *Now, no kit:* the edge hop (done: orazaka-edge#33, live) and the **audit read model and console view** (they read what
  `admin_audit` already holds plus the new nullable columns; the console's *Audit log* gains the filters, the request link and
  the CSV; the *Tasks* queue reads run states the job and studio services already expose). These are Orazaka-owned and need no kit.
- *With workspace-from-source (option 2), once krizaka-platform-kit#10 sets 0.3.0-SNAPSHOT on `main`:* request-id hops and audit
  emissions in the **Orazaka-owned** services (studio, job service, engine).
- *With the Central release:* `krizaka-users` and `krizaka-billing` adopt the filter and emit their audit events.
