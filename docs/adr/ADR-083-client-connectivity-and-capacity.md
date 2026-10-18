---
title: "ADR-083 — Client connectivity and capacity: how clients reach Orazaka, and how we know it holds"
description: "How the products, the web, mobile, desktop and CLI clients connect today (HTTPS through the edge, polling for long runs), which other ways we offer and refuse, a default per client type, the contract rules, an SLO per endpoint class, a capacity model, backpressure, and a k6 suite that proves it — with the first measurements and the first bottleneck."
category: ADR
order: 83
---

# ADR-083 — Client connectivity and capacity

- **Status**: Accepted. Slice 1 (idempotency keys, a per-key rate limit in `observe` mode, the k6 suite, the CI smoke) is
  shipped by the pull requests in *Slices* below. The other slices are open issues, in order.
- **Date**: 2026-10-18
- **Builds on**: [ADR-028](ADR-028-transport-selection-rest-graphql-amqp.md) (transport by the shape of the interaction),
  [ADR-032](ADR-032-microservices-decomposition-strangler-fig.md) (the edge, the broker's exchanges are the API),
  [ADR-033](ADR-033-credit-metering-and-billing.md) (idempotency by a unique key), [ADR-070](ADR-070-the-run-surface-is-sealed.md),
  [ADR-076](ADR-076-the-voice-turn.md) (SSE, never WebSocket), [ADR-077](ADR-077-hourly-gpu-and-9x16-video.md) and
  [ADR-078](ADR-078-runpod-serverless-workers-at-zero-idle.md) (GPU work is queue-bound)
- **Issues**: [#189](https://github.com/krizaka/orazaka/issues/189) (run events: SSE + signed webhooks — extended here, not
  duplicated), [#214](https://github.com/krizaka/orazaka/pull/214) (the PgBouncer budget), [#215](https://github.com/krizaka/orazaka/issues/215)
  (core resize), [#157](https://github.com/krizaka/orazaka/issues/157) (async pipeline blueprint),
  [orazaka-cli#48](https://github.com/krizaka/orazaka-cli/issues/48) (daemon and protocol evaluation),
  [orazaka-conversation-service#10](https://github.com/krizaka/orazaka-conversation-service/issues/10) and
  [#19](https://github.com/krizaka/orazaka-conversation-service/issues/19) (pool leak; SSE ids)
- **Scope**: `orazaka-edge`, `orazaka-studio`, `krizaka-users` (exchange), `tests/load/`, `.github/workflows/load-smoke.yml`

## Context

Oussama's question: *how do clients connect to Orazaka (HTTP today, but can we offer other ways?), and how do we make sure
Orazaka holds the load?* Before choosing, this is what the code and the running dev stack say.

### Today, as found in the code

| Client | How it connects today | Auth | Evidence |
|:---|:---|:---|:---|
| **Products** (Orochia, Yomizaka, Yasakia, Yororis, Kachizaka, Akinaza) | Server to server: HTTPS to `…/edge` (`POST /api/v1/studios/{key}/runs` → **202 + run id**, then **polling** `GET /runs/{id}`); embeddings, recommendations and analytics are plain POST/GET | a **service key** `oz_…` with scopes (`ai:embed`, `reco:*`, `analytics:*`) | the integrations post; `ApiKeyScopes`; `docs/DEPLOY_DEV.md` |
| **Web client / admin** | Next.js BFF → edge; chat tokens over **SSE** (`GET/POST /api/v1/chat/stream/{id}`), the voice turn over SSE (ADR-076), per-user job events over SSE (`GET /api/v1/jobs/stream`) | session JWT | `ChatController`, `VoiceController`, `JobStreamService` |
| **Mobile** | REST with a bearer token to the same edge; a compatibility and forced-update rule is a proposal ([#187](https://github.com/krizaka/orazaka/pull/187)) | session JWT | `docs/MOBILE.md` |
| **Desktop** (Tauri) | two connection modes (local engine, account), REST | session JWT / key | [#173](https://github.com/krizaka/orazaka/pull/173), [#193](https://github.com/krizaka/orazaka/pull/193) (open) |
| **CLI** | REST; a daemon over a Unix socket is being evaluated | key / JWT | orazaka-cli#48 |
| **Workers** (media, validation) | **AMQP** over TLS to RabbitMQ (`orazaka.jobs`, `orazaka.events`); the GPU host dials out through a chisel relay | broker credentials | `docs/WORKER_PROTOCOL.md`, ADR-077 |
| **MCP** | Orazaka is an MCP **client** only (it calls servers); nothing exposes Orazaka as an MCP server | — | the integrations post |

What the edge does (`orazaka-edge`, Spring MVC on virtual threads): a streaming reverse proxy (it flushes every upstream
chunk, which is what keeps SSE unbuffered), CORS, tracing, and for `oz_` keys an **uncached exchange** at the identity
service on every call (revocation takes effect at once), a scope check, and a **daily quota per key** (2 000, in memory, reset
by a restart). Everything else is the services'.

### What is missing, found while reading

1. **No idempotency on run start.** A cut connection after the engine accepted leaves a paid orphan run or a lost one
   (the integrations post says so; the billing ledger is idempotent, the door in front of it was not).
2. **Polling only** for long runs. Seeding Orochia's dataset would have polled ~360 jobs a pass against a 2 000-call daily
   quota; no push exists (#189, open, **no owner**).
3. **No per-minute limit at the edge.** The tiers exist as data (`rate_limits.requests_per_minute`, `concurrent_jobs`, a
   `users.rate_limit_tier`), a Redis bucket4j filter enforces them in the conversation service, but it is **off** in dev
   (`orazaka.identity.rate-limit.enabled`, no Redis deployed). A looping product gets 2 000 calls a day and nothing sooner.
4. **A refusal does not say when to come back.** The daily 429 had no `Retry-After`; the Studio's concurrency cap
   (`run.max-concurrent-per-actor` = 2) answers a bare 409.
5. **Circuit breakers are a claim, not a dependency.** `ProviderMetrics` documents a "Resilience4j health score";
   no service has Resilience4j in its pom. Provider timeouts exist per call; breaking a failing provider does not.
6. **The broker already bounds the queue**: `BROKER_QUEUE_MAX_LENGTH` 1 000 with `rejectPublish`. What the client then
   sees is not specified.
7. **Contract copies drift unseen.** The edge copies the exchange response shape, products copy run shapes; no test
   compares the copies (the integrations post names the gap).
8. **No load test of any kind.** The only capacity datum is M0: the run saga adds p95 30 ms (37 SQL statements) over a
   direct call. Nothing says how many runs, chats or calls the stack carries.

## Decision

### 1. Connectivity: seven ways considered, one default per client

| Way | Good for | Cost and risk | Decision |
|:---|:---|:---|:---|
| **REST over HTTPS** (today) | everything bounded; any language with `fetch`; cacheable, debuggable, one OpenAPI | polling for long work | **Stays the base** of every client |
| **REST + SSE for progress** (#189) | browsers, mobile, CLI, and products that show progress; plain HTTP, proxies and Last-Event-ID resume work; ADR-028 and ADR-076 already say SSE | a held connection per watcher (a virtual thread, KBs); idle timeouts need a heartbeat; per-instance emitter registry must become a fan-out before the core scales out | **Accepted — the default for progress** |
| **Signed webhooks** | product backends (no connection to hold, survive restarts), automations (ADR-079 outputs) | at-least-once, so duplicates; signature, rotation, retries, a delivery log; the receiver must be reachable | **Accepted — the default server to server** for "done / failed" |
| **WebSocket** | true bidirectional low-latency (live mic up while speech comes down) | sticky sessions, no HTTP semantics, proxies, a second auth path; the organisation's doctrine already refuses it (ADR-028 dropped the dead GraphQL subscription; ADR-076 "never WebSocket") | **Refused** for chat and the voice turn. Reopened only if a measured voice-barge-in need proves SSE + POST too slow |
| **gRPC / HTTP/2 streaming** | very high-rate internal clients, typed streams | a second contract (proto) beside OpenAPI, no browser without a proxy, nothing in our load needs it (§4: the edge is far from its ceiling) | **Refused for now.** Revisit with evidence: a client above ~1 000 small calls/s. The CLI daemon's protocol stays orazaka-cli#48's call |
| **Message broker** (RabbitMQ) for product backends | a backend that prefers queues; on-prem installs where the broker is already inside the customer's network | exposing a broker publicly is a large attack surface (the dev broker is VPC-only on purpose, ADR-077); a second API to version | **Not on the hosted platform.** The `orazaka.jobs` / `orazaka.events` exchanges stay a *stable* internal and on-prem contract (ADR-032) and are documented as such |
| **Official SDK** (TypeScript, Java) | hides auth, retries with backoff that honours `Retry-After`, idempotency keys, SSE resume, webhook signature verification | maintenance — kept near zero by **generating** it from the OpenAPI (§2); Maven Central publication waits for the November quota | **Accepted**: generated clients, no hand-written transport. The integrations post's "no shared SDK" stays true for the engine's *internal* repositories |
| **MCP server** | AI agents (Claude, IDEs) calling Studios as tools | every tool is code that runs: consent, tool-description trust, scopes, an approval gate (the spec itself warns); a new public surface | **Accepted, later**: Streamable HTTP at the edge, the same keys and scopes, read-safe tools first, anything that spends goes through the run path (idempotency key, hold, approval). Tracked, not started |

**Default per client type**

| Client type | Request/response | Progress and results | Notes |
|:---|:---|:---|:---|
| Product **backend** | REST + service key + `Idempotency-Key` | **webhook**; SSE stream as the fallback while it is not built, polling meanwhile | the generated SDK once it exists |
| **Browser** (web, admin) | REST through the BFF | **SSE** | chat and voice already |
| **Mobile** | REST + bearer | **SSE** in the foreground, push notification for a finished run when backgrounded | the forced-update rule (#187) covers old apps |
| **Desktop**, **CLI** | REST + key/JWT | **SSE** | the CLI daemon may add a local socket; the wire to the edge stays HTTP |
| **AI agent** | MCP over HTTP (later) | resource/status polling inside MCP | same keys, same limits |
| **Worker** | AMQP over TLS (`WORKER_PROTOCOL.md`) | — | never client-facing |

### 2. The contract and how it is versioned

- **Source of truth: one OpenAPI 3.1 document per public surface**, generated from the controllers at build and committed
  in `contracts/openapi/` of this repository (the generated API reference becomes a view of it). A CI check refuses a
  breaking change inside `/api/v1`. The SDK, the docs and the contract fixtures below are all derived from it.
- **A test that compares the copies.** Producers and consumers share *fixtures*, not a jar: `contracts/fixtures/*.json`
  holds the recorded request/response bodies (the key exchange with its tier, a run, a run event, a webhook body). The
  producer's test asserts it emits every fixture field; each consumer's test (edge, Orochia's client, the SDK) asserts its
  parser accepts the fixtures and ignores what it does not know. This is what the integrations post called "the comparison
  test I have not written yet". (Slice 7.)
- **Within `/api/v1` only additive change**: new optional fields, new endpoints, enum values documented as open sets. A
  consumer ignores unknown fields — which is how this ADR's own change to the exchange response ships safely.
- **Breaking change** means `/api/v2` served beside v1 for at least six months, with `Deprecation` and `Sunset` headers on v1.
- **Studios are versioned apart** (semver, pinned per installation, ADR-034); the *app-config* contract of the mobile and
  desktop clients (minimum version, forced update) is #187's and follows the same rule.
- **Errors have one shape** (RFC 9457 problem details, stable `code`s). The Studio service's ad-hoc `{status, message}`
  bodies move to it with the OpenAPI work.

### 3. Capacity: an SLO per endpoint class

Declared before the first measurement; they are the thresholds of `tests/load/lib/slo.js`. Latencies are client-side,
through the edge, over the Internet unless said otherwise.

| Class | Indicator | SLO | Why this number |
|:---|:---|:---|:---|
| **Sync API** (catalogue, profile, run read, embeddings) | p95 latency; error rate | **p95 < 300 ms; errors < 1 %** | a page of the web client issues several; the saga adds only ~30 ms (M0) |
| **Sign-in** | p95 | **< 800 ms** | bcrypt is slow on purpose |
| **Run start** (`POST …/runs` → 202) | p95 | **< 1 s** | validate, hold credits (HTTP to billing), persist, dispatch; the answer is never the result |
| **Run to result** | per Studio | *reported, not a platform SLO* | a lease check is seconds, a video is minutes; the Studio's own measured ETA is the contract |
| **Chat** | time to the first token, p95 | **< 2 s** | the user is waiting to see something; the whole answer is the model's business |
| **Availability** of the edge | monthly | 99.5 % *target, not yet measured* | one container in dev; a number needs a monitor first (#12) |

### 4. Capacity: the model

The load has three different bottlenecks, and mixing them is how capacity plans go wrong.

1. **GPU jobs are queue-bound.** Throughput = workers × 3 600 ÷ seconds-per-job, whatever the API does. From the measured
   runs (ADR-077/078): a 5 s clip on the 5B model ≈ 175 s on an H100 → **~20 clips/h per worker**; an A14B 720p clip
   ≈ 1 111 s → **~3 clips/h per worker**. RabbitMQ holds the backlog (queue length 1 000, `rejectPublish`; prefetch 1 so a
   worker takes one job at a time). More throughput is more workers, i.e. RunPod/DO hours, not API capacity. The API's job
   is to *not accept what the queue cannot serve in a time the user would accept* (§5).
2. **The CPU API is bound by instance size and by database connections.** Dev runs the seven JVMs and a worker in one
   2 GB container (`basic-s`, 1.3 GB resident at idle); the cluster has **22 usable connections**, 21 of them budgeted
   (users 2, studio 2, billing 3, conversation+jobs 3, …). A transaction pool must hold a connection for a whole
   transaction **including the calls it makes to other services**, so a run start occupies 1 of the studio's 2
   connections while billing answers the hold. **Little's law**: maximum starts per second ≈ pool size ÷ transaction time
   ≈ 2 ÷ 0.4 s ≈ **5 run starts/s on dev**, whatever the CPU. That is a *prediction* from the measured start time; §6
   says what proves it.
3. **The edge is not the constraint.** Alone, behind a stub, with a 256 MB heap and serial GC on a laptop already at load
   average ~20, it carried **1 600 requests/s with p95 55 ms and no failure** (§6). The cost it *adds* to a service-key
   call is one identity round trip (the uncached exchange): **+14 ms at the median** on dev (163 ms against 148 ms with a
   JWT).

### 5. Backpressure and admission control

Order of defence, outermost first; each refusal says *when to come back*.

1. **Per-tenant rate limit at the edge** (shipped, slice 1). A token bucket per service key whose size is the owner's
   `rate_limits.requests_per_minute` — a database row the operator edits, sent by the identity service with each key
   exchange, so a change applies on the next call and the edge holds no copy. **429 + `Retry-After`** (whole seconds to the
   next token) and `RateLimit-Limit` / `RateLimit-Remaining` on every answer. A refused call reaches no backend and spends
   no daily quota. Rolled out like billing's `DRY_RUN`: `ABUSE_RATE_LIMIT_MODE` = `observe` (default) → `enforce`.
2. **Daily quota per key** (exists). Now also answers `Retry-After` (seconds to 00:00 UTC).
3. **Concurrency per actor** (exists, `run.max-concurrent-per-actor`, a row). To answer **429 + `Retry-After`** (estimated
   from the actor's oldest running run) instead of a bare 409 — slice 2.
4. **Queue-depth admission** (slice 5): before accepting a GPU run, estimate `queue depth × seconds-per-job ÷ workers` and
   refuse with 429/503 + `Retry-After` beyond the tier's accepted wait, instead of a deep queue nobody wants; the broker's
   `rejectPublish` becomes the backstop and its outcome a defined 503, not an accident.
5. **Timeouts and circuit breakers to providers** (slice 5): per-provider timeout and breaker (Resilience4j, the dependency
   `ProviderMetrics` already pretends to use), so a failing provider is skipped by the router rather than waited on.
6. **Idempotency keys on run start** (shipped, slice 1): `Idempotency-Key` makes a retry safe, so clients can retry
   *aggressively* after a 429/5xx without duplicating paid work.

**Idempotency key semantics** — per actor; same key + same request → the same run (202, `Idempotent-Replayed: true`); same
key + another request → 422 `idempotency_key_reused`; a failed start records nothing; parallel duplicates take turns
(advisory lock) with a unique index as the backstop; the key lives and dies with the run row.

### 6. Proof: the load tests

**Tool: k6** (Go binary, JavaScript scripts, thresholds that fail the run, `constant-arrival-rate` executors that model
*arrivals* rather than a fixed crowd). Gatling would fit a JVM team; here the clients are HTTP and JavaScript, the suite
lives in this repository next to the contract, and one 20 MB binary runs in CI. SSE time-to-first-token needs a streaming
reader k6 does not have, so one small Node script (`chat-ttft.mjs`) does that.

```
tests/load/
  orazaka.js        scenarios: sync API · login · run start + replay + poll · thresholds = the SLO table
  edge-contract.js  rate limit (429, Retry-After), Idempotency-Key through the edge, bad key, SSE relay
  chat-ttft.mjs     time to first token, paced, against any stack
  stub-stack.mjs    identity + studio + chat stand-ins, to measure the edge alone
  lib/              slo.js (the table), env.js, auth.js
```

| Where | Command | Rate | When |
|:---|:---|:---|:---|
| **CI, edge PRs** (`load-smoke.yml`, called by orazaka-edge) | `edge-contract.js` then `orazaka.js` `PROFILE=smoke` against the edge built from the PR with the stub behind it | 10 req/s for 30 s | every pull request touching the edge; also weekly on `main` |
| **Local full stack** | `PROFILE=load`, compose, **under `heavy-lock.sh`** | ramps to 100+ req/s | before a release, and nightly or weekly on the Mac when it is idle |
| **Dev** | `PROFILE=dev` | **≤ 5 req/s total**, off-peak, announced in `orchestration.md`, QA user, no GPU | after a deploy that changes the edge or a service; never a stress |

Dev is shared and small: the suite there is a *check that the SLOs hold at a few requests a second*, not a way to find the
ceiling. The ceiling is found locally and, for the cost side, by the model in §4.

#### Measured, 2026-10-17/18 (first results)

**A. The edge alone** — `orazaka-edge` 1.0.0-SNAPSHOT (256 MB heap, serial GC, virtual threads) behind `stub-stack.mjs`
(5–8 ms of think time, a 3 ms exchange), k6 and the stub on the same Mac at load average 18–24 (other sessions running),
`USE_API_KEY=1` so every request pays the key exchange. Sync scenario (two GETs per iteration), 20 s per step:

| Iterations/s | Requests/s | p50 | p95 | p99 | Failures |
|---:|---:|---:|---:|---:|---:|
| 100 | 200 | 14.5 ms | 47 ms | 62 ms | 0 / 4 000 |
| 200 | 400 | 13.2 ms | 59 ms | 85 ms | 0 / 8 000 |
| 400 | 790 | 12.9 ms | 66 ms | 110 ms | 0 / 16 000 |
| 800 | 1 590 | 12.5 ms | 55 ms | 117 ms | 0 / 32 000 |

The ceiling was **not reached**: the client, the stub and other sessions shared the CPUs. What it shows is that the edge is
not where capacity runs out at any rate a Krizaka product will send in the next year.

**B. The real dev stack** (`dev.orazaka.com/edge`, one 2 GB `core` container, the shared 1-vCPU database cluster), from a
Mac in Montréal, Saturday night, QA user, 60 s per pass, **≈ 4.3 requests/s** (2.1 iterations/s of sync + 0.1 login/s +
0.1 run/s), 0 errors, 264 and 262 checks passed:

| Indicator (SLO) | Session JWT | Service key (`oz_`, exchange on each call) |
|:---|---:|---:|
| Sync API p50 / **p95** (< 300 ms) | 148 / **246 ms** | 163 / **266 ms** |
| Sign-in p50 / **p95** (< 800 ms) | 315 / **431 ms** | 327 / **422 ms** |
| Run start p50 / **p95** (< 1 s) | 445 / **529 ms** | 455 / **637 ms** |
| Run to result, lease check (reported) | 4.2 s mean | 4.5 s mean |

Floor of the network: the fastest request in the run took 86 ms (Montréal → DigitalOcean Toronto → the container and
back), so more than half of every sync call is the Internet and the BFF hop, not Orazaka.

**C. Chat time to first token** (`chat-ttft.mjs`, DigitalOcean inference `mistral-3-14B`, 6 turns 10 s apart): **p50 445 ms,
p95 559 ms** (SLO < 2 s); the whole one-word answer p50 885 ms. Too few samples to state a tail; enough to say the SLO is not
at risk.

#### First bottleneck — said honestly

Nothing saturated at 4 requests/s, so **no bottleneck was observed**; the dev stack was deliberately not pushed. What the
measurements and the code say *will* be first, in order:

1. **The database connection budget**, not CPU: 21 of 22 connections are budgeted, the studio and users pools hold **2**
   each, and a run start holds one studio connection while billing answers. Predicted ceiling ≈ **5 run starts/s** on dev;
   the key exchange rides the users pool of 2. Scaling the core horizontally *multiplies* these pools — which the cluster
   cannot afford (§7). Falsifiable: a local run at 5+ starts/s should show `query_wait_timeout` in the studio pool before
   CPU saturates.
2. **The core container's CPU/RAM** (seven JVMs in 2 GB, 1.3 GB resident at idle): the reason for #215 (basic-m, +$20/month,
   awaiting Oussama).
3. **The GPU workers** for anything that generates (§4.1): 3–20 jobs/h per worker.
4. **A leak under time, not load**: orazaka-conversation-service#10 (pool saturates over time) will present as latency
   creeping up in a long run — which is why the weekly run is long enough to see it.

### 7. Scaling options on DigitalOcean App Platform, and what they cost

| Option | What it buys | Cost (list price, to confirm at order) | Blocked by |
|:---|:---|:---|:---|
| **Resize `core`** `basic-s` → `basic-m` | CPU/RAM for seven JVMs | **+$20/month** (#215, needs Oussama) | — |
| **Split the edge** into its own app | scale the stateless part alone; 96 MB heap today | ~$5/month for the smallest container | a shared limiter store (slice 3); the in-memory daily quota and rate buckets are per instance |
| **Scale `core` to 2 instances** | CPU, rolling deploys without a gap | doubles the container ($20 → $40) | **the connection budget** (pools double: 21 → ~38 of 22), the in-memory SSE emitter registry (`JobStreamService` is per-instance, so a job event reaches only the instance that consumed it), in-memory counters |
| **Bigger database plan** | connections and IOPS | 1 vCPU/1 GB ($15, today) → 2 vCPU/4 GB (~$60) | decision; PgBouncer pools (#214) first |
| **More GPU workers** | the only way to more generation throughput | $0.76–1.57/h droplet, ≈ $4/h H100 pod, guarded (ADR-078) | spend caps set by the orchestrator |
| **Redis** | a shared limiter and SSE fan-out | App Platform dev DB or a $15 managed Valkey | needed only at the second edge instance (slice 3) |

Nothing here is bought by this ADR. No paid resource above $5/month is created without Oussama.

## Consequences

- Retrying a run start is safe; products can retry on 429/5xx. The edge answers a looping product within a minute instead
  of a day, and tells it when to return. Both are additive: no client has to change to benefit, and none breaks.
- The rate limit ships in `observe` mode on purpose: the service accounts of the products are on the `free` tier (60/min)
  today and would be throttled by an immediate `enforce` (Orochia's seeding alone polled ~360 jobs a pass). Slice 2 moves
  service accounts to a fitting tier and flips dev to `enforce`.
- The in-memory limiter is per edge instance. One edge today; a second edge needs the shared store before it ships.
- A new weekly CI run and a PR check on the edge: a few minutes of runner time, no cost.
- Progress is still polling until slice 4 lands. That is accepted for now and tracked, not hidden.

## Refused

- **WebSocket** for chat and voice; **gRPC** now; an **externally exposed broker** on the hosted platform; a **hand-written
  SDK**; a **second limiter implementation** next to bucket4j without a reason (slice 3 may reuse bucket4j + Redis as the
  conversation service does).
- **Enforcing at once.** An unobserved limit on live service accounts is an outage waiting for its first busy hour.
- **Load-testing dev to find its ceiling.** It is shared; the answer comes from a local stack and the model.

## Slices

| # | Slice | State |
|:--|:---|:---|
| 1 | Idempotency key on run start ([orazaka-studio#20](https://github.com/krizaka/orazaka-studio/pull/20)); per-key rate limit, observe mode ([orazaka-edge#22](https://github.com/krizaka/orazaka-edge/pull/22), [krizaka-users#34](https://github.com/krizaka/krizaka-users/pull/34)); k6 suite + CI smoke (this PR) | **shipped** |
| 2 | Service accounts on a fitting tier, dev to `enforce`, Retry-After on the concurrency cap | issue |
| 3 | Shared limiter store for more than one edge | issue (later) |
| 4 | **#189**: SSE run events (`/runs/{id}/events`, per-key stream, `Last-Event-ID`, heartbeat) then signed webhooks | issue, first slice next |
| 5 | Admission control by queue depth; provider circuit breakers; a defined answer to `rejectPublish` | issue |
| 6 | Generated TypeScript and Java SDKs | issue |
| 7 | OpenAPI as the source of truth + the contract-fixture test across repositories | issue |
| 8 | MCP server exposure | issue (later) |
| 9 | Local full-stack load run (`PROFILE=load`) and the nightly/weekly schedule; the bottleneck prediction of §6 confirmed or corrected | issue (needs the Docker stack and the heavy lock) |
| 10 | SSE resume and fan-out: stable event ids, `Last-Event-ID`, per-instance registry (conversation-service#19) | issue |
