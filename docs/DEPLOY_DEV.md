# Orazaka in dev — dev.orazaka.com and admin.orazaka.com

The development environment runs on DigitalOcean App Platform, project `orazaka`, Toronto, as cheaply as the platform
allows (decision 2026-10-14: everything Orazaka in dev ≤ $80/month; a GPU never stays on). Sign-in is open; sign-up is
closed everywhere — the fronts hide it and the users service answers **403** (`AUTH_SIGNUP_ENABLED=false`).

## What runs

| App (DO) | Component | What | Size | $/month |
|---|---|---|---|---|
| `orazaka-dev` | `web` | `krizaka/orazaka-web-client` (Next.js + BFF), `dev.orazaka.com/` | `apps-s-1vcpu-0.5gb` | 5 |
| `orazaka-dev` | `core` | one image, five JVMs (below), public only as `dev.orazaka.com/edge` | `basic-s` (2 GB) | 20 |
| `orazaka-dev` | `rabbitmq` | `rabbitmq:4.2-alpine`, internal (`rabbitmq:5672`), no volume | `apps-s-1vcpu-0.5gb` | 5 |
| `orazaka-admin-dev` | `web` | `krizaka/orazaka-web-admin`, `admin.orazaka.com`, BFF → `https://dev.orazaka.com/edge` | `apps-s-1vcpu-0.5gb` | 5 |
| — | databases | the shared cluster `krizaka-dev-pg` (PostgreSQL 18, project `krizaka`, docs/DEV_DATABASE.md) | — | (15, shared) |
| — | chat | DigitalOcean serverless inference, `mistral-3-14B`, per token | — | ≈ 0 at test volume |
| — | images | `scripts/gpu-dev.sh` — only while started | `gpu-4000adax1-20gb` | 0.76 **per hour** |

**Total: $35/month** for Orazaka's own resources (+ its share of the $15 cluster, + tokens). Upgrading `core` to
`basic-m` (4 GB, 2 vCPU, $40) is the first lever if it restarts under load: still $55.

### The `core` container

`infra/deploy/Dockerfile` clones every repository of `orazaka.workspace.json` (as CI does), builds the five services
without tests, and `infra/deploy/run-services.sh` starts them side by side; the first JVM to exit takes the container
down so App Platform restarts the set.

| Service | Port | Heap | Database | Why it is here |
|---|---|---|---|---|
| `krizaka-users-service` | 8083 | 160 MiB | `krizaka_users_db` | sign-in, JWT, profile — sign-up closed |
| `orazaka-job-service` | 8090 | 256 MiB | `orazaka_db` | capability registry, text jobs of Studio runs |
| `orazaka-conversation-service` | 8080 | 320 MiB | `orazaka_db` | chat (SSE), models, bootstrap features |
| `orazaka-studio-service` | 8096 | 160 MiB | `orazaka_studio_db` | Studios, packs (installed at boot), runs |
| `orazaka-edge` | **8088** | 96 MiB | — | the only routed port: `/` → conversation, `/api/v1/auth…` → users, `/api/v1/studios` → studio |

Measured on 2026-10-14 against the cluster (five JVMs, serial GC, C1 only, virtual threads): **1.3 GB resident**
idle and after a round of sign-ins and Studio listings — the reason for a 2 GB container.

**Not deployed** (and why): billing (`BILLING_ENABLED=false`: nothing is sold in dev — PAID Studios show as locked),
knowledge (chat degrades without RAG), automation (connectors), notifications (no e-mail in dev: no password reset),
worker-media (Metal/MLX — Mac only), Redis (only for `orazaka.identity.rate-limit.enabled`, off).

## Deploy

Secrets never enter the repository: `~/Documents/krizaka/orazaka-dev.env` (mode 600) holds the database role
passwords (`DATABASE_PASSWORD_<DB>`, read with `doctl databases user get`), `IDENTITY_JWT_SECRET`, `CRYPTO_KEY`,
`CRYPTO_SALT` (16 hex), `MEDIA_ENCRYPTION_KEY` (32 bytes, base64 — the asset keyring), `RABBITMQ_PASS`,
`NEXTAUTH_SECRET_WEB`, `NEXTAUTH_SECRET_ADMIN` and `AI_INFERENCE_KEY` (a **model access key**, created in the control
panel: Agent Platform → Serverless Inference → Model Access Keys — the API no longer creates them).

```bash
node scripts/dev-deploy.mjs apply orazaka-dev --dry-run   # render + validate, nothing sent
node scripts/dev-deploy.mjs apply orazaka-dev             # SECRET values are stored encrypted by App Platform
node scripts/dev-deploy.mjs apply orazaka-admin-dev
node scripts/dev-deploy.mjs data                          # infra/deploy/dev-data.sql: providers + chat default
node scripts/dev-deploy.mjs seed                          # test accounts → company/QA.md only
node scripts/dev-deploy.mjs status
```

`web` and the admin redeploy on every push to their `main`. `core` does not (it is built from many repositories):

```bash
doctl apps create-deployment <orazaka-dev id> --force-rebuild   # --force-rebuild, or the clone layer is cached
```

Logs: `doctl apps logs <id> core --type run` (each line prefixed by its service: `[users]`, `[conversation]`…).

## Routing is data

`infra/deploy/dev-data.sql` (idempotent) points the providers of this environment: `do-inference`
(`https://inference.do-ai.run`, OpenAI-compatible, the key from the secrets file) as the chat default with
`mistral-3-14B`; `localai-image` at `http://gpu-dev.orazaka.com:8086/v1`. Change a model or a provider in the admin
console or in that file — never in a service's configuration.

## GPU (images) — billed by the hour, never left on

```bash
scripts/gpu-dev.sh start    # RTX 4000 Ada droplet (≈ $0.76/hour), LocalAI (CUDA) on :8086, gpu-dev.orazaka.com → it
scripts/gpu-dev.sh status   # running since when, cost so far
scripts/gpu-dev.sh stop     # destroy — billing stops
```

While it is off, the image capability is greyed out (degraded mode, `InfrastructureProber`). The first start is
Oussama's decision. The droplet serves `v1-5-pruned-emaonly` (Stable Diffusion 1.5, diffusers) under the name the
catalogue already uses; `GPU_SIZE`, `GPU_REGION`, `GPU_IMAGE_MODEL_*` override the defaults.

## What works in dev

| Feature | Dev | Why |
|---|---|---|
| Sign-in (web, admin) | yes | admin needs `ROLE_ADMIN` |
| Sign-up | **no** — 403 | closed on purpose |
| Chat | yes, once `AI_INFERENCE_KEY` is set | serverless inference |
| Studios list, Prospecting runs (text only) | yes | chat capability |
| Trades showcase, Media production | partly | image/vision need the GPU or the Mac's worker |
| Document validation, real-estate reels | locked | PAID Studios, billing off; document screening runs on the Mac worker |
| E-mails (verify, reset) | no | notifications not deployed |
