#!/usr/bin/env node
/**
 * Which merged `infra/migrations/*.sql` are not yet applied on the dev cluster (docs/DEV_DATABASE.md).
 *
 *   node scripts/dev-migrations.mjs check [--root <workspace>] [--env-file <f>]   # exit 1 and list the pending files
 *   node scripts/dev-migrations.mjs record <file> [<file>…] [--on db1,db2]        # after applying one by hand: write it in the ledger
 *   node scripts/dev-migrations.mjs baseline --before YYYY-MM-DD                  # once: files dated before are taken as applied
 *
 * The ledger is one table, `dev_migration_ledger`, in orazaka_db (created on first use, never anything else written).
 * A file is keyed `<path from the workspace root>`, e.g. `krizaka/krizaka-billing/infra/migrations/2026-10-26-price-catalogue.sql`.
 * A file that spans several databases (`\c <db>` lines, e.g. ADR-091's knowledge-access) is recorded once, for all of them:
 * `--on` must name every database it touches (refused otherwise), and the ledger keeps them in its `databases` column.
 * Nothing here ever applies a migration: applying stays a person's act (dry run in a rolled-back transaction, then commit).
 * `dev-deploy.mjs apply` runs the check and refuses to roll out while a file is pending (--allow-pending-migrations to pass).
 * Secrets: DATABASE_HOST, DATABASE_PASSWORD_ORAZAKA_DB through secret.sh @orazaka — never printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { devSecrets, envFileFromArgs } from "./lib/dev-secrets.mjs";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER_DB = "orazaka_db";
const DATE = /^\d{4}-\d{2}-\d{2}-/;

/** Every migration file of the workspace and of its component repositories, keyed by path from the root, sorted. */
export function migrationFiles(root, manifest = JSON.parse(readFileSync(join(root, "orazaka.workspace.json"), "utf8"))) {
  const dirs = ["", ...manifest.repositories.map((r) => r.path)];
  const out = [];
  for (const d of dirs) {
    const rel = join(d, "infra/migrations");
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((n) => n.endsWith(".sql"))) out.push(join(rel, f));
  }
  return out.sort();
}

/** The databases a migration file switches to with `\c <db>` (in order, once each); a file without any belongs to its own database. */
export function databasesOf(sql) {
  const out = [];
  for (const m of sql.matchAll(/^\s*\\c(?:onnect)?\s+(\S+)/gm)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** The databases to write for a file: a multi-database file needs `--on` covering each of them; returns the list to keep. */
export function databasesToRecord(file, sql, on) {
  const needed = databasesOf(sql);
  if (needed.length > 1 && !on.length) throw new Error(`${file} spans ${needed.join(", ")}: record it with --on ${needed.join(",")} once applied on each`);
  const missing = needed.filter((d) => !on.includes(d));
  if (needed.length > 1 && missing.length) throw new Error(`${file} is not recorded: not applied on ${missing.join(", ")} (--on ${on.join(",")})`);
  return on.length ? on : needed;
}

/** The files the ledger does not hold. */
export function pending(files, ledger) {
  const done = new Set(ledger);
  return files.filter((f) => !done.has(f));
}

/** Files dated strictly before `date` (their name starts with YYYY-MM-DD-). */
export function datedBefore(files, date) {
  return files.filter((f) => {
    const m = f.split("/").pop().match(DATE);
    return m && f.split("/").pop().slice(0, 10) < date;
  });
}

function psqlBinary() {
  if (process.env.PSQL) return process.env.PSQL;
  if (spawnSync("psql", ["--version"]).status === 0) return "psql";
  const cellar = "/opt/homebrew/Cellar/libpq";
  if (existsSync(cellar)) {
    const v = readdirSync(cellar).sort().pop();
    if (v) return join(cellar, v, "bin/psql");
  }
  throw new Error("psql not found (set PSQL)");
}

function psql(env, sql) {
  const conn = `host=${env.DATABASE_HOST} port=${env.DATABASE_PORT || 25060} dbname=${LEDGER_DB} user=${LEDGER_DB} sslmode=require`;
  const r = spawnSync(psqlBinary(), [conn, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At"], {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: env.DATABASE_PASSWORD_ORAZAKA_DB },
  });
  if (r.status !== 0) throw new Error(`psql on ${LEDGER_DB} failed: ${r.stderr.replaceAll(env.DATABASE_HOST ?? "\0", "<host>").trim()}`);
  return r.stdout;
}

const ENSURE = "CREATE TABLE IF NOT EXISTS dev_migration_ledger (file TEXT PRIMARY KEY, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now());\nALTER TABLE dev_migration_ledger ADD COLUMN IF NOT EXISTS databases TEXT NOT NULL DEFAULT '';";
const quote = (s) => `'${s.replaceAll("'", "''")}'`;

function ledger(env) {
  return psql(env, `${ENSURE}\nSELECT file FROM dev_migration_ledger;`).split("\n").filter(Boolean);
}

/** @param {string[]|{file: string, databases?: string[]}[]} entries */
function record(env, entries) {
  if (!entries.length) return;
  const rows = entries.map((e) => (typeof e === "string" ? { file: e, databases: [] } : e));
  const values = rows.map((r) => `(${quote(r.file)},${quote((r.databases ?? []).join(","))})`).join(",");
  psql(env, `${ENSURE}\nINSERT INTO dev_migration_ledger (file, databases) VALUES ${values} ON CONFLICT (file) DO UPDATE SET databases = EXCLUDED.databases WHERE EXCLUDED.databases <> '';`);
}

/** The pending files on dev, for a given workspace root. */
export function pendingOnDev(root, env) {
  return pending(migrationFiles(root), ledger(env));
}

function main(argv) {
  let { envFile, args } = envFileFromArgs(argv);
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return null;
    const v = args[i + 1];
    args = [...args.slice(0, i), ...args.slice(i + 2)];
    return v;
  };
  const root = resolve(take("--root") ?? HERE);
  const before = take("--before");
  const on = (take("--on") ?? "").split(",").filter(Boolean);
  const [command = "check", ...rest] = args;
  const env = devSecrets({ envFile });
  if (command === "check") {
    const todo = pendingOnDev(root, env);
    if (!todo.length) return console.log("dev migrations: none pending");
    console.error(`dev migrations: ${todo.length} merged but not recorded as applied on dev:\n${todo.map((f) => `  ${f}`).join("\n")}`);
    console.error("Apply each as its database's owner role (dry run in a rolled-back transaction first, docs/DEV_DATABASE.md), then: node scripts/dev-migrations.mjs record <file>");
    process.exitCode = 1;
  } else if (command === "record") {
    const known = new Set(migrationFiles(root));
    for (const f of rest) if (!known.has(f)) throw new Error(`not a migration of this workspace: ${f}`);
    record(env, rest.map((file) => ({ file, databases: databasesToRecord(file, readFileSync(join(root, file), "utf8"), on) })));
    console.log(`recorded ${rest.length}`);
  } else if (command === "baseline") {
    if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new Error("baseline needs --before YYYY-MM-DD");
    const files = datedBefore(migrationFiles(root), before);
    record(env, files);
    console.log(`baseline: ${files.length} files dated before ${before} recorded as applied`);
  } else {
    console.error("usage: dev-migrations.mjs check | record <file>… [--on db1,db2] | baseline --before YYYY-MM-DD   [--root <workspace>] [--env-file <f>]");
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
