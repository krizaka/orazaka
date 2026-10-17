# The dev database — one PostgreSQL cluster for every Krizaka dev app

`krizaka-dev-pg` (DigitalOcean managed PostgreSQL 16, `db-s-1vcpu-1gb`, one node, Toronto, project `krizaka`) is the
**one** dev cluster (decision 2026-10-14): one database **and one role of the same name** per bounded context —
Orazaka: `orazaka_db`, `krizaka_users_db`, `krizaka_billing_db`, `orazaka_studio_db`, `orazaka_knowledge_db`,
`orazaka_automation_db`; Orochia: `orochia_db`, `orochia_admin_db`. It replaces the App Platform dev databases (which a
laptop could not reach and which forbid `CREATE SCHEMA`). Never a second cluster, never production on it.

Access: **trusted sources** are the dev apps (`orochia-dev`, `orochia-admin-dev`, `orazaka-dev`) and the maintainer's
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

## Looking at it from DBeaver

New connection → PostgreSQL: host and port of the cluster (25060), the database and its role, SSL tab → *Use SSL*,
mode `verify-full`, root certificate = the cluster CA. Your IP must be a trusted source.

## Connection budget

`max_connections` is 25 on this plan and DigitalOcean keeps 3: **22 usable**, shared by every dev service. The budget is
a ceiling per service (what it may hold at once), kept under 22 with room for a rolling deploy.

| Service | Path | Cap (server side) | Notes |
|---|---|---:|---|
| orazaka-dev core: conversation + job (`orazaka_db`) | `pool-orazaka` (transaction) | 2 | Hikari 3, min idle 0 |
| core: users (`krizaka_users_db`) | `pool-users` | 2 | |
| core: studio | `pool-studio` | 1 | |
| core: knowledge | `pool-knowledge` | 1 | |
| core: billing | `pool-billing` | 1 | |
| orochia-dev web | direct | 3 | pool 2 + 1 LISTEN (session by nature) |
| orochia-admin-dev | direct | 1 | |
| yasakia-dev, yomizaka-dev | `pool-yasakia` / `pool-yomizaka` (or direct) | 1 + 1 | `DATABASE_MAX_CONNECTIONS=2`; migrations on `DATABASE_DIRECT_URL` (a deploy-time job) |
| kachizaka-dev, akinaza-dev | `pool-kachizaka`, `pool-akinaza` | 1 + 1 | `DATABASE_MAX_CONNECTIONS=1` |
| accounts, newsletter (next services) | `pool-accounts`, `pool-newsletter` | 1 + 1 | reserved |
| maintainer / `doadmin` | direct | 1 | |
| **Ceiling** | | **18 of 22** | 4 left for a migrate job during a deploy |

Rules: JVM services go through a **transaction** pool on port 25061 with `prepareThreshold=0` (Flyway is off, so no
session lock sits behind the pooler); a service that needs `LISTEN`/`NOTIFY` or session state keeps one direct connection,
sized for it. Node apps keep `DATABASE_MAX_CONNECTIONS` ≤ 2 (their idle connections close after 10 s); Orochia and its console use
App Platform's bindable `DATABASE_URL`, which is the direct address. A new service takes its pool before it deploys.

DigitalOcean monitoring has no connection-count metric, so the alarm is a read-only query:

```bash
psql "$URL" -At -F, -c "select usename, count(*) from pg_stat_activity where datname is not null group by 1" \
  | node scripts/db-connections.mjs     # exit 1 above 80 % of the 22 usable
```
