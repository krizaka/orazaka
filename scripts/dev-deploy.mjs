#!/usr/bin/env node
/**
 * Orazaka dev deployment (App Platform, project `orazaka`) — docs/DEPLOY_DEV.md.
 *
 *   node scripts/dev-deploy.mjs apply <orazaka-dev|orazaka-admin-dev> [--dry-run] [--drop-attached-db] [--env-file <file>]
 *   node scripts/dev-deploy.mjs data        # infra/deploy/dev-data.sql into orazaka_db (routing is data)
 *   node scripts/dev-deploy.mjs policy      # infra/deploy/dev-content-policy.sql into orazaka_studio_db (docs/CONTENT_POLICY.md)
 *   node scripts/dev-deploy.mjs recommendations  # the recommender's tables on orazaka_knowledge_db (ADR-078)
 *   node scripts/dev-deploy.mjs analytics        # the analytics tables, kinds and settings v1 (ADR-081)
 *   node scripts/dev-deploy.mjs service-tier     # the `service` rate-limit tier, svc_* users moved onto it (ADR-083)
 *   node scripts/dev-deploy.mjs seed        # the two test accounts → company/QA.md, never printed
 *   node scripts/dev-deploy.mjs persona [eric|mira|krizaka]  # a plain user, free tier: Eric/Mira the demo personas, Krizaka the company as an SME customer → @dev APP_QA_ORAZAKA_<NAME>_*, never printed; sign-up stays closed
 *   node scripts/dev-deploy.mjs service-account <product> [--studios a,b] [--scopes ai:embed] [--prefix AI_ENGINE] --out <file>
 *                                           # a product's service account: user, oz_ API key, Studio grants
 *   node scripts/dev-deploy.mjs broker      # the TLS RabbitMQ Droplet in the tor1 VPC (once; idempotent)
 *   node scripts/dev-deploy.mjs status
 *
 * Secrets are read through `~/.krizaka-worktrees/tools/secret.sh @orazaka KEY` (secrets.map: `env/orazaka.env` — the keys that
 * differ for Orazaka, its Bunny zone — then `env/dev.env`, then `env/org.env`), or from one file given with `--env-file ~/Documents/krizaka/env/dev.env` (or ORAZAKA_DEV_ENV_FILE);
 * never from the repository, and never printed: each `__NAME__` of infra/deploy/<app>.app.yaml is filled from them and
 * App Platform stores the SECRET ones encrypted. `--env-file` may sit anywhere on the command line.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { devSecrets, envFileFromArgs, readEnvFile } from "./lib/dev-secrets.mjs";

export { readEnvFile };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOY = join(ROOT, "infra/deploy");
const PROJECT = "orazaka";
const COMPANY_DIR = join(homedir(), "Documents/krizaka");
/** The one secrets file of this run (`--env-file`, ORAZAKA_DEV_ENV_FILE), or null: then every key goes through secret.sh @dev. */
let ENV_FILE = process.env.ORAZAKA_DEV_ENV_FILE || null;
const QA_FILE = process.env.ORAZAKA_QA_FILE ?? join(homedir(), "krizaka-com/company/QA.md");
/** Placeholders that are settings, not secrets, and their defaults. */
/** CORE_REBUILD busts the image build cache of the core component at every apply (see infra/deploy/Dockerfile). */
const DEFAULTS = { CORE_REBUILD: new Date().toISOString().replace(/[:.]/g, "-") };
/** Settings that may be empty: the feature they switch on is then simply off (universal links: no AASA / assetlinks served). */
const OPTIONAL = new Set(["APP_IOS_TEAM_ID", "APP_ANDROID_CERT_SHA256"]);

/** Fills every __NAME__; throws on one the env does not hold (the error names it, never a value). */
export function render(template, env) {
  const missing = new Set();
  const out = template.replace(/__([A-Z0-9_]+)__/g, (_, name) => {
    const value = env[name] ?? DEFAULTS[name];
    if ((value === undefined || value === "") && OPTIONAL.has(name)) return "";
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
  return devSecrets({ envFile: ENV_FILE, overridable: Object.keys(DEFAULTS) });
}

/** Stores a generated secret: appended to the explicit file, else set in `@dev` by env-set.sh (value on the environment, never an argument). */
function storeSecret(key, value) {
  if (ENV_FILE) return appendFileSync(ENV_FILE, `${key}=${value}\n`);
  const r = spawnSync(join(homedir(), ".krizaka-worktrees/tools/env-set.sh"), ["@dev", key], { env: { ...process.env, VALUE: value }, stdio: "ignore" });
  if (r.status !== 0) throw new Error(`could not store ${key} in @dev`);
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
  const inferenceKey = env.AI_INFERENCE_KEY_ALL || env.AI_INFERENCE_KEY; // the all-models key lists the hosted image models too
  if (!inferenceKey) throw new Error("AI_INFERENCE_KEY is not in the secrets file yet");
  const sql = readFileSync(join(DEPLOY, "dev-data.sql"), "utf8");
  // The key goes in on stdin (\set), never on the command line where `ps` would show it.
  const key = inferenceKey.replace(/'/g, "''");
  psql(env, "orazaka_db", "orazaka_db", "DATABASE_PASSWORD_ORAZAKA_DB", [], `\\set ai_inference_key '${key}'\n${sql}`);
  console.log("orazaka_db: dev routing data applied");
}

/** The recommender's tables on orazaka_knowledge_db (ADR-078) — idempotent. */
function recommendations() {
  const env = secrets();
  const sql = readFileSync(join(ROOT, "infra/migrations/2026-10-15-recommendations.sql"), "utf8");
  psql(env, "orazaka_knowledge_db", "orazaka_knowledge_db", "DATABASE_PASSWORD_ORAZAKA_KNOWLEDGE_DB", [], sql);
  console.log("orazaka_knowledge_db: recommendation tables and settings v1 in place");
}

/** The analytics tables, kinds and settings v1 on orazaka_knowledge_db (ADR-081) — idempotent. */
function analytics() {
  const env = secrets();
  const sql = readFileSync(join(ROOT, "infra/migrations/2026-10-17-analytics.sql"), "utf8");
  psql(env, "orazaka_knowledge_db", "orazaka_knowledge_db", "DATABASE_PASSWORD_ORAZAKA_KNOWLEDGE_DB", [], sql);
  console.log("orazaka_knowledge_db: analytics tables, kinds and settings v1 in place");
}

/** The Idempotency-Key columns and index of studio_run (ADR-083) — idempotent, additive, safe before the code ships. */
function runIdempotency() {
  const env = secrets();
  const sql = readFileSync(join(ROOT, "infra/migrations/2026-10-18-studio-run-idempotency.sql"), "utf8");
  psql(env, "orazaka_studio_db", "orazaka_studio_db", "DATABASE_PASSWORD_ORAZAKA_STUDIO_DB", [], sql);
  console.log("orazaka_studio_db: studio_run idempotency columns and index in place");
}

/** The `service` rate-limit tier and the existing svc_* users moved onto it (ADR-083 slice 2) — idempotent. */
function serviceTier() {
  const env = secrets();
  const sql = readFileSync(join(ROOT, "infra/migrations/2026-10-20-service-rate-tier.sql"), "utf8");
  psql(env, "krizaka_users_db", "krizaka_users_db", "DATABASE_PASSWORD_KRIZAKA_USERS_DB", [], sql);
  console.log("krizaka_users_db: tier `service` (1000/min, 20 concurrent) in place; svc_* users moved onto it");
}

/** The signed-webhook tables and limits of the Studio service (orazaka#189 slice B) — idempotent, additive. */
function webhooks() {
  const env = secrets();
  const sql = readFileSync(join(ROOT, "infra/migrations/2026-10-20-studio-webhooks.sql"), "utf8");
  psql(env, "orazaka_studio_db", "orazaka_studio_db", "DATABASE_PASSWORD_ORAZAKA_STUDIO_DB", [], sql);
  console.log("orazaka_studio_db: webhook endpoints, deliveries and limits in place");
}

/** The numbering of run events (orazaka#241): column, log table and triggers on the Studio database — idempotent. */
function runEvents() {
  const env = secrets();
  const sql = readFileSync(join(ROOT, "infra/migrations/2026-10-20-run-events.sql"), "utf8");
  psql(env, "orazaka_studio_db", "orazaka_studio_db", "DATABASE_PASSWORD_ORAZAKA_STUDIO_DB", [], sql);
  console.log("orazaka_studio_db: run event numbering (event_seq, studio_run_event, triggers) in place");
}

/** The automation model, triggers, webhook ledger, cloud runs and rule set v2 on orazaka_automation_db (ADR-084) — idempotent. */
function automations() {
  const env = secrets();
  const sql = readFileSync(join(ROOT, "infra/migrations/2026-10-20-automations.sql"), "utf8");
  psql(env, "orazaka_automation_db", "orazaka_automation_db", "DATABASE_PASSWORD_ORAZAKA_AUTOMATION_DB", [], sql);
  console.log("orazaka_automation_db: automations, triggers, webhook ledger, runs and rule set v2 in place");
}

function policy() {
  const env = secrets();
  const sql = readFileSync(join(DEPLOY, "dev-content-policy.sql"), "utf8");
  psql(env, "orazaka_studio_db", "orazaka_studio_db", "DATABASE_PASSWORD_ORAZAKA_STUDIO_DB", [], sql);
  console.log("orazaka_studio_db: content policy applied (video capability: no adult content, DigitalOcean terms)");
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

/**
 * The demo persona of the dev environment: who signs in for a recording (rule « videos of real use cases »: a named
 * persona, never the QA account on screen). A plain ROLE_USER on the free tier, an e-mail on a reserved domain
 * (RFC 2606, never delivered). Sign-up stays closed: the account is put through the same seed as the QA ones.
 */
export function personaAccount(name = "eric") {
  const personas = {
    eric: { username: "Eric", email: "eric.morel@example.com", secret: "PERSONA" },
    mira: { username: "Mira", email: "mira.tremblay@orazaka.test", secret: "MIRA" },
    // The company itself as a customer (Oussama, 2026-10-22): Krizaka is an SME, it uses Orazaka the way an SME would —
    // a plain user on the free plan, in French — to see its own products from the inside. Not a demo persona, not a
    // service account: the products keep their own svc_<product> keys (one key, one plan, one usage per product).
    krizaka: { username: "Krizaka", email: "orazaka@krizaka.com", secret: "KRIZAKA", language: "fr" },
  };
  const p = personas[name];
  if (!p) throw new Error(`unknown persona: ${name} (eric | mira | krizaka)`);
  return { key: "persona", ...p, tier: "free", roles: ["ROLE_USER"] };
}

export function seedSql(accounts) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const rows = accounts.map(
    (a) =>
      `INSERT INTO users (id, username, password_hash, email, enabled, preferences, rate_limit_tier)
       VALUES (gen_random_uuid()::text, ${q(a.username)}, ${q(a.hash)}, ${q(a.email)}, true, ${q(JSON.stringify({ language: a.language === "fr" ? "fr" : "en" }))}, ${q(a.tier)})
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

/** Eric on dev: created or refreshed (a re-run gives him a new password), the credentials stored in @dev only. */
function seedPersona(name) {
  const env = secrets();
  const persona = personaAccount(name);
  const pw = password();
  psql(env, "krizaka_users_db", "krizaka_users_db", "DATABASE_PASSWORD_KRIZAKA_USERS_DB", [], seedSql([{ ...persona, hash: bcrypt(pw) }]));
  storeSecret(`APP_QA_ORAZAKA_${persona.secret}_EMAIL`, persona.email);
  storeSecret(`APP_QA_ORAZAKA_${persona.secret}_PASSWORD`, pw);
  console.log(`seeded the persona ${persona.username} (${persona.email}) — credentials stored in @dev (APP_QA_ORAZAKA_${persona.secret}_*), never printed`);
}

// ── Service accounts: a Krizaka product calling Orazaka (products consume AI only through Orazaka) ──
const EDGE_URL = process.env.ORAZAKA_EDGE_URL ?? "https://dev.orazaka.com/edge";

/** The account a product calls Orazaka with: a plain ROLE_USER, never an admin, on the `service` rate-limit tier (ADR-083). */
export function serviceAccount(product) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(product ?? "")) throw new Error(`not a product id: ${product}`);
  const id = product.replace(/-/g, "_");
  return { key: product, username: `svc_${id}`, email: `svc+${product}@orazaka.com`, tier: "service", roles: ["ROLE_USER"] };
}

/**
 * The variables a product reads the connection from, by bounded context (`AI_…`): the default is the pair the
 * Studios' callers use (`AI_PROVIDER`, `AI_API_URL`, `AI_API_KEY`); `--prefix AI_ENGINE` names `AI_ENGINE_URL` and
 * `AI_ENGINE_API_KEY` (and no provider line) for a product whose AI client is one engine, not a provider choice.
 */
export function connectionVars(prefix, url, key) {
  if (prefix === undefined) return { AI_PROVIDER: "orazaka", AI_API_URL: url, AI_API_KEY: key };
  if (!/^AI_[A-Z]+$/.test(prefix)) throw new Error(`not an AI_ prefix: ${prefix}`);
  return { [`${prefix}_URL`]: url, [`${prefix}_API_KEY`]: key };
}

/** The scopes a key is held to at the edge (area:action); none = the account's full rights. */
export function parseScopes(raw) {
  const scopes = (raw ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  for (const s of scopes) if (!/^[a-z][a-z0-9-]{0,23}:[a-z][a-z0-9-]{0,23}$/.test(s)) throw new Error(`not a scope (area:action): ${s}`);
  return scopes;
}

/**
 * The operator's grants (studio_entitlement_grant, krizaka/orazaka-studio infra/initdb/80-studio.sql): one row per
 * Studio, with its reason — idempotent, a re-run refreshes the reason and lifts an expiry.
 */
export function grantSql(actorId, studios, product) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  if (!actorId) throw new Error("no actor id");
  if (!studios.length) throw new Error("no Studio to grant");
  for (const s of studios) if (!/^[a-z0-9-]+$/.test(s)) throw new Error(`not a Studio key: ${s}`);
  const reason = `${product}: a Krizaka product runs this Studio through Orazaka (dev, nothing is sold)`;
  const rows = studios.map((s) => `(${q(actorId)}, ${q(`studio.${s}`)}, ${q(reason)}, 'dev-deploy service-account')`);
  return `INSERT INTO studio_entitlement_grant (actor_id, entitlement_key, reason, granted_by) VALUES
${rows.join(",\n")}
ON CONFLICT (actor_id, entitlement_key) DO UPDATE SET reason = EXCLUDED.reason, expires_at = NULL;
`;
}

/**
 * A product's OWN plan (a key is never shared, a plan is never shared): `svc-<product>`, not public, copied from the
 * `ultimate` entitlements plus `retention.none`, with the product's service account subscribed to it. Idempotent.
 */
export function planSql(product, actorId) {
  const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(product)) throw new Error(`not a product id: ${product}`);
  const plan = `svc-${product}`;
  return `BEGIN;
INSERT INTO billing_plan (plan_key, label, tier_rank, monthly_credit_grant, price_cents, currency, rate_limit_tier_key, is_public, is_active)
SELECT ${q(plan)}, ${q(`Service: ${product}`)}, 100, 20000, 0, currency, 'service', FALSE, TRUE FROM billing_plan WHERE plan_key = 'ultimate'
ON CONFLICT (plan_key) DO NOTHING;
INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value)
SELECT ${q(plan)}, entitlement_key, value_type, value FROM billing_plan_entitlement WHERE plan_key = 'ultimate'
ON CONFLICT DO NOTHING;
INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value) VALUES (${q(plan)}, 'retention.none', 'boolean', 'true') ON CONFLICT DO NOTHING;
UPDATE billing_subscription SET status = 'CANCELED', updated_at = now() WHERE actor_id = ${q(actorId)} AND status IN ('TRIALING','ACTIVE','PAST_DUE');
INSERT INTO billing_subscription (actor_id, plan_key, status, period_start, period_end)
VALUES (${q(actorId)}, ${q(plan)}, 'ACTIVE', now(), now() + interval '30 days');
COMMIT;
`;
}

/** Sets KEY=value lines in an env file (kept, created mode 600), without ever printing a value. */
export function upsertEnv(text, values) {
  const lines = text ? text.replace(/\n$/, "").split("\n") : [];
  for (const [key, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n")}\n`;
}

async function edge(path, { token, body, method } = {}) {
  const res = await fetch(`${EDGE_URL}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method ?? (body ? "POST" : "GET")} ${path}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function createServiceAccount(product, flags) {
  const opt = (name) => {
    const i = flags.indexOf(name);
    return i >= 0 ? flags[i + 1] : undefined;
  };
  const studios = (opt("--studios") ?? "").split(",").filter(Boolean);
  const scopes = parseScopes(opt("--scopes"));
  const out = opt("--out");
  if (!out) throw new Error("--out <file> is required: the product's secrets file (the key is written there only)");
  const env = secrets();
  const account = serviceAccount(product);
  const pw = password();
  psql(env, "krizaka_users_db", "krizaka_users_db", "DATABASE_PASSWORD_KRIZAKA_USERS_DB", [], seedSql([{ ...account, hash: bcrypt(pw) }]));
  const actorId = psql(env, "krizaka_users_db", "krizaka_users_db", "DATABASE_PASSWORD_KRIZAKA_USERS_DB",
    ["-t", "-A", "-c", `SELECT id FROM users WHERE username = '${account.username}'`]).trim();
  const { token } = await edge("/api/v1/auth/login", { body: { email: account.email, password: pw } });
  // One live key per product and environment: the previous ones are revoked.
  const name = `${product}-dev`;
  for (const k of await edge("/api/v1/api-keys", { token })) if (k.name === name) await edge(`/api/v1/api-keys/${k.id}`, { token, method: "DELETE" });
  const { key } = await edge("/api/v1/api-keys", { token, body: scopes.length ? { name, scopes } : { name } });
  psql(env, "krizaka_billing_db", "krizaka_billing_db", "DATABASE_PASSWORD_KRIZAKA_BILLING_DB", [], planSql(product, actorId));
  if (studios.length) psql(env, "orazaka_studio_db", "orazaka_studio_db", "DATABASE_PASSWORD_ORAZAKA_STUDIO_DB", [], grantSql(actorId, studios, product));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, upsertEnv(existsSync(out) ? readFileSync(out, "utf8") : "", connectionVars(opt("--prefix"), EDGE_URL, key)), { mode: 0o600 });
  console.log(`${account.username}: API key "${name}" (${scopes.length ? scopes.join(", ") : "unscoped"}) written to ${out} (never printed); granted ${studios.length ? studios.join(", ") : "no Studio"}`);
}

// ── Broker: RabbitMQ on a Droplet in the tor1 VPC, TLS only, VPC-only (cloud firewall) ─────────────
const BROKER = {
  name: "orazaka-broker-dev",
  tag: "orazaka-broker-dev",
  region: "tor1",
  size: "s-1vcpu-512mb-10gb",
  image: "ubuntu-24-04-x64",
  vpc: "default-tor1",
  host: "broker-dev.orazaka.com",
  adminIp: process.env.BROKER_ADMIN_IP ?? "142.122.41.109",
};
const BROKER_DIR = join(COMPANY_DIR, "orazaka-broker");

/** The platform user has everything on `/`; the GPU worker only touches `orazaka.*` names. */
export const BROKER_PERMISSIONS = { orazaka: ".*", "gpu-worker": "^orazaka\\..*" };

/**
 * The one-shot script cloud-init runs once RabbitMQ is up: users through rabbitmqctl (the broker
 * hashes the passwords itself), permissions, no guest. Deleted (shred) after it ran.
 */
export function brokerUsersScript(passwords) {
  const q = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
  const lines = ["set -e", "docker exec rabbitmq rabbitmqctl delete_user guest || true"];
  for (const [user, re] of Object.entries(BROKER_PERMISSIONS)) {
    lines.push(`docker exec rabbitmq rabbitmqctl add_user ${q(user)} ${q(passwords[user])}`);
    lines.push(`docker exec rabbitmq rabbitmqctl set_permissions -p / ${q(user)} ${q(re)} ${q(re)} ${q(re)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The server certificate's extensions. Python ≥ 3.13 verifies strictly (VERIFY_X509_STRICT): a leaf
 * without an Authority Key Identifier is refused ("Missing Authority Key Identifier") — the pack
 * workers could not reach the broker while the JVMs could.
 */
/** The dev CA's extensions — strict verification also wants the CA's key usage. */
export const CA_EXTENSIONS = [
  "basicConstraints=critical,CA:TRUE",
  "keyUsage=critical,keyCertSign,cRLSign",
  "subjectKeyIdentifier=hash",
];

export function serverCertExtensions(host) {
  return [
    `subjectAltName=DNS:${host}`,
    "basicConstraints=critical,CA:FALSE",
    "keyUsage=critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
    "subjectKeyIdentifier=hash",
    "authorityKeyIdentifier=keyid,issuer",
    "",
  ].join("\n");
}

function ensureTls() {
  mkdirSync(BROKER_DIR, { recursive: true, mode: 0o700 });
  const f = (n) => join(BROKER_DIR, n);
  if (existsSync(f("server.pem"))) return;
  const ossl = (args) => execFileSync("openssl", args, { stdio: ["ignore", "ignore", "inherit"] });
  ossl(["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "3650",
    "-subj", "/CN=Orazaka dev broker CA", ...CA_EXTENSIONS.flatMap((e) => ["-addext", e]),
    "-keyout", f("ca.key"), "-out", f("ca.pem")]);
  ossl(["req", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-subj", `/CN=${BROKER.host}`,
    "-keyout", f("server.key"), "-out", f("server.csr")]);
  writeFileSync(f("san.ext"), serverCertExtensions(BROKER.host));
  ossl(["x509", "-req", "-in", f("server.csr"), "-CA", f("ca.pem"), "-CAkey", f("ca.key"), "-CAcreateserial",
    "-days", "825", "-extfile", f("san.ext"), "-out", f("server.pem")]);
  execFileSync("chmod", ["600", f("ca.key"), f("server.key")]);
}

function ensureEnv(env, key, make) {
  if (env[key]) return env[key];
  const value = make();
  storeSecret(key, value);
  env[key] = value;
  return value;
}

function broker() {
  const env = secrets();
  ensureTls();
  const b64 = (n) => readFileSync(join(BROKER_DIR, n)).toString("base64");
  ensureEnv(env, "RABBITMQ_PASS_GPU", () => randomBytes(24).toString("base64url"));
  ensureEnv(env, "RABBITMQ_CA_CERT_BASE64", () => b64("ca.pem"));

  const json = (args) => JSON.parse(doctl([...args, "-o", "json"]) || "[]");
  let droplet = json(["compute", "droplet", "list", "--tag-name", BROKER.tag])[0];
  if (!droplet) {
    const userData = render(readFileSync(join(DEPLOY, "broker/cloud-init.yaml"), "utf8"), {
      BROKER_USERS_SCRIPT_B64: Buffer.from(brokerUsersScript({ orazaka: env.RABBITMQ_PASS, "gpu-worker": env.RABBITMQ_PASS_GPU })).toString("base64"),
      BROKER_CA_PEM_B64: b64("ca.pem"),
      BROKER_SERVER_PEM_B64: b64("server.pem"),
      BROKER_SERVER_KEY_B64: b64("server.key"),
    });
    const tmp = join(BROKER_DIR, "user-data.yaml");
    writeFileSync(tmp, userData, { mode: 0o600 });
    const vpc = json(["vpcs", "list"]).find((v) => v.name === BROKER.vpc);
    const keys = json(["compute", "ssh-key", "list"]).map((k) => String(k.id));
    try {
      doctl(["compute", "droplet", "create", BROKER.name, "--region", BROKER.region, "--size", BROKER.size,
        "--image", BROKER.image, "--vpc-uuid", vpc.id, "--tag-name", BROKER.tag, "--user-data-file", tmp,
        ...(keys.length ? ["--ssh-keys", keys.join(",")] : []), "--wait", "--format", "ID", "--no-header"]);
    } finally {
      writeFileSync(tmp, "");
    }
    droplet = json(["compute", "droplet", "list", "--tag-name", BROKER.tag])[0];
    const project = json(["projects", "list"]).find((p) => p.name === PROJECT);
    doctl(["projects", "resources", "assign", project.id, `--resource=do:droplet:${droplet.id}`]);
  }
  if (!json(["compute", "firewall", "list"]).some((f) => f.name === BROKER.name)) {
    const vpc = json(["vpcs", "list"]).find((v) => v.name === BROKER.vpc);
    doctl(["compute", "firewall", "create", "--name", BROKER.name, "--tag-names", BROKER.tag,
      "--inbound-rules", `protocol:tcp,ports:5671,address:${vpc.ip_range} protocol:tcp,ports:22,address:${BROKER.adminIp}`,
      "--outbound-rules", "protocol:tcp,ports:all,address:0.0.0.0/0 protocol:udp,ports:all,address:0.0.0.0/0 protocol:icmp,address:0.0.0.0/0",
      "--format", "ID", "--no-header"]);
  }
  const privateIp = droplet.networks.v4.find((n) => n.type === "private").ip_address;
  console.log(`broker: ${BROKER.name} (${droplet.id}) private ${privateIp}, TLS :5671, VPC-only`);
  pointDns(BROKER.host.split(".")[0], privateIp);
}

/** orazaka.com is on Porkbun: the maintainer's local helper (DNS_HELPER) upserts the A record. */
function pointDns(name, ip) {
  const helper = process.env.DNS_HELPER ?? join(homedir(), ".krizaka-worktrees/tools/pb.py");
  if (!existsSync(helper)) {
    console.log(`broker: set ${name}.orazaka.com A → ${ip} by hand (no DNS helper)`);
    return;
  }
  const py = `import importlib.util,sys
s=importlib.util.spec_from_file_location("pb",sys.argv[1]);pb=importlib.util.module_from_spec(s);s.loader.exec_module(pb)
pb.call(f"dns/editByNameType/orazaka.com/A/{sys.argv[2]}",{"content":sys.argv[3],"ttl":"600"})
rr=pb.call(f"dns/retrieveByNameType/orazaka.com/A/{sys.argv[2]}")
if not rr.get("records"):
    r=pb.call("dns/create/orazaka.com",{"name":sys.argv[2],"type":"A","content":sys.argv[3],"ttl":"600"})
rr=pb.call(f"dns/retrieveByNameType/orazaka.com/A/{sys.argv[2]}")
print("dns:",[x["content"] for x in rr.get("records",[])])`;
  const r = spawnSync("python3", ["-c", py, helper, name, ip], { encoding: "utf8" });
  console.log(`broker: ${name}.orazaka.com ${r.stdout.trim() || r.stderr.trim().split("\n").pop()}`);
}

function status() {
  for (const name of ["orazaka-dev", "orazaka-admin-dev"]) {
    const id = appId(name);
    console.log(id ? doctl(["apps", "get", id, "--format", "ID,Spec.Name,DefaultIngress,Updated", "--no-header"]).trim() : `${name}: not created`);
  }
}

const { envFile, args: argv } = envFileFromArgs(process.argv.slice(2));
ENV_FILE = envFile;
const [command, ...rest] = argv;
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (command === "apply") apply(rest[0], rest.slice(1));
    else if (command === "data") data();
    else if (command === "policy") policy();
    else if (command === "recommendations") recommendations();
    else if (command === "analytics") analytics();
    else if (command === "run-idempotency") runIdempotency();
    else if (command === "run-events") runEvents();
    else if (command === "service-tier") serviceTier();
    else if (command === "webhooks") webhooks();
    else if (command === "automations") automations();
    else if (command === "seed") seed();
    else if (command === "persona") seedPersona(rest[0]);
    else if (command === "service-account") await createServiceAccount(rest[0], rest.slice(1));
    else if (command === "broker") broker();
    else if (command === "status") status();
    else {
      console.error("usage: dev-deploy.mjs apply <app> [--dry-run] | data | policy | recommendations | analytics | run-idempotency | run-events | service-tier | webhooks | automations | seed | persona | service-account <product> [--studios a,b] [--scopes ai:embed] [--prefix AI_ENGINE] --out <file> | broker | status");
      process.exit(2);
    }
  } catch (e) {
    console.error(`dev-deploy: ${e.message}`);
    process.exit(1);
  }
}
