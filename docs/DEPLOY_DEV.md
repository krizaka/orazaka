# Orazaka in dev — dev.orazaka.com and admin.orazaka.com

The development environment runs on DigitalOcean App Platform, project `orazaka`, Toronto, as cheaply as the platform
allows (decision 2026-10-14: everything Orazaka in dev ≤ $80/month; a GPU never stays on). Sign-in is open; sign-up is
closed everywhere — the fronts hide it and the users service answers **403** (`AUTH_SIGNUP_ENABLED=false`).

## What runs

| App (DO) | Component | What | Size | $/month |
|---|---|---|---|---|
| `orazaka-dev` | `web` | `krizaka/orazaka-web-client` (Next.js + BFF), `dev.orazaka.com/` | `apps-s-1vcpu-0.5gb` | 5 |
| `orazaka-dev` | `core` | one image, five JVMs (below), public only as `dev.orazaka.com/edge` | `basic-s` (2 GB) | 20 |
| Droplet | `orazaka-broker-dev` | RabbitMQ 4.2, **TLS only** (5671), bound to its private IP, cloud firewall: VPC `10.118.0.0/20` only | `s-1vcpu-512mb-10gb` | 4 |
| `orazaka-admin-dev` | `web` | `krizaka/orazaka-web-admin`, `admin.orazaka.com`, BFF → `https://dev.orazaka.com/edge` | `apps-s-1vcpu-0.5gb` | 5 |
| — | databases | the shared cluster `krizaka-dev-pg` (PostgreSQL 18, project `krizaka`, docs/DEV_DATABASE.md) | — | (15, shared) |
| — | chat | DigitalOcean serverless inference, `mistral-3-14B`, per token | — | ≈ 0 at test volume |
| `orazaka-dev` | `gpu-relay` | chisel server, `dev.orazaka.com/gpu-relay` — the GPU host dials out to it (§ GPU) | `apps-s-1vcpu-0.5gb` | 5 |
| — | images, 9:16 video | an hourly GPU droplet, only while started (`scripts/gpu-dev.sh`) | `small` / `big` | 0.76 / 1.57 **per hour** |
| — | model weights | Volume `orazaka-gpu-models-<region>`, 80 GB, kept between droplets | — | 8 |

**Total: $47/month** for Orazaka's own resources (+ its share of the $15 cluster, + tokens). Upgrading `core` to
`basic-m` (4 GB, 2 vCPU, $40) is the first lever if it restarts under load: still $54.

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

## Broker — reachable from the GPU workers, safely

App Platform cannot expose AMQP, and a GPU droplet must reach the job lanes — so RabbitMQ lives on its own small
Droplet in the `default-tor1` VPC (`node scripts/dev-deploy.mjs broker`, idempotent):

- **TLS only**: `listeners.tcp = none`, 5671 with a certificate for `broker-dev.orazaka.com` signed by a dev CA kept in
  `~/Documents/krizaka/orazaka-broker/` (the CA key never leaves it). Clients verify the host name; the services trust
  the CA through Spring's SSL bundle `broker` (`RABBITMQ_CA_CERT_BASE64` → `/app/var/broker-ca.pem`).
- **Private**: bound to the Droplet's private IP; `broker-dev.orazaka.com` resolves to it; the cloud firewall admits 5671
  from the VPC range only (SSH from the maintainer's IP). `orazaka-dev` joins the VPC (`vpc.id` in its spec).
- **Two users**, strong random passwords in the secrets file: `orazaka` (the platform, everything on `/`) and
  `gpu-worker` (`RABBITMQ_PASS_GPU`: configure/write/read on `orazaka.*` names only). A GPU droplet must be created in
  the same VPC (`--vpc-uuid` of `default-tor1`; another region needs VPC peering).
- No volume worth keeping: queues are re-declared by the services and workers at start (AGENTS.md §6).

## Routing is data

`infra/deploy/dev-data.sql` (idempotent) points the providers of this environment: `do-inference`
(`https://inference.do-ai.run`, OpenAI-compatible, the key from the secrets file) as the chat default with
`mistral-3-14B`; `localai-image` at `http://gpu-relay:8086/v1` and `localai-video` at `http://gpu-relay:8188` (the GPU
host, through the relay). Change a model or a provider in the admin
console or in that file — never in a service's configuration.

## GPU — images and 9:16 video, by the hour

Generation runs on a GPU droplet that exists only while it works (ADR-077). It runs the CUDA image of
`krizaka/orazaka-worker-media` (`ghcr.io/krizaka/orazaka-worker-media:cuda-latest`): **sd-server** with FLUX.2 [klein] 4B
for images, and the **media worker** draining `job.video.*` / `job.compose.*` with Wan for 9:16 video.

| Size | Droplet | $/hour | Video model (default) | 9:16 clip |
|---|---|---|---|---|
| `big` | NVIDIA L40S 48 GB (else RTX 6000 Ada 48 GB) | 1.57 | Wan 2.2 TI2V 5B | 704×1280, 5 s @ 24 fps |
| `small` | NVIDIA RTX 4000 Ada 20 GB | 0.76 | Wan 2.1 T2V 1.3B | 480×832, 5 s @ 16 fps |

```bash
scripts/gpu-dev.sh relay-secret          # once: the relay credential into the secrets file, then apply the app spec
scripts/gpu-dev.sh start big             # tor1 first, then nyc2, atl1, ams3 — wherever there is stock
scripts/gpu-dev.sh logs                  # setup and containers (ssh with a key made for it, SSH open to your IP only)
scripts/gpu-dev.sh status                # what runs, since when, what it has cost so far
scripts/gpu-dev.sh stop                  # destroy now — never a powered-off droplet, which still bills
scripts/gpu-dev.sh cost                  # every session (ledger in ~/Documents/krizaka): hours × rate, total
```

**How it connects — nothing is exposed.** The droplet opens no port (SSH from the caller's IP only). A chisel client
on it dials **out** to `https://dev.orazaka.com/gpu-relay` (App Platform's TLS, a 256-bit credential
`AI_GPU_RELAY_PASSWORD`) and may open exactly five remotes — the relay's allow-list: `broker-dev.orazaka.com:5671` (the TLS broker of the VPC, as the narrow `gpu-worker` user, verified end to end against the dev CA),
`core:8090` (the job service: worker registry and output hand-over), and back inside the app `gpu-relay:8086`
(sd-server), `gpu-relay:8188` (the video pipeline) and `gpu-relay:11434` (Ollama: `qwen2.5:7b` for the Studios'
text steps, `llava` for their photo steps — sovereign, Apache-2.0 / open weights, while the GPU runs). The broker stays VPC-only. While no GPU is connected nothing
listens on `gpu-relay:8086/8188`, which is exactly what greys the image and video capabilities out.

**Outputs.** The droplet keeps nothing: the worker hands each clip to the job service (`PUT
/internal/v1/jobs/{id}/output/{file}`, a `SERVICE` token minted by `gpu-dev.sh` from the identity secret — which never
leaves this machine — and expiring with the droplet), which seals it with the platform's key, adopts the job's row if a
Studio step left none, and serves it at `/api/v1/assets/{id}/video.mp4`.

**The image** is pulled from GHCR; while that package is private, the droplet builds it from the worker's public repository at its `main` commit (~20 min, once) and keeps it on the Volume (`/models/images`), so later starts load it in a minute. Making the package public (GitHub → Packages → orazaka-worker-media → visibility) removes the build.

**Weights** live on the Volume `orazaka-gpu-models-<region>` (80 GB, created on the first start in a region): Wan 2.2
5B 34 GB, Wan 2.1 1.3B 6 GB (its text encoder is the 5B's), FLUX.2 [klein] 8.7 GB. Fetched once, pinned (revisions,
SHA-256), then every start finds them in place.

**The watchdog** (`infra/gpu/watchdog.sh`, every minute, armed before anything else can fail) destroys the droplet
through the API after **30 min without a job** (a job start or end, an image request, the GPU busy), after
`GPU_MAX_HOURS` (8) whatever it does, or when setup has not finished after 90 min. It uses `GPU_WATCHDOG_DO_TOKEN`
from the secrets file when present — a token scoped to `droplet:read` + `droplet:delete`, to create in the control
panel — else the doctl token. Containers cannot read the droplet's metadata (and so its user-data).

### The Mac as the GPU (free)

The Mac's Metal worker can drain the same queue:

```bash
scripts/gpu-dev.sh mac                   # writes ~/.orazaka/gpu-dev/mac-worker.env (0600, 12 h)
# then the two commands it prints: a chisel client (brew install chisel) and the worker with that env
```

The worker hands its outputs to the dev job service the same way. Run one host at a time: two workers on one queue
share the jobs, and a Wan job reaching the Mac runs on Metal (slowly) or fails by name.

## What works in dev

| Feature | Dev | Why |
|---|---|---|
| Sign-in (web, admin) | yes | admin needs `ROLE_ADMIN` |
| Sign-up | **no** — 403 | closed on purpose |
| Chat | yes, once `AI_INFERENCE_KEY` is set | serverless inference |
| Studios list, Prospecting runs (text only) | yes | chat capability |
| Trades showcase, Media production, 9:16 video | while the GPU runs | `scripts/gpu-dev.sh start big` |
| Document validation, real-estate reels | locked | PAID Studios, billing off; document screening runs on the Mac worker |
| E-mails (verify, reset) | no | notifications not deployed |
