---
title: "Run Orazaka on your own infrastructure"
description: "Install Orazaka on a Mac or on a Linux server with an NVIDIA GPU, open it, update it, back it up and remove it — your data never leaves your machine."
category: Guides
order: 1
---

# Run Orazaka on your own infrastructure

Orazaka runs entirely on hardware you own: your documents, prompts and results stay on your machine,
nothing is sent to Krizaka (no telemetry), and once the models are downloaded it works offline.

> **Where this stands.** The packaged installers below — Orazaka Desktop for Mac and the one-command
> server install — are **under construction** (tracked in
> [the delivery epic](https://github.com/krizaka/orazaka/issues/75); design in [DELIVERY.md](DELIVERY.md)).
> Each command is marked: **available** works today, **1.0** arrives with the first release.
> Until then, the [developer install](#today-the-developer-install) runs the same platform from source.

## Requirements

| | Mac | Linux server |
|---|---|---|
| Machine | Apple Silicon (M1 or later) | x86-64 or arm64 |
| OS | macOS 14 or later | Ubuntu 24.04 LTS, Debian 12 or RHEL 9 |
| Memory | 16 GB minimum, 32 GB recommended | 32 GB recommended |
| Disk | 150 GB free (platform + models) | 150 GB free; more for video models (≈ 35 GB each) |
| GPU | the Mac's own (Metal) | optional: NVIDIA, 20 GB VRAM or more, driver ≥ 570, NVIDIA Container Toolkit; without one, text, documents and small images only |
| Also | FileVault on (checked) | Docker Engine 27+ with the compose plugin; disk encryption (LUKS) recommended |

## On a Mac — 3 steps (1.0)

1. **Download Orazaka Desktop** (`Orazaka.dmg`, signed and notarized by Apple) and drag it into
   Applications — or, in a terminal, `npx orazaka install`.
2. **Open it.** It checks your Mac, downloads the models once (with progress), and starts Orazaka.
3. **Open <http://localhost:3000>.** On the first run you create the administrator account; sign-up
   stays closed, you invite your colleagues.

## On a Linux server with an NVIDIA GPU — 3 steps (1.0)

1. **Install, one command:**
   ```bash
   curl -fsSL https://dev.orazaka.com/install.sh | sh     # or: npx orazaka install --server
   ```
   It checks the server (OS, Docker, GPU driver, disk), verifies the signature of every image, generates
   every secret into `/etc/orazaka` (no default password), and starts Orazaka as a systemd service.
2. **Open `https://<server>`** from your network (TLS on the LAN; only the web entry point is exposed).
3. **Create the administrator account** on the first run.

No Internet on the server? Ask for the offline kit (images and models on a disk) and run
`sudo ./orazaka install --server` from it.

## Living with it (1.0)

| Task | Command (Desktop: the matching button) |
|---|---|
| Check health | `orazaka doctor` |
| Update | `orazaka update` — verifies the release signature and backs up first; nothing ever updates by itself |
| Undo an update | `orazaka rollback` — returns to the previous version **and** to the backup taken before the update |
| Back up | `orazaka backup [--to <path>]` — nightly by default; keep the exported key apart from the backups |
| Restore | `orazaka restore <archive>` |
| Get help | `orazaka doctor --bundle` writes a support file **on your machine**; read it, then send it if you wish — it holds no document, prompt or password |
| Uninstall | `orazaka uninstall` — stops and removes Orazaka; `--purge` also deletes data and models (take a backup first) |

## Today: the developer install

**Available** now, from source — the same platform, for evaluation and development
(requires git, JDK 21, Node.js 22+, Docker, Python 3.11+ for the media worker):

```bash
npx orazaka install                 # checks your tools, clones the platform into ./orazaka, configures it
cd orazaka && ./mvnw install && (cd orazaka-apps/ui && npm install)
npx orazaka start                   # PostgreSQL + pgvector, Redis, RabbitMQ, the local AI engines
npx orazaka dev                     # the services, the web app (http://localhost:3000) and the admin (:3001)
```

`npx orazaka doctor` checks the machine and the running services; `npx orazaka stop` stops everything
(`--purge` also removes the data). Verify a release bundle before installing it with
`npx orazaka release verify orazaka-release.json --dir <bundle>`.

## Security

Secrets are generated on your machine, services listen on localhost except the web entry point,
containers run as non-root, images are signed and scanned. To report a vulnerability, see
[SECURITY.md](https://github.com/krizaka/orazaka/blob/main/SECURITY.md).
