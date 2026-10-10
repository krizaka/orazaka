---
title: CLI Reference
description: orazaka CLI commands and options, extracted from the command definitions.
category: DevEx
order: 7
generated: true
---

# CLI Reference

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.

## Local dev workflow

The dev loop has two layers — start them in order:

1. **Infrastructure** — `orazaka start --mode dev` brings up the Docker middleware
   (PostgreSQL+pgvector, Redis, RabbitMQ) and the native AI engines (Ollama, LocalAI,
   video worker). Inference runs natively on macOS Metal — never in Docker.
2. **Applications** — `orazaka dev` spawns the Router (Spring Boot), Web client, Web admin
   and the Expo mobile server in parallel. Prefer to debug the backend in your IDE? Run
   `RouterApplication` from IntelliJ and start the rest with `orazaka dev --skip-router`.

`orazaka start --mode full` additionally builds/runs the Router JAR and the UI for a
hands-off boot. Tear everything down with `orazaka stop`.

> ℹ️ `start` manages *infrastructure*; `dev` manages *application processes*. They are
> complementary, not alternatives.

## Commands

| Command | Description |
|:---|:---|
| `orazaka agent` | Manage Orazaka local executing agent |
| `orazaka build` | Regenerate docs/_generated/ from the code |
| `orazaka chat` | Execute interactive REPL or single-shot chat |
| `orazaka config` | Interactive configuration wizard — review and update .env variables |
| `orazaka db` | Database maintenance operations |
| `orazaka demo` | Demonstration persona on the local stack (never on a deployed one) |
| `orazaka dev` | Launch the full Orazaka application stack in parallel (9 services + Web, Admin, Mobile) |
| `orazaka docs` | Code-driven documentation: build (generate) \| sync (to the site) |
| `orazaka doctor` | Advanced system health check with automatic recovery suggestions |
| `orazaka forgot` | Request a password reset token via email |
| `orazaka generate` | Generate features, interceptors, connectors, and configurations |
| `orazaka graph` | Display Operation Graph capability matrix |
| `orazaka init` | Initialize workspace — detects existing projects, validates config, and fixes gaps |
| `orazaka install` | Setup wizard — verify tools, install dependencies, and configure deployment topology |
| `orazaka installed` | List the Studios you have installed |
| `orazaka list` | List the bundles this deployment's pack sources offer |
| `orazaka listen` | Start CLI agent listener and reverse tunnel |
| `orazaka login` | Authenticate and cache JWT token |
| `orazaka logs` | Stream and browse service logs |
| `orazaka mcp` | Manage your private dynamic MCP server connections |
| `orazaka models` | Scan the host hardware and report which catalog models it can run |
| `orazaka onboard` | Full clone-and-run onboarding: verify prerequisites, compile, smoke-test M2M handshake, and probe local AI runtimes |
| `orazaka pack` | Validate, install and publish pack bundles |
| `orazaka profile` | Display authenticated user profile information |
| `orazaka publish` | Put an installed bundle's pack and Studios on the shelf |
| `orazaka recover` | Diagnose and recover from common issues |
| `orazaka register` | Register a new user account |
| `orazaka reset` | Reset account password using a valid reset token |
| `orazaka run` | Run an installed Studio |
| `orazaka settings` | Manage user settings and preferences |
| `orazaka start` | Start Orazaka infrastructure — dev mode (Docker middleware + AI engines) or full mode (also Router + UI) |
| `orazaka status` | Show live status of all Orazaka services |
| `orazaka stop` | Teardown the Orazaka infrastructure — containers, workers, and state |
| `orazaka studio` | Browse, install and run installable business workflows |
| `orazaka sync` | Copy docs/ (+ generated) into the Krizaka site content tree |
| `orazaka test` | Run the test pyramid: unit \| it (Testcontainers) \| e2e (hermetic) |
| `orazaka validate` | Check a bundle's manifest, and whether this platform can run it |
| `orazaka verify` | Verify account registration token |
| `orazaka video` | Generate video from a text prompt |

## Options

### `orazaka build`

Regenerate docs/_generated/ from the code

| Option | Description |
|:---|:---|
| `--check` | Fail if any generated doc is stale (build gate), without writing |

### `orazaka chat`

Execute interactive REPL or single-shot chat

| Option | Description |
|:---|:---|
| `-t, --text` | Force text chat mode |
| `-i, --image <path>` | Analyze a poster image |
| `-a, --audio <path>` | Analyze an audio clip |
| `-g, --gen-image` | Generate an image |
| `-s, --speech` | Convert text to speech |
| `-m, --model <model>` | Specify AI model name |
| `-v, --voice <voice>` | Specify voice name |
| `-o, --save <path>` | Specific file path to save output media |

### `orazaka config`

Interactive configuration wizard — review and update .env variables

| Option | Description |
|:---|:---|
| `-l, --list` | List all current configuration values |
| `-c, --category <name>` | Jump directly to a specific category |

### `orazaka db`

Database maintenance operations

| Option | Description |
|:---|:---|
| `-y, --yes` | Skip the destructive-action confirmation prompt |

### `orazaka demo`

Demonstration persona on the local stack (never on a deployed one)

| Option | Description |
|:---|:---|
| `--fresh` | Delete Eric's conversations first, for a demo that starts from a clean history |

### `orazaka dev`

Launch the full Orazaka application stack in parallel (9 services + Web, Admin, Mobile)

| Option | Description |
|:---|:---|
| `--only <services>` | Launch only these services (comma-separated: edge,router,identity,automation,knowledge,job,billing,studio,notifications,web,admin,mobile) |
| `--skip-edge` | Skip the Edge gateway (strangler facade on :8088) |
| `--skip-identity` | Skip the Identity service (:8083) |
| `--skip-router` | Skip the Router (Spring Boot) backend — run RouterApplication from your IDE instead |
| `--skip-core` | Deprecated alias for --skip-router |
| `--skip-automation` | Skip the Automation service (AMQP on :8082) |
| `--skip-knowledge` | Skip the Knowledge service (:8084) |
| `--skip-job` | Skip the Job Orchestration service (:8090) |
| `--skip-billing` | Skip the Billing service (:8095) |
| `--skip-studio` | Skip the Studio service (:8096) |
| `--skip-notifications` | Skip the Notification service (:8097) |
| `--skip-admin` | Skip Admin console |
| `--skip-mobile` | Skip Expo mobile server |
| `--skip-web` | Skip Web client |
| `--skip-workers` | Skip the Python workers declared by worker.yaml |

### `orazaka doctor`

Advanced system health check with automatic recovery suggestions

| Option | Description |
|:---|:---|
| `-q, --quiet` | Only show issues, suppress passing checks |
| `--fix` | Attempt to auto-fix detected issues |
| `-v, --verbose` | Show detailed diagnostic output |

### `orazaka init`

Initialize workspace — detects existing projects, validates config, and fixes gaps

| Option | Description |
|:---|:---|
| `-f, --force` | Overwrite existing configuration |
| `-y, --yes` | Non-interactive mode with defaults |
| `--skip-validation` | Skip diagnostic checks |
| `--dir <path>` | Target directory (default: current directory) |

### `orazaka install`

Setup wizard — verify tools, install dependencies, and configure deployment topology

| Option | Description |
|:---|:---|
| `--check-only` | Read-only: verify tool availability & versions, then exit (no .env / compose changes) |
| `-y, --yes` | Non-interactive mode — skip install prompts |

### `orazaka logs`

Stream and browse service logs

| Option | Description |
|:---|:---|
| `--service <name>` | Tail a specific service (router, ollama, media-worker, image-worker, ui) |
| `--list` | List all available log files with sizes |
| `--since <duration>` | Show logs from last N hours (e.g., 1h, 30m) |
| `--tail <lines>` | Number of lines to show from end of file |

### `orazaka mcp`

Manage your private dynamic MCP server connections

| Option | Description |
|:---|:---|
| `--auth-token <token>` | Optional authorization token/header |

### `orazaka register`

Register a new user account

| Option | Description |
|:---|:---|
| `-l, --language <lang>` | BCP 47 language tag (e.g. en, ja) |

### `orazaka run`

Run an installed Studio

| Option | Description |
|:---|:---|
| `-i, --inputs <pairs>` | Inputs as key=value,key2=a\|b\|c (pipes make a list) |

### `orazaka start`

Start Orazaka infrastructure — dev mode (Docker middleware + AI engines) or full mode (also Router + UI)

| Option | Description |
|:---|:---|
| `--mode <mode>` | Startup mode: dev (default, infra + AI engines) or full (also Router + Next.js UI) |
| `--only <service>` | Start only a specific service (postgres, redis, rabbitmq, ollama, localai, image-gen, media-worker) |
| `--skip-health` | Skip final health verification |
| `--wait-timeout <ms>` | Timeout for service startup (default: 60000ms) |
| `--allow-partial` | Allow partial startup (some services may fail) |
| `--verbose` | Show detailed startup logs |
| `--logs` | Tail log files after startup |

### `orazaka status`

Show live status of all Orazaka services

| Option | Description |
|:---|:---|
| `--json` | Output status as JSON |
| `--watch` | Refresh every 5 seconds |

### `orazaka stop`

Teardown the Orazaka infrastructure — containers, workers, and state

| Option | Description |
|:---|:---|
| `--purge` | Also purge database data and upload directories |
| `-y, --yes` | Skip confirmation prompts |

### `orazaka validate`

Check a bundle's manifest, and whether this platform can run it

| Option | Description |
|:---|:---|
| `--offline` | Check the manifest's shape only, without asking the platform |

### `orazaka video`

Generate video from a text prompt

| Option | Description |
|:---|:---|
| `-d, --duration <seconds>` | Duration of the video in seconds |
| `-m, --model <model>` | Specify AI model name |
| `-o, --output <path>` | Specific file path to save the video |
