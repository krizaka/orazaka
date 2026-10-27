# The dev database — one PostgreSQL cluster for every Krizaka dev app

`krizaka-dev-pg` (DigitalOcean managed PostgreSQL 16, `db-s-1vcpu-1gb`, one node, Toronto, project `krizaka`) is the
**one** dev cluster (decision 2026-10-14): one database **and one role of the same name** per bounded context —
Orazaka: `orazaka_db`, `krizaka_users_db`, `krizaka_billing_db`, `orazaka_studio_db`, `orazaka_knowledge_db`,
`orazaka_automation_db`; Orochia: `orochia_db`, `orochia_admin_db`. It replaces the App Platform dev databases (which a
laptop could not reach and which forbid `CREATE SCHEMA`). Never a second cluster, never production on it.

Access: **trusted sources** are the dev apps (`orochia-dev`, `orazaka-dev`) and the maintainer's
IP, so `psql` and DBeaver work from there with `sslmode=require` (`verify-full` with the cluster CA). pgvector is
available (`CREATE EXTENSION vector` in `orazaka_knowledge_db`, done).

## The schema: initdb, one file per context, its own database

The services have **no Flyway** (`spring.flyway.enabled=false`): each context owns `infra/initdb/NN-*.sql`
(AGENTS.md §5), applied in the order of `infra/docker-compose.yml` — the same layout as locally. `infra/migrations/`
holds the incremental scripts for an *existing* database; a fresh one gets the same from the initdb files.

| Database | Files | Tables (2026-10-14) |
|---|---|---|
| `krizaka_users_db` | 10-identity | 11 |
| `orazaka_db` | 20-conversation, 30-jobs-config, 60-governance | 21 |
| `orazaka_knowledge_db` | 40-knowledge (+ `vector`) | 2 |
| `orazaka_automation_db` | 50-automation | 3 |
| `krizaka_billing_db` | 70-billing | 17 |
| `orazaka_studio_db` | 80-studio | 15 |

`00-reset.sql` and `90-dev-fixtures.sql` (demo users) never run; the reference data is what the files `INSERT`.

```bash
export DATABASE_HOST=… DATABASE_CA_CERT_FILE=… DATABASE_PASSWORD_ORAZAKA_DB=… # one DATABASE_PASSWORD_<DB> each
scripts/dev-db-migrate.sh            # dry run: every database in a rolled-back transaction, table counts
scripts/dev-db-migrate.sh --apply    # commits (all or nothing per database; a database that has the tables is refused)
scripts/dev-db-migrate.sh --apply --only orazaka_db
```

Passwords live in the maintainer's `CREDENTIALS.local.md`, never in the repository.

## Incremental migrations: the ledger

A merged `infra/migrations/*.sql` (the workspace's and every component repository's) is applied by hand on the dev
cluster, as the database's owner role, after a dry run in a rolled-back transaction. So that none is forgotten,
`dev_migration_ledger` (orazaka_db) records the ones applied:

```bash
node scripts/dev-migrations.mjs check                 # lists the files not recorded; exit 1 if any
node scripts/dev-migrations.mjs record <file>…        # after applying one (path from the workspace root)
node scripts/dev-migrations.mjs baseline --before YYYY-MM-DD   # once: older files are taken as applied
```

`node scripts/dev-deploy.mjs apply orazaka-dev` runs the check and refuses while a file is pending
(`--allow-pending-migrations` to pass). Nothing applies a migration automatically, CI included. Run `node scripts/workspace.mjs clone`
(and pull) first so the component repositories are current.

## Looking at it from DBeaver

New connection → PostgreSQL: host and port of the cluster (25060), the database and its role, SSL tab → *Use SSL*,
mode `verify-full`, root certificate = the cluster CA. Your IP must be a trusted source.

## Connection budget

`max_connections` is 25 on this plan and DigitalOcean keeps 3: **22 usable**, shared by every dev service. The budget is
a ceiling per service (what it may hold at once), kept under 22 with room for a rolling deploy.

| Service | Path | Cap (server side) | Notes |
|---|---|---:|---|
| orazaka-dev core: conversation + job (`orazaka_db`) | `pool-orazaka` (transaction) | 3 | Hikari 3, min idle 0 |
| core: users (`krizaka_users_db`) | `pool-users` | 2 | |
| core: studio | `pool-studio` | 2 | |
| core: knowledge | `pool-knowledge` | 2 | |
| core: automation | `pool-automation` | 1 | no transaction is held across a remote call (ADR-084 §6) |
| core: billing | `pool-billing` | 3 | outbox relay + requests: 1 starved it (`query_wait_timeout`, 2026-10-17) |
| orochia-dev web | direct | 3 | pool 2 + 1 LISTEN (session by nature) |
| yasakia-dev, yomizaka-dev | `pool-yasakia` / `pool-yomizaka` (or direct) | 1 + 1 | `DATABASE_MAX_CONNECTIONS=2`; migrations on `DATABASE_DIRECT_URL` (a deploy-time job) |
| kachizaka-dev, akinaza-dev | `pool-kachizaka`, `pool-akinaza` | 1 + 1 | `DATABASE_MAX_CONNECTIONS=1` |
| accounts, newsletter (next services) | `pool-accounts`, `pool-newsletter` | 1 + 1 | reserved |
| maintainer / `doadmin` | direct | 1 | |
| **Ceiling** | | **22 of 22** | none left: the maintainer's `doadmin` connection is the one a migration uses (accounts/newsletter pools are not counted until they deploy, and cannot until the plan or a pool changes — ADR-083 slice 9) |

Rules: a transaction pool must be at least as large as the service's real concurrent transactions (Hikari holds a connection for a whole transaction, including calls to other services): size 1 starves. JVM services go through a **transaction** pool on port 25061 with `prepareThreshold=0` (Flyway is off, so no
session lock sits behind the pooler); a service that needs `LISTEN`/`NOTIFY` or session state keeps one direct connection,
sized for it. Node apps keep `DATABASE_MAX_CONNECTIONS` ≤ 2 (their idle connections close after 10 s); Orochia and its console use
App Platform's bindable `DATABASE_URL`, which is the direct address. A new service takes its pool before it deploys.

DigitalOcean monitoring has no connection-count metric, so the alarm is a read-only query:

```bash
psql "$URL" -At -F, -c "select usename, count(*) from pg_stat_activity where datname is not null group by 1" \
  | node scripts/db-connections.mjs     # exit 1 above 80 % of the 22 usable
```

## Rotating a role's password

A role is rotated one app at a time: reset it (the `user reset` command of doctl, JSON output captured and never
printed), store the new value at once in the maintainer's env file (`DATABASE_PASSWORD_<ROLE>`), probe it on the
direct port (25060) and the pool port (25061), give it to the app, redeploy, check the app's health and that it
opened sessions with the new role (`pg_stat_activity`). An app with a `databases:` component gets it through
`${db.DATABASE_URL}` (the platform redeploys on a reset); the others hold it in SECRET variables (`DATABASE_URL`
through the pool, `DATABASE_DIRECT_URL` direct, both `?sslmode=require`; the JDBC services a plain `*_PASSWORD`).

The pool and connection listings of doctl print every role's password inside its URI: they are only run with a
`--format` free of Password and URI, or captured into a variable. The session guard (`secret-guard.sh`) refuses
the others, with `--context` in front and with the command aliases.
