---
title: Repositories
description: One GitHub repository per component — what each holds, what it depends on, and how they assemble into the workspace.
category: Architecture
order: 3
generated: true
---

# Repositories

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.

Orazaka is published as **20 repositories** in the [`krizaka`](https://github.com/krizaka) organisation: one per component, plus the workspace [`orazaka`](https://github.com/krizaka/orazaka) that assembles them (governance contract, `orazaka.workspace.json`, local infrastructure, end-to-end tests, these docs).

```bash
git clone https://github.com/krizaka/orazaka.git && cd orazaka
node scripts/workspace.mjs clone   # every repository at its workspace path
./mvnw install                     # the whole platform, in one reactor
```

## Foundation — reusable by any application

| Repository | Kind | What it holds | Depends on |
|:---|:---|:---|:---|
| [`orazaka-build`](https://github.com/krizaka/orazaka-build) | maven | Parent POM (Spring Boot / Spring AI BOMs, plugin management, Orazaka BOM) and the shared governance test kit (ArchUnit rules, Testcontainers base) for every Orazaka JVM repository. | — |
| [`orazaka-contracts`](https://github.com/krizaka/orazaka-contracts) | maven | Tier-1 platform contracts shared by every Orazaka service: the job plane (jobs-api) and the application-persistence ports (persistence-app-api). Pure interfaces and records, zero implementation. | `orazaka-build` |
| [`orazaka-edge`](https://github.com/krizaka/orazaka-edge) | maven | Transparent HTTP edge in front of every Orazaka service: routing, API-key → JWT exchange, CORS and tracing. Spring MVC + virtual threads. Modules: `orazaka-edge`. | `orazaka-build` |
| [`orazaka-ui-kit`](https://github.com/krizaka/orazaka-ui-kit) | npm | @krizaka/orazaka-shared (TypeScript types, Zod schemas, design tokens) and @krizaka/orazaka-design-system (React components, Tailwind preset, theme, icon registry) for Next.js and React Native apps. | — |

## Domain services — reusable by any application

| Repository | Kind | What it holds | Depends on |
|:---|:---|:---|:---|
| [`orazaka-users`](https://github.com/krizaka/orazaka-users) | maven | Reusable user management for any Krizaka application: registration, e-mail verification, login (password + Google/GitHub OAuth), forgot/reset password, profile & preferences, API keys, RBAC and JWT issuance. Modules: `orazaka-persistence-identity`, `orazaka-identity`, `orazaka-identity-service`. Owns `10-identity.sql`. | `orazaka-build` |
| [`orazaka-notifications`](https://github.com/krizaka/orazaka-notifications) | maven | Channel-based notification delivery for any Krizaka application: e-mail (SMTP), SMS (Twilio) and webhooks behind one DeliveryClient port, driven by platform events (user registered, password reset) or explicit notification requests over AMQP. Modules: `orazaka-notification-service`. | `orazaka-build` |
| [`orazaka-billing`](https://github.com/krizaka/orazaka-billing) | maven | Credits, wallets, plans, subscriptions, pricebook and metering (hold → settle → release) as a reusable billing service, with its contract (billing-api) and a typed HTTP client (billing-client). Modules: `orazaka-billing-client`, `orazaka-billing-service`. Owns `70-billing.sql`. | `orazaka-build` |

## Orazaka AI engine

| Repository | Kind | What it holds | Depends on |
|:---|:---|:---|:---|
| [`orazaka-studio`](https://github.com/krizaka/orazaka-studio) | maven | Studio & pack marketplace: pack catalogue, studio blueprints, installations and saga-driven runs, with its contract (studio-api) and HTTP client (studio-client). Modules: `orazaka-studio-client`, `orazaka-studio-service`. Owns `80-studio.sql`. | `orazaka-build`, `orazaka-contracts`, `orazaka-billing` |
| [`orazaka-ai-engine`](https://github.com/krizaka/orazaka-ai-engine) | maven | The Orazaka cognitive SDK: AiClient & provider mesh (core), the interceptor pipeline, tools (MCP · RAG · sandbox), use-case orchestration (business), application persistence and asset encryption. Modules: `orazaka-persistence-app`, `orazaka-core`, `orazaka-interceptors`, `orazaka-business`, `orazaka-tools`. Owns `60-governance.sql`. | `orazaka-build`, `orazaka-contracts`, `orazaka-billing`, `orazaka-studio` |
| [`orazaka-conversation-service`](https://github.com/krizaka/orazaka-conversation-service) | maven | Interactive ingress of the Orazaka engine: chat (SSE streaming), intents, models, pipeline, MCP and job APIs — translates transport into Intentions, never business logic. Modules: `orazaka-conversation-service`. Owns `20-conversation.sql`. | `orazaka-build`, `orazaka-contracts`, `orazaka-users`, `orazaka-billing`, `orazaka-ai-engine` |
| [`orazaka-job-service`](https://github.com/krizaka/orazaka-job-service) | maven | Asynchronous job executor of the Orazaka engine: drains the interactive and batch lanes, owns the capability registry and the worker registry. Modules: `orazaka-job-service`. Owns `30-jobs-config.sql`. | `orazaka-build`, `orazaka-contracts`, `orazaka-users`, `orazaka-billing`, `orazaka-ai-engine` |
| [`orazaka-knowledge-service`](https://github.com/krizaka/orazaka-knowledge-service) | maven | Knowledge & RAG retrieval service (pgvector) with asynchronous indexing. Modules: `orazaka-knowledge-service`. Owns `40-knowledge.sql`. | `orazaka-build` |
| [`orazaka-automation-service`](https://github.com/krizaka/orazaka-automation-service) | maven | Connector automation (Jira, Slack, WhatsApp, Messenger, CLI agents) with Quartz scheduling and execution telemetry. Modules: `orazaka-automation-service`. Owns `50-automation.sql`. | `orazaka-build`, `orazaka-billing` |

## Native workers

| Repository | Kind | What it holds | Depends on |
|:---|:---|:---|:---|
| [`orazaka-worker-media`](https://github.com/krizaka/orazaka-worker-media) | python | Native (Metal) Python worker for image/video generation and media composition, speaking the Orazaka AMQP worker protocol. Modules: `orazaka-worker-media`. | — |

## Applications

| Repository | Kind | What it holds | Depends on |
|:---|:---|:---|:---|
| [`orazaka-web-client`](https://github.com/krizaka/orazaka-web-client) | npm | Next.js (App Router) client of the Orazaka platform with its mandatory BFF. Modules: `orazaka-web-client`. | `orazaka-ui-kit` |
| [`orazaka-web-admin`](https://github.com/krizaka/orazaka-web-admin) | npm | Next.js SecOps & administration console of the Orazaka platform. Modules: `orazaka-web-admin`. | `orazaka-ui-kit` |
| [`orazaka-mobile-client`](https://github.com/krizaka/orazaka-mobile-client) | npm | Expo / React Native client of the Orazaka platform (talks to the edge with Bearer tokens). Modules: `orazaka-mobile-client`. | `orazaka-ui-kit` |
| [`orazaka-cli`](https://github.com/krizaka/orazaka-cli) | npm | The `orazaka` developer CLI: install, start, dev, test, docs and pack tooling for the Orazaka workspace, with an offline SQLite queue. Modules: `orazaka-cli`. | — |

## Content

| Repository | Kind | What it holds | Depends on |
|:---|:---|:---|:---|
| [`orazaka-packs`](https://github.com/krizaka/orazaka-packs) | packs | Reference packs for the Orazaka Studio marketplace (document validation, media, prospection, real-estate, wellbeing…) and the pack manifest schema. | — |

## Rules

- A repository depends only on repositories listed **before** it in `orazaka.workspace.json` — the graph has no cycle.
- A domain repository holds its contract, its client and its service together; other repositories depend on the contract or the client, never on the implementation.
- A repository owns its context's bootstrap SQL (`infra/initdb/NN-*.sql`).
- Cross-repository governance rules run inside the workspace and are reported as skipped — never as passed — in a standalone clone.
