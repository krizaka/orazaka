#!/usr/bin/env node
/**
 * Orazaka dev deployment (App Platform, project `orazaka`) — docs/DEPLOY_DEV.md.
 *
 *   node scripts/dev-deploy.mjs apply <orazaka-dev|orazaka-admin-dev> [--dry-run] [--drop-attached-db]
 *   node scripts/dev-deploy.mjs data        # infra/deploy/dev-data.sql into orazaka_db (routing is data)
 *   node scripts/dev-deploy.mjs seed        # the two test accounts → company/QA.md, never printed
 *   node scripts/dev-deploy.mjs service-account <product> --studios a,b --out <file>
 *                                           # a product's service account: user, oz_ API key, Studio grants
 *   node scripts/dev-deploy.mjs broker      # the TLS RabbitMQ Droplet in the tor1 VPC (once; idempotent)
 *   node scripts/dev-deploy.mjs status
 *
 * Secrets come from a local file (default ~/Documents/krizaka/orazaka-dev.env, or ORAZAKA_DEV_ENV_FILE),
 * never from the repository, and are never printed: each `__NAME__` of infra/deploy/<app>.app.yaml is
 * filled from it and App Platform stores the SECRET ones encrypted.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  // The key goes in on stdin (\set), never on the command line where `ps` would show it.
  const key = env.AI_INFERENCE_KEY.replace(/'/g, "''");
  psql(env, "orazaka_db", "orazaka_db", "DATABASE_PASSWORD_ORAZAKA_DB", [], `\\set ai_inference_key '${key}'\n${sql}`);
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

// ── Service accounts: a Krizaka product calling Orazaka (products consume AI only through Orazaka) ──
const EDGE_URL = process.env.ORAZAKA_EDGE_URL ?? "https://dev.orazaka.com/edge";

/** The account a product calls Orazaka with: a plain ROLE_USER, never an admin. */
export function serviceAccount(product) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(product ?? "")) throw new Error(`not a product id: ${product}`);
  const id = product.replace(/-/g, "_");
  return { key: product, username: `svc_${id}`, email: `svc+${product}@orazaka.com`, tier: "free", roles: ["ROLE_USER"] };
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
  const { key } = await edge("/api/v1/api-keys", { token, body: { name } });
  if (studios.length) psql(env, "orazaka_studio_db", "orazaka_studio_db", "DATABASE_PASSWORD_ORAZAKA_STUDIO_DB", [], grantSql(actorId, studios, product));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, upsertEnv(existsSync(out) ? readFileSync(out, "utf8") : "", { AI_PROVIDER: "orazaka", AI_API_URL: EDGE_URL, AI_API_KEY: key }), { mode: 0o600 });
  console.log(`${account.username}: API key "${name}" written to ${out} (AI_API_KEY, never printed); granted ${studios.length ? studios.join(", ") : "no Studio"}`);
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
const BROKER_DIR = join(dirname(ENV_FILE), "orazaka-broker");

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

function ensureTls() {
  mkdirSync(BROKER_DIR, { recursive: true, mode: 0o700 });
  const f = (n) => join(BROKER_DIR, n);
  if (existsSync(f("server.pem"))) return;
  const ossl = (args) => execFileSync("openssl", args, { stdio: ["ignore", "ignore", "inherit"] });
  ossl(["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "3650",
    "-subj", "/CN=Orazaka dev broker CA", "-keyout", f("ca.key"), "-out", f("ca.pem")]);
  ossl(["req", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-subj", `/CN=${BROKER.host}`,
    "-keyout", f("server.key"), "-out", f("server.csr")]);
  writeFileSync(f("san.ext"), `subjectAltName=DNS:${BROKER.host}\nextendedKeyUsage=serverAuth\n`);
  ossl(["x509", "-req", "-in", f("server.csr"), "-CA", f("ca.pem"), "-CAkey", f("ca.key"), "-CAcreateserial",
    "-days", "825", "-extfile", f("san.ext"), "-out", f("server.pem")]);
  execFileSync("chmod", ["600", f("ca.key"), f("server.key")]);
}

function ensureEnv(env, key, make) {
  if (env[key]) return env[key];
  const value = make();
  appendFileSync(ENV_FILE, `${key}=${value}\n`);
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

const [command, ...rest] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (command === "apply") apply(rest[0], rest.slice(1));
    else if (command === "data") data();
    else if (command === "seed") seed();
    else if (command === "service-account") await createServiceAccount(rest[0], rest.slice(1));
    else if (command === "broker") broker();
    else if (command === "status") status();
    else {
      console.error("usage: dev-deploy.mjs apply <app> [--dry-run] | data | seed | service-account <product> --studios a,b --out <file> | broker | status");
      process.exit(2);
    }
  } catch (e) {
    console.error(`dev-deploy: ${e.message}`);
    process.exit(1);
  }
}
