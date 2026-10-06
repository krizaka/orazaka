# Rule: Local Development (current phase)

> The whole cycle runs on the dev machine (macOS 64 GB). **No CI, no cloud deployment.** See `AGENTS.md` §0.

## §1 Execution boundary
- **Docker**: stateful infra only — PostgreSQL+pgvector, Redis, RabbitMQ (`infra/docker-compose.yml`). Postgres bootstrapped by the **`infra/initdb/` directory** (one file per bounded context, schema + tables + dev seed, applied alphabetically; cross-context FKs banned). `init-prod.sql` deferred.
- **Native macOS (Metal)**: AI runtimes — Ollama (`:11434`), stable-diffusion.cpp, worker-media MLX. **Never in Docker** (CPU fallback = destroyed DevX).
- **Apps**: native processes launched by `orazaka dev`.

## §2 Forbidden in the local phase
- Generating CI workflows (GitHub Actions, etc.), deployment manifests, remote `terraform apply`, or image pushes to a registry.
- Introducing an unsolicited network/cloud dependency.
- Touching git history: we stay on a single `init project` commit until lifted.

## §3 Dev loop
```bash
orazaka install      # detect HW/prereqs, generate .env (local)
orazaka start        # Docker infra + check native Ollama
orazaka models pull  # Ollama models
orazaka dev [--only] # spawn apps (color logs)
orazaka onboard      # validate clone-and-run
orazaka test [unit|it|e2e]
orazaka docs [build|sync]   # docs generation → Krizaka site, locally
```

## §4 IDE
- **IntelliJ**: Java/Maven backend (`.run/` to commit with `SPRING_PROFILES_ACTIVE=dev`).
- **VSCode**: TS frontends + Python worker (`.vscode/{launch,tasks,extensions}.json`).
- The `orazaka` CLI is the neutral orchestrator shared by both IDEs.

## §5 Config per profile
- `application-dev.yml` active locally. Inference pointing to **native** endpoints (`localhost:11434`, etc.) via the adapters of the `*GeneratorClient` ports. The same code stays promotable to staging/prod later (deferred).
