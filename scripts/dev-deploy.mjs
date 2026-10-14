#!/usr/bin/env node
/**
 * Orazaka dev deployment (App Platform, project `orazaka`) — docs/DEPLOY_DEV.md.
 *
 *   node scripts/dev-deploy.mjs apply <orazaka-dev|orazaka-admin-dev> [--dry-run] [--drop-attached-db]
 *   node scripts/dev-deploy.mjs data        # infra/deploy/dev-data.sql into orazaka_db (routing is data)
 *   node scripts/dev-deploy.mjs seed        # the two test accounts → company/QA.md, never printed
 *   node scripts/dev-deploy.mjs status
 *
 * Secrets come from a local file (default ~/Documents/krizaka/orazaka-dev.env, or ORAZAKA_DEV_ENV_FILE),
 * never from the repository, and are never printed: each `__NAME__` of infra/deploy/<app>.app.yaml is
 * filled from it and App Platform stores the SECRET ones encrypted.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOY = join(ROOT, "infra/deploy");
const PROJECT = "orazaka";
const ENV_FILE = process.env.ORAZAKA_DEV_ENV_FILE ?? join(homedir(), "Documents/krizaka/orazaka-dev.env");
const QA_FILE = process.env.ORAZAKA_QA_FILE ?? join(homedir(), "krizaka-com/company/QA.md");
/** Placeholders that are settings, not secrets, and their defaults. */
const DEFAULTS = {};

export function readEnvFile(text) {
  const env = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

/** Fills every __NAME__; throws on one the env does not hold (the error names it, never a value). */
export function render(template, env) {
  const missing = new Set();
  const out = template.replace(/__([A-Z0-9_]+)__/g, (_, name) => {
    const value = env[name] ?? DEFAULTS[name];
    if (value === undefined || value === "") {
      missing.add(name);
      return "";
    }
    if (/["\\\n]/.test(value)) throw new Error(`${name} holds a character the spec cannot quote`);
    return value;
  });
  if (missing.size) throw new Error(`missing in the secrets file: ${[...missing].join(", ")}`);
  return out;
}

function secrets() {
  if (!existsSync(ENV_FILE)) throw new Error(`no secrets file at ${ENV_FILE}`);
  return { ...readEnvFile(readFileSync(ENV_FILE, "utf8")), ...pick(process.env, Object.keys(DEFAULTS)) };
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k]).map((k) => [k, obj[k]]));
}

function doctl(args, input) {
  return execFileSync("doctl", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
}

function appId(name) {
  const apps = JSON.parse(doctl(["apps", "list", "-o", "json"]) || "[]");
  return apps.find((a) => a.spec?.name === name)?.id;
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

function psql(env, db, user, passwordKey, args, input) {
  const conn = `host=${env.DATABASE_HOST} port=${env.DATABASE_PORT} dbname=${db} user=${user} sslmode=require`;
  const r = spawnSync(psqlBinary(), [conn, "-v", "ON_ERROR_STOP=1", "-X", "-q", ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: env[passwordKey] },
  });
  if (r.status !== 0) throw new Error(`psql on ${db} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

function apply(name, flags) {
  const file = join(DEPLOY, `${name}.app.yaml`);
  if (!existsSync(file)) throw new Error(`no spec ${file}`);
  const spec = render(readFileSync(file, "utf8"), secrets());
  doctl(["apps", "spec", "validate", "-", "--schema-only"], spec);
  const id = appId(name);
  if (id && !flags.includes("--drop-attached-db")) {
    const live = doctl(["apps", "spec", "get", id, "--format", "yaml"]);
    if (/^databases:/m.test(live) && !/^databases:/m.test(spec)) {
      throw new Error(
        `${name} still has an attached dev database; applying would delete it. ` +
          "Pass --drop-attached-db once its data is on krizaka-dev-pg.",
      );
    }
  }
  if (flags.includes("--dry-run")) {
    console.log(`${name}: spec valid (${id ? `update ${id}` : "create"}) — dry run, nothing sent`);
    return;
  }
  if (id) {
    doctl(["apps", "update", id, "--spec", "-", "--format", "ID,DefaultIngress", "--no-header"], spec);
    console.log(`${name}: updated ${id} — a deployment starts (watch: doctl apps list-deployments ${id})`);
  } else {
    const out = doctl(["apps", "create", "--spec", "-", "--format", "ID", "--no-header"], spec).trim();
    const project = JSON.parse(doctl(["projects", "list", "-o", "json"])).find((p) => p.name === PROJECT);
    if (project) doctl(["projects", "resources", "assign", project.id, `--resource=do:app:${out}`]);
    console.log(`${name}: created ${out} in project ${PROJECT}`);
  }
}

function data() {
  const env = secrets();
  if (!env.AI_INFERENCE_KEY) throw new Error("AI_INFERENCE_KEY is not in the secrets file yet");
  const sql = readFileSync(join(DEPLOY, "dev-data.sql"), "utf8");
  psql(env, "orazaka_db", "orazaka_db", "DATABASE_PASSWORD_ORAZAKA_DB", ["-v", `ai_inference_key=${env.AI_INFERENCE_KEY}`], sql);
  console.log("orazaka_db: dev routing data applied");
}

/** A password with letters, digits and symbols from 24 random bytes. */
export function password() {
  return randomBytes(24).toString("base64url").slice(0, 28) + "!7a";
}

function bcrypt(secret) {
  const r = spawnSync("htpasswd", ["-niB", "-C", "10", "u"], { input: secret, encoding: "utf8" });
  if (r.status !== 0) throw new Error("htpasswd (apache2-utils) is required for bcrypt");
  return r.stdout.trim().split(":")[1];
}

const ACCOUNTS = [
  { key: "user", username: "qa_user", email: "qa+user@orazaka.com", tier: "free", roles: ["ROLE_USER"] },
  { key: "admin", username: "qa_admin", email: "qa+admin@orazaka.com", tier: "admin", roles: ["ROLE_USER", "ROLE_ADMIN"] },
];

export function seedSql(accounts) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const rows = accounts.map(
    (a) =>
      `INSERT INTO users (id, username, password_hash, email, enabled, preferences, rate_limit_tier)
       VALUES (gen_random_uuid()::text, ${q(a.username)}, ${q(a.hash)}, ${q(a.email)}, true, '{"language":"en"}', ${q(a.tier)})
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, enabled = true,
         email = EXCLUDED.email, rate_limit_tier = EXCLUDED.rate_limit_tier;
       ${a.roles
         .map(
           (r) => `INSERT INTO authorities (user_id, authority_name)
       SELECT id, ${q(r)} FROM users WHERE username = ${q(a.username)} ON CONFLICT ON CONSTRAINT unique_user_authority DO NOTHING;`,
         )
         .join("\n")}`,
  );
  return `BEGIN;\n${rows.join("\n")}\nCOMMIT;\n`;
}

function seed() {
  const env = secrets();
  const accounts = ACCOUNTS.map((a) => {
    const pw = password();
    return { ...a, password: pw, hash: bcrypt(pw) };
  });
  psql(env, "krizaka_users_db", "krizaka_users_db", "DATABASE_PASSWORD_KRIZAKA_USERS_DB", [], seedSql(accounts));
  const [user, admin] = accounts;
  const today = new Date().toISOString().slice(0, 10);
  const block = `### Orazaka (ORA-DEPLOY, ${today})

_Injectés dans \`krizaka_users_db\` (cluster \`krizaka-dev-pg\`) par \`node scripts/dev-deploy.mjs seed\` (krizaka/orazaka) ; relancer la commande = nouveaux mots de passe. Inscription fermée (\`AUTH_SIGNUP_ENABLED=false\`, le backend répond 403)._

**Orazaka web — utilisateur** (ROLE_USER)
- URL : https://dev.orazaka.com/login
- E-mail : \`${user.email}\`
- Mot de passe : \`${user.password}\`

**Orazaka admin** (ROLE_ADMIN)
- URL : https://admin.orazaka.com/login
- E-mail : \`${admin.email}\`
- Mot de passe : \`${admin.password}\`
`;
  let qa = readFileSync(QA_FILE, "utf8");
  const start = qa.indexOf("### Orazaka (ORA-DEPLOY");
  if (start >= 0) {
    const next = qa.slice(start + 1).search(/\n## |\n### /);
    qa = qa.slice(0, start) + block + (next >= 0 ? qa.slice(start + 1 + next) : "");
  } else {
    const anchor = qa.indexOf("\n## ", qa.indexOf("## Comptes de test") + 1);
    qa = anchor >= 0 ? `${qa.slice(0, anchor)}\n${block}${qa.slice(anchor)}` : `${qa}\n${block}`;
  }
  writeFileSync(QA_FILE, qa);
  console.log(`seeded ${accounts.map((a) => a.email).join(", ")} — passwords written to ${QA_FILE} only`);
}

function status() {
  for (const name of ["orazaka-dev", "orazaka-admin-dev"]) {
    const id = appId(name);
    console.log(id ? doctl(["apps", "get", id, "--format", "ID,Spec.Name,DefaultIngress,Updated", "--no-header"]).trim() : `${name}: not created`);
  }
}

const [command, ...rest] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (command === "apply") apply(rest[0], rest.slice(1));
    else if (command === "data") data();
    else if (command === "seed") seed();
    else if (command === "status") status();
    else {
      console.error("usage: dev-deploy.mjs apply <app> [--dry-run] | data | seed | status");
      process.exit(2);
    }
  } catch (e) {
    console.error(`dev-deploy: ${e.message}`);
    process.exit(1);
  }
}
