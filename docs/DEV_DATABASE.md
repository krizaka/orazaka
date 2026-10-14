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
