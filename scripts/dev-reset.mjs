#!/usr/bin/env node
/**
 * « Reset dev data » in one command (krizaka/.github docs/plans/2026-11-02-db-migration-plan.md § R, krizaka-internal#2255).
 *
 *   node scripts/dev-reset.mjs <orazaka|yomizaka|akinaza|all> --target <local|dev> [--dry-run] [--yes] [--no-deploy] [--log <file>]
 *
 * Per product, in order: clear each of its databases as the owner role (DROP OWNED BY <owner> CASCADE, public schema back),
 * put back doadmin's extensions and the runtime role's grants, redeploy its dev app (its migrations run from V1 before it
 * takes traffic), wait for the deployment, then seed the cast (`tools/seed-dev.sh <product>`) and run the persona smoke.
 * Without --yes it stops after the guards and the read-only preflight (same as --dry-run).
 *
 * Runs on the maintainer's Mac: the dev cluster trusts no GitHub runner (CTO decision 2026-10-28, krizaka/.github#356), so
 * there is no workflow that could reach it. Guards (scripts/lib/dev-reset.mjs, tested): closed list of the 8 product
 * databases, excluded ones refused before connecting, APP_ENV must equal the target, the host must be the dev cluster's
 * (DATABASE_HOST must equal the one from krizaka-infra's non-prod outputs, --expected-host or DEV_RESET_EXPECTED_HOST),
 * any prod or commercial host refused. Secrets through secret.sh @orazaka (DATABASE_HOST, DATABASE_PASSWORD_<DB>,
 * DATABASE_PASSWORD_DOADMIN for the extensions only): never printed. One JSON line per run goes to --log (default
 * ~/.krizaka-private/logs/dev-reset.jsonl).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { devSecrets } from "./lib/dev-secrets.mjs";
import { DEV_APPS, EXTENSIONS, PRODUCT_DATABASES, bootstrapSql, clearSql, extensionsAtRiskSql, grantsSql, logLine, plan, productsOf, refusals } from "./lib/dev-reset.mjs";

const TOOLS = join(homedir(), ".krizaka-worktrees/tools");

function flag(argv, name) {
  return argv.includes(`--${name}`);
}
function option(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
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

/** `sql` on `db` as `role`; the password goes through the environment only, the host never reaches a message. */
function psql({ host, port, password, sslmode }, db, role, sql) {
  const conn = `host=${host} port=${port} dbname=${db} user=${role} sslmode=${sslmode}`;
  const r = spawnSync(psqlBinary(), [conn, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At"], { input: sql, encoding: "utf8", env: { ...process.env, PGPASSWORD: password } });
  if (r.status !== 0) throw new Error(`psql on ${db} as ${role} failed: ${String(r.stderr).replaceAll(host, "<host>").trim()}`);
  return r.stdout.trim();
}

function waitForDeployment(app, log) {
  const id = execFileSync("doctl", ["apps", "list", "--format", "ID,Spec.Name", "--no-header"], { encoding: "utf8" })
    .split("\n").map((l) => l.trim().split(/\s+/)).find(([, name]) => name === app)?.[0];
  if (!id) throw new Error(`no App Platform app ${app}`);
  const dep = JSON.parse(execFileSync("doctl", ["apps", "create-deployment", id, "--force-rebuild", "--output", "json"], { encoding: "utf8" }))[0];
  log(`  ${app}: deployment ${dep.id} started`);
  for (let i = 0; i < 120; i++) {
    spawnSync("sleep", ["15"]);
    const d = JSON.parse(execFileSync("doctl", ["apps", "get-deployment", id, dep.id, "--output", "json"], { encoding: "utf8" }))[0];
    if (d.phase === "ACTIVE") return log(`  ${app}: ACTIVE`);
    if (["ERROR", "CANCELED", "SUPERSEDED"].includes(d.phase)) throw new Error(`${app}: deployment ${dep.id} ended ${d.phase} (the previous release keeps serving)`);
  }
  throw new Error(`${app}: deployment ${dep.id} not active after 30 minutes`);
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${[cmd, ...args].join(" ")} exited ${r.status}`);
}

export async function main(argv = process.argv.slice(2), environ = process.env) {
  const product = argv[0];
  const target = option(argv, "target", "");
  const apply = flag(argv, "yes") && !flag(argv, "dry-run");
  const secrets = devSecrets();
  const local = target === "local";
  const host = local ? (environ.PGHOST ?? "localhost") : secrets.DATABASE_HOST;
  const expectedHost = option(argv, "expected-host", environ.DEV_RESET_EXPECTED_HOST);
  const no = refusals({ product, target, appEnv: environ.APP_ENV, host, expectedHost });
  if (no.length) {
    for (const reason of no) console.error(`dev-reset: refused: ${reason}`);
    return 2;
  }
  const steps = plan(product, target);
  const log = (line) => console.log(line);
  log(`dev-reset ${product} --target ${target}${apply ? "" : " (dry run: guards and read-only preflight only)"}`);
  for (const s of steps) log(`  ${s.product} · ${s.step}${s.db ? ` · ${s.db}` : ""}`);
  const conn = (role) => ({
    host,
    port: local ? (environ.PGPORT ?? "5432") : (secrets.DATABASE_PORT ?? "25060"),
    sslmode: local ? "disable" : "require",
    password: local ? environ.PGPASSWORD : secrets[`DATABASE_PASSWORD_${role.toUpperCase()}`],
  });
  const record = (result) => {
    const file = option(argv, "log", join(homedir(), ".krizaka-private/logs/dev-reset.jsonl"));
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${logLine({ actor: userInfo().username, at: new Date().toISOString(), product, target, steps, result })}\n`);
  };
  try {
    for (const p of productsOf(product)) {
      for (const db of PRODUCT_DATABASES[p]) {
        const atRisk = psql(conn(db), db, db, extensionsAtRiskSql(db));
        log(`  ${db}: preflight ok as its owner${atRisk ? ` (extensions put back after: ${atRisk.split("\n").join(", ")})` : ""}`);
        if (!apply) continue;
        psql(conn(db), db, db, clearSql(db));
        psql(conn("doadmin"), db, "doadmin", bootstrapSql(db, EXTENSIONS[db]));
        psql(conn(db), db, db, grantsSql(db));
        log(`  ${db}: cleared, extensions and grants back`);
      }
      if (!apply) continue;
      if (local) log(`  ${p}: start the stack (docker compose up): the services' migrations run from V1`);
      else if (!flag(argv, "no-deploy")) waitForDeployment(DEV_APPS[p], log);
      if (!local) {
        run(join(TOOLS, "seed-dev.sh"), [p]);
        if (p === "orazaka") run("node", ["scripts/dev-persona-smoke.mjs", "eric"]);
      }
    }
    record(apply ? "done" : "dry-run");
    return 0;
  } catch (e) {
    console.error(`dev-reset: stopped: ${e.message}`);
    record(`stopped: ${e.message}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(await main());
