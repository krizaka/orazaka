---
title: Administration
description: What an Orazaka administrator controls — the SecOps console, every ADMIN-only endpoint, and how the console is secured — extracted from the code.
category: Operations
order: 2
generated: true
---

# Administration

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.

Everything commercial and operational in Orazaka is **data an administrator edits** — models, the
interceptor pipeline, capabilities, MCP servers, plans, prices, wallets, Studios — never a redeploy. An
administrator is an account holding `ROLE_ADMIN`, granted by the identity service; every
administrative endpoint checks it on the server (`@PreAuthorize`), whatever client calls it.

## The SecOps console (`orazaka-web-admin`)

A Next.js console (port 3001) started with the rest of the stack by `orazaka dev` (`--skip-admin` to leave it out).

| Screen | What it is for | Tabs |
|:---|:---|:---|
| `/` | Renders the remastered SecOps console landing. | — |
| `/billing` | The billing console. | Consommation · Tarifs par modèle · Tarifs par capacité · Offres · Packs métier · Portefeuilles |
| `/studios` | The Studio Builder console (ADR-034 §12.4). | — |

### How the console is secured

- **Sign-in by credentials only** — no social login: the role that matters is granted by the identity service, and an account without `ROLE_ADMIN` is refused a console session.
- **A backend-for-frontend** — the browser never reaches a service port: `/api/v1/**` is proxied server-side, the session token injected as `Authorization: Bearer`.
- **No internal surface** — `/internal/v1/**` (credit holds and settlements, registries) is not in the edge's route table, so the console cannot reach it by construction.

### What the console calls

| Method | Path | Access | Summary |
|:---|:---|:---|:---|
| GET | `/api/v1/features/all` | ADMIN | Admin: all capabilities (enabled or not) from the database. |
| GET | `/api/v1/models/catalog` | authenticated | Retrieves the complete AI model catalog definitions from the database. |
| GET | `/api/v1/billing/configuration` | ADMIN | The declared key vocabulary — type, permitted domain and code default per key. |
| PATCH | `/api/v1/billing/configuration` | ADMIN | Applies one validated configuration change. |
| GET | `/api/v1/billing/packs` | authenticated | The priced catalogue. |
| DELETE | `/api/v1/billing/packs/{packKey}` | ADMIN | Withdraws a pack from sale. |
| GET | `/api/v1/billing/packs/{packKey}` | authenticated | One pack with its entitlement matrix. |
| PUT | `/api/v1/billing/packs/{packKey}` | ADMIN | Creates or replaces a pack's price and entitlements. |
| GET | `/api/v1/billing/plans` | authenticated | The catalogue. |
| DELETE | `/api/v1/billing/plans/{planKey}` | ADMIN | Retires a plan — deactivated, never deleted, because subscriptions reference it. |
| GET | `/api/v1/billing/plans/{planKey}` | authenticated | One plan with its entitlement matrix. |
| PUT | `/api/v1/billing/plans/{planKey}` | ADMIN | Creates or replaces a plan. |
| GET | `/api/v1/billing/pricebook` | ADMIN | — |
| POST | `/api/v1/billing/pricebook` | ADMIN | — |
| POST | `/api/v1/billing/pricebook/preview` | ADMIN | — |
| DELETE | `/api/v1/billing/subscriptions/{actorId}` | ADMIN | Ends an actor's subscription. |
| GET | `/api/v1/billing/subscriptions/{actorId}` | ADMIN | The subscription in force for an actor. |
| POST | `/api/v1/billing/subscriptions/{actorId}` | ADMIN | Moves an actor onto a plan — upgrade, downgrade or trial. |
| GET | `/api/v1/billing/usage/capabilities` | ADMIN | Consumption and refusals per capability × model. |
| GET | `/api/v1/billing/usage/top-consumers` | ADMIN | The heaviest consumers. |
| GET | `/api/v1/billing/wallets/{actorId}` | ADMIN | Reads an actor's balances. |
| POST | `/api/v1/billing/wallets/{actorId}/adjustments` | ADMIN | Issues a manual credit adjustment — support goodwill, or a claw-back. |
| GET | `/api/v1/billing/wallets/adjustments/today` | ADMIN | What an admin has already adjusted today, against their ceiling. |
| GET | `/api/v1/studios` | authenticated | The catalogue, optionally narrowed to one profession. |
| GET | `/api/v1/studios/{studioKey}` | authenticated | One Studio's detail, including the schemas its forms are generated from. |
| GET | `/api/v1/studios/{studioKey}/blueprints` | ADMIN | Every version of a Studio, drafts included — the Builder's version list. |
| DELETE | `/api/v1/studios/{studioKey}/blueprints/{version}` | ADMIN | Deprecates a version without deleting it. |
| PUT | `/api/v1/studios/{studioKey}/blueprints/{version}` | ADMIN | Creates or replaces a draft version. |
| POST | `/api/v1/studios/{studioKey}/blueprints/{version}/publish` | ADMIN | Publishes a draft, minting it as the Studio's latest version. |

## Every ADMIN-only endpoint

What an administrator can do, by service — from the console, the CLI or any HTTP client with an
administrator's token (through the edge, `http://localhost:8088` locally).

### conversation-service

| Method | Path | Summary |
|:---|:---|:---|
| PUT | `/api/v1/features/{featureKey}` | Admin: toggles an existing capability's enabled state. |
| GET | `/api/v1/features/all` | Admin: all capabilities (enabled or not) from the database. |
| GET | `/api/v1/jobs/active-connections` | Retrieves the current active SSE connection count. |
| POST | `/api/v1/jobs/purge` | Purges jobs, chat sessions and rate-limit cache for the default test accounts. |
| GET | `/api/v1/mcp/servers/platform` | — |
| POST | `/api/v1/mcp/servers/platform` | — |
| DELETE | `/api/v1/mcp/servers/platform/{id}` | — |
| POST | `/api/v1/models` | Adds a new model definition to the catalog. |
| DELETE | `/api/v1/models/{id}` | Deletes a model definition by its database ID. |
| PUT | `/api/v1/models/{id}` | Updates an existing model definition in the catalog. |
| GET | `/api/v1/pipeline/interceptors` | Retrieves all pipeline interceptor configurations ordered by execution order. |
| PUT | `/api/v1/pipeline/interceptors` | Bulk-updates pipeline interceptor ordering and enabled state. |
| POST | `/api/v1/pipeline/interceptors/reset` | Resets all pipeline interceptor configurations to hardcoded defaults. |
| GET | `/api/v1/pipeline/validation` | Retrieves all validation pipeline tier configurations ordered by execution order. |
| PUT | `/api/v1/pipeline/validation` | Bulk-updates validation pipeline tier ordering and enabled state. |

### krizaka-billing-service

| Method | Path | Summary |
|:---|:---|:---|
| GET | `/api/v1/billing/configuration` | The declared key vocabulary — type, permitted domain and code default per key. |
| PATCH | `/api/v1/billing/configuration` | Applies one validated configuration change. |
| GET | `/api/v1/billing/pack-subscriptions` | Every live holder of a pack — what an admin checks before withdrawing one. |
| GET | `/api/v1/billing/pack-subscriptions/{actorId}` | The packs one actor holds. |
| DELETE | `/api/v1/billing/packs/{packKey}` | Withdraws a pack from sale. |
| PUT | `/api/v1/billing/packs/{packKey}` | Creates or replaces a pack's price and entitlements. |
| DELETE | `/api/v1/billing/plans/{planKey}` | Retires a plan — deactivated, never deleted, because subscriptions reference it. |
| PUT | `/api/v1/billing/plans/{planKey}` | Creates or replaces a plan. |
| GET | `/api/v1/billing/pricebook` | — |
| POST | `/api/v1/billing/pricebook` | — |
| GET | `/api/v1/billing/pricebook/history` | — |
| POST | `/api/v1/billing/pricebook/preview` | — |
| GET | `/api/v1/billing/subscriptions` | Every live subscriber of a plan — what an admin checks before retiring one. |
| DELETE | `/api/v1/billing/subscriptions/{actorId}` | Ends an actor's subscription. |
| GET | `/api/v1/billing/subscriptions/{actorId}` | The subscription in force for an actor. |
| POST | `/api/v1/billing/subscriptions/{actorId}` | Moves an actor onto a plan — upgrade, downgrade or trial. |
| POST | `/api/v1/billing/subscriptions/{actorId}/rollover` | Rolls a subscription into its next period, honouring a pending cancellation. |
| GET | `/api/v1/billing/usage/capabilities` | Consumption and refusals per capability × model. |
| GET | `/api/v1/billing/usage/top-consumers` | The heaviest consumers. |
| GET | `/api/v1/billing/wallets/{actorId}` | Reads an actor's balances. |
| POST | `/api/v1/billing/wallets/{actorId}/adjustments` | Issues a manual credit adjustment — support goodwill, or a claw-back. |
| GET | `/api/v1/billing/wallets/{actorId}/entitlements` | Reads an actor's effective entitlements plus their balance summary. |
| GET | `/api/v1/billing/wallets/adjustments/today` | What an admin has already adjusted today, against their ceiling. |

### studio-service

| Method | Path | Summary |
|:---|:---|:---|
| GET | `/api/v1/studios/{studioKey}/blueprints` | Every version of a Studio, drafts included — the Builder's version list. |
| DELETE | `/api/v1/studios/{studioKey}/blueprints/{version}` | Deprecates a version without deleting it. |
| PUT | `/api/v1/studios/{studioKey}/blueprints/{version}` | Creates or replaces a draft version. |
| POST | `/api/v1/studios/{studioKey}/blueprints/{version}/publish` | Publishes a draft, minting it as the Studio's latest version. |
| POST | `/api/v1/studios/packs/bundles` | Installs a bundle. |
| DELETE | `/api/v1/studios/packs/bundles/{bundleKey}` | Removes a bundle's catalogue rows and withdraws its pack from sale. |
| POST | `/api/v1/studios/packs/bundles/validation` | Checks a bundle against this platform without writing anything. |
