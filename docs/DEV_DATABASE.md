# The dev database (App Platform)

`orazaka-dev` (DigitalOcean App Platform, project `orazaka`) carries an **attached dev database** — `orazaka-db`,
PostgreSQL 16, `production: false`, the smallest there is. No managed cluster, and no JVM service is deployed
against it: it only holds the schema the services will use.

## What a dev database allows (measured 2026-10-14)

| Question | Answer |
|---|---|
| Reachable from a laptop (DBeaver, psql)? | **No.** The connection times out: its firewall admits the app's containers only, and it is not in `doctl databases list`, so the trusted sources cannot be edited. |
| `CREATE SCHEMA` / `CREATE DATABASE` / `CREATE ROLE`? | **Denied** — one database, one user, objects in `public` only. |
| pgvector? | Available (`vector` 0.8.6), `CREATE EXTENSION vector` works for the app user. |
| Where do I get `DATABASE_URL`? | The `web` component binds `DATABASE_URL` and `DATABASE_CA_CERT` (`${orazaka-db.DATABASE_URL}`, `${orazaka-db.CA_CERT}`) — read them in `doctl apps console <app-id> web`, never print them. |

## The schema: initdb, mapped flat

The services have **no Flyway** (`spring.flyway.enabled=false`): each bounded context owns `infra/initdb/NN-*.sql`
(AGENTS.md §5), run in order by `infra/docker-compose.yml` into **six databases with six roles**
(`orazaka_db` for conversation/jobs/governance, plus `krizaka_users_db`, `orazaka_knowledge_db`,
`orazaka_automation_db`, `krizaka_billing_db`, `orazaka_studio_db`). `infra/migrations/` holds the incremental
scripts for an *existing* local database; a fresh database gets the same from the initdb files, so only those run.

A dev database cannot host six databases, nor six schemas. `scripts/dev-db-migrate.sh` therefore applies the eight
files **flat in `public`**: `CREATE ROLE`, `CREATE DATABASE`, `\c` and `SET ROLE` lines are dropped, everything else
runs as written, in one transaction. Result: **65 tables** and the `vector` extension. Reference data is what the
files themselves `INSERT` (plans, price book, models, capabilities, policies…); `00-reset.sql` and
`90-dev-fixtures.sql` (demo users) are never run.

**The compromise, to decide before `--apply`:** six contexts share one namespace. Only `processed_messages` exists in
several (jobs, knowledge, automation, billing, studio — same shape, keyed by `consumer`): they merge into one table.
That breaks the "one context, one database" boundary of the contract (SqlBoundaryRules) for this environment, and no
service can be pointed at it without a `search_path`-less shared view of every table. Alternatives: a second dev
database (another app), or a deployment where each context has its own database.

## Run it

```bash
# dry run: the whole schema in a transaction that is rolled back, then the table count
scripts/dev-db-migrate.sh --app 4f0f45c4-3e6f-4f75-9f47-2b4454ed4ab6

# commit it (all or nothing; a database that already has the tables is refused)
scripts/dev-db-migrate.sh --app 4f0f45c4-3e6f-4f75-9f47-2b4454ed4ab6 --apply
```

`--app` runs `psql` inside the `web` container through `doctl apps console` (the only path to a dev database).
Without `--app` the script uses `DATABASE_URL` (+ optional `DATABASE_CA_CERT_FILE`) from the environment — for any
PostgreSQL you can reach, e.g. the local `orazaka_db`-less Docker one.

## Looking at it from DBeaver

Not possible directly (see above). Cheapest options, no cluster: run queries through `doctl apps console`, or restore
a dump into the local Docker PostgreSQL (`orazaka start`) and browse that.
