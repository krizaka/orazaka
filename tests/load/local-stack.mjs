#!/usr/bin/env node
// A local full stack for the load suite (ADR-083 slice 9): the real users, billing, job, studio and edge services on
// ONE PostgreSQL with max_connections=25 (3 reserved, as the dev cluster) behind PgBouncer pools of the SAME sizes as
// dev (docs/DEV_DATABASE.md, « Connection budget »), and a RabbitMQ — so the database connection ceiling can be found
// here, never on dev. Heavy: take ~/.krizaka-worktrees/tools/heavy-lock.sh first.
//
//   node tests/load/local-stack.mjs up [--workspace <dir>]     # containers, roles, the five JVMs; prints the edge URL
//   node tests/load/local-stack.mjs pools                       # SHOW POOLS of PgBouncer, once
//   node tests/load/local-stack.mjs sample <out.csv> [seconds]  # SHOW POOLS every second into a CSV
//   node tests/load/local-stack.mjs down                        # stops the JVMs, removes the containers
//
// The workspace must be built: ./mvnw package -DskipTests -pl <edge, users, billing, job, studio> -am (the command is
// printed when a jar is missing). Credentials are throwaway values of this stack; nothing here is a secret.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0] ?? "up";
const flag = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const WORKSPACE = path.resolve(flag("workspace", path.join(here, "..", "..")));
const STATE = path.join(os.tmpdir(), "orazaka-load-stack");
const NET = "oraload";
const DB = "oraload-db";
const BOUNCER = "oraload-pgbouncer";
const RABBIT = "oraload-rabbit";
const PORTS = { db: 55432, bouncer: 56432, rabbit: 55672, edge: 8088, users: 8083, billing: 8095, job: 8090, studio: 8096 };
const JWT = "load-stack-identity-jwt-secret-256bit-0123456789abcdef";
const PASSWORD = "load-stack-pw";

/** The pools of docs/DEV_DATABASE.md: the cap on the server side, per service. */
const POOLS = [
  { name: "pool-orazaka", db: "orazaka_db", role: "orazaka_app", password: "orazaka_pass", size: 3 },
  { name: "pool-users", db: "krizaka_users_db", role: "krizaka_users", password: PASSWORD, size: 2 },
  { name: "pool-studio", db: "orazaka_studio_db", role: "orazaka_studio", password: PASSWORD, size: 2 },
  { name: "pool-billing", db: "krizaka_billing_db", role: "krizaka_billing", password: PASSWORD, size: 3 },
];

const docker = (...a) => execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[load-stack] ${m}`);

const JARS = {
  edge: "orazaka-apps/services/orazaka-edge/target/orazaka-edge-1.0.0-SNAPSHOT.jar",
  users: "krizaka/krizaka-users/krizaka-users-service/target/krizaka-users-service-*.jar",
  billing: "krizaka/krizaka-billing/krizaka-billing-service/target/krizaka-billing-service-*.jar",
  job: "orazaka-apps/services/orazaka-job-service/target/orazaka-job-service-1.0.0-SNAPSHOT.jar",
  studio: "orazaka-apps/services/orazaka-studio/orazaka-studio-service/target/orazaka-studio-service-1.0.0-SNAPSHOT.jar",
};
function jar(name) {
  const pattern = path.join(WORKSPACE, JARS[name]);
  const dir = path.dirname(pattern);
  const wanted = path.basename(pattern).replaceAll("*", "");
  const [prefix, suffix] = path.basename(pattern).split("*");
  const found = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(".jar") && (suffix === undefined ? f === wanted : f.startsWith(prefix) && f.endsWith(suffix) && !f.includes("-plain") && !f.includes("sources"))) : null;
  if (!found) {
    throw new Error(
      `${name}: no jar under ${dir}. Build it: ./mvnw package -DskipTests -Dspotless.check.skip=true -Drewrite.skip=true -pl ` +
        Object.values(JARS).map((j) => path.dirname(path.dirname(j))).join(",") + " -am",
    );
  }
  return path.join(dir, found);
}

function initdbFiles() {
  const f = (p) => path.join(WORKSPACE, p);
  return [
    ["00-reset.sql", f("infra/initdb/00-reset.sql")],
    ["10-identity.sql", f("krizaka/krizaka-users/infra/initdb/10-identity.sql")],
    ["20-conversation.sql", f("orazaka-apps/services/orazaka-conversation-service/infra/initdb/20-conversation.sql")],
    ["30-jobs-config.sql", f("orazaka-apps/services/orazaka-job-service/infra/initdb/30-jobs-config.sql")],
    ["40-knowledge.sql", f("orazaka-apps/services/orazaka-knowledge-service/infra/initdb/40-knowledge.sql")],
    ["50-automation.sql", f("orazaka-apps/services/orazaka-automation-service/infra/initdb/50-automation.sql")],
    ["60-governance.sql", f("orazaka-libs/orazaka-ai-engine/infra/initdb/60-governance.sql")],
    ["70-billing.sql", f("krizaka/krizaka-billing/infra/initdb/70-billing.sql")],
    ["80-studio.sql", f("orazaka-apps/services/orazaka-studio/infra/initdb/80-studio.sql")],
    ["90-dev-fixtures.sql", f("infra/initdb/90-dev-fixtures.sql")],
  ].filter(([, p]) => existsSync(p));
}

function pgbouncerIni() {
  const databases = POOLS.map(
    (p) => `${p.name} = host=${DB} port=5432 dbname=${p.db} user=${p.role} password=${p.password} pool_size=${p.size}`,
  ).join("\n");
  return `[databases]
${databases}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = trust
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 400
default_pool_size = 2
min_pool_size = 0
query_wait_timeout = 120
server_idle_timeout = 60
ignore_startup_parameters = extra_float_digits,options
admin_users = admin
stats_users = admin
`;
}

async function up() {
  mkdirSync(STATE, { recursive: true });
  const jars = Object.fromEntries(Object.keys(JARS).map((n) => [n, jar(n)]));
  await down(true);
  try { docker("network", "create", NET); } catch { /* exists */ }

  const mounts = initdbFiles().flatMap(([name, file]) => ["-v", `${file}:/docker-entrypoint-initdb.d/${name}:ro`]);
  log("PostgreSQL (pgvector, max_connections=25, 3 reserved) …");
  docker("run", "-d", "--name", DB, "--network", NET, "-p", `127.0.0.1:${PORTS.db}:5432`, "-e", "POSTGRES_USER=orazaka_app", "-e", "POSTGRES_PASSWORD=orazaka_pass", "-e", "POSTGRES_DB=orazaka_db", ...mounts, "pgvector/pgvector:pg16", "postgres", "-c", "max_connections=25", "-c", "superuser_reserved_connections=3");
  for (let i = 0; i < 120; i++) {
    await sleep(2000);
    try {
      const n = docker("exec", DB, "psql", "-U", "orazaka_app", "-d", "postgres", "-Atc", "select count(*) from pg_database where datname in ('krizaka_users_db','orazaka_studio_db','krizaka_billing_db')").trim();
      if (n === "3") break;
    } catch { /* still initialising */ }
    if (i === 119) throw new Error("PostgreSQL did not finish its bootstrap");
  }
  await sleep(3000);
  for (const p of POOLS.filter((x) => x.role !== "orazaka_app")) {
    docker("exec", DB, "psql", "-U", "orazaka_app", "-d", "postgres", "-c", `ALTER ROLE ${p.role} WITH PASSWORD '${p.password}'`);
  }

  writeFileSync(path.join(STATE, "pgbouncer.ini"), pgbouncerIni());
  // trust still needs every user to be listed (PgBouncer answers "no such user" otherwise)
  writeFileSync(path.join(STATE, "userlist.txt"), [...new Set([...POOLS.map((p) => p.role), "admin"])].map((u) => `"${u}" ""`).join("\n") + "\n");
  log("PgBouncer (transaction mode; pools " + POOLS.map((p) => `${p.name}=${p.size}`).join(", ") + ") …");
  docker("run", "-d", "--name", BOUNCER, "--network", NET, "-p", `127.0.0.1:${PORTS.bouncer}:6432`, "-v", `${path.join(STATE, "pgbouncer.ini")}:/etc/pgbouncer/pgbouncer.ini:ro`, "-v", `${path.join(STATE, "userlist.txt")}:/etc/pgbouncer/userlist.txt:ro`, "edoburu/pgbouncer:latest");
  log("RabbitMQ …");
  docker("run", "-d", "--name", RABBIT, "--network", NET, "-p", `127.0.0.1:${PORTS.rabbit}:5672`, "rabbitmq:3-management-alpine");
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    try { docker("exec", RABBIT, "rabbitmq-diagnostics", "-q", "ping"); break; } catch { /* starting */ }
  }

  // The asset keyring the services read from their home (ADR-054): a throwaway key, mode 0600.
  const home = path.join(STATE, "home");
  mkdirSync(path.join(home, ".orazaka"), { recursive: true });
  const keyFile = path.join(home, ".orazaka", "master.key");
  writeFileSync(keyFile, `# orazaka master keyring v1\nactive = k1\nk1 = ${Buffer.alloc(32, 7).toString("base64")}\n`);
  chmodSync(keyFile, 0o600);

  const jdbc = (pool) => `jdbc:postgresql://127.0.0.1:${PORTS.bouncer}/${pool}?prepareThreshold=0`;
  const common = {
    IDENTITY_JWT_SECRET: JWT, RABBITMQ_HOST: "127.0.0.1", RABBITMQ_PORT: String(PORTS.rabbit), RABBITMQ_USER: "guest", RABBITMQ_PASS: "guest",
    MANAGEMENT_TRACING_SAMPLING_PROBABILITY: "0", TRACING_SAMPLING_PROBABILITY: "0", EVENTS_EXCHANGE: "orazaka.events", DLX_EXCHANGE: "orazaka.dlx",
    CRYPTO_KEY: "load-stack-crypto-key-0123456789abcdef0123", CRYPTO_SALT: "0123456789abcdef" /* 16 hex (docs/DEPLOY_DEV.md): the salt is hex-decoded */, AUTH_SIGNUP_ENABLED: "false",
    EMAIL_VERIFICATION_ENABLED: "false", LOGGING_LEVEL_ORAZAKA: "WARN", BILLING_ENABLED: "true", BILLING_INTERNAL_URL: `http://127.0.0.1:${PORTS.billing}`,
    ORAZAKA_PACKS_SOURCES: path.join(WORKSPACE, "orazaka-packs"), ABUSE_RATE_LIMIT_MODE: "observe", AUTH_API_KEY_DAILY_REQUESTS: "-1",
  };
  const services = [
    ["users", PORTS.users, { IDENTITY_PORT: PORTS.users, IDENTITY_DB_URL: jdbc("pool-users"), IDENTITY_DB_USERNAME: "krizaka_users", IDENTITY_DB_PASSWORD: PASSWORD }],
    ["billing", PORTS.billing, { BILLING_PORT: PORTS.billing, BILLING_DB_URL: jdbc("pool-billing"), BILLING_DB_USERNAME: "krizaka_billing", BILLING_DB_PASSWORD: PASSWORD }],
    ["job", PORTS.job, { SPRING_DATASOURCE_URL: jdbc("pool-orazaka"), SPRING_DATASOURCE_USERNAME: "orazaka_app", SPRING_DATASOURCE_PASSWORD: "orazaka_pass", SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE: "3", SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE: "0" }],
    ["studio", PORTS.studio, { STUDIO_DB_URL: jdbc("pool-studio"), STUDIO_DB_USER: "orazaka_studio", STUDIO_DB_PASSWORD: PASSWORD }],
    ["edge", PORTS.edge, { EDGE_PORT: PORTS.edge, EDGE_MGMT_PORT: 8089, IDENTITY_INTERNAL_URL: `http://127.0.0.1:${PORTS.users}`, STUDIO_INTERNAL_URL: `http://127.0.0.1:${PORTS.studio}`, ROUTER_INTERNAL_URL: `http://127.0.0.1:${PORTS.job}`, BILLING_INTERNAL_URL: `http://127.0.0.1:${PORTS.billing}` }],
  ];
  const pids = {};
  for (const [name, port, env] of services) {
    const out = openSync(path.join(STATE, `${name}.log`), "w");
    const child = spawn("java", ["-Xms64m", "-Xmx256m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-Xss512k", `-Duser.home=${home}`, "-jar", jars[name]], {
      detached: true, stdio: ["ignore", out, out], env: { ...process.env, ...common, ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)])), AUTOMATION_NOTHING: "" },
    });
    child.unref();
    closeSync(out);
    pids[name] = child.pid;
    writeFileSync(path.join(STATE, "pids.json"), JSON.stringify(pids));
    log(`${name} started (pid ${child.pid}, :${port}) …`);
    await sleep(5000);
  }
  for (const [name, port] of services.map(([n, p]) => [n, p])) {
    const url = `http://127.0.0.1:${name === "edge" ? 8089 : port}/actuator/health`;
    let up = false;
    for (let i = 0; i < 90 && !up; i++) {
      up = await fetch(url).then((r) => r.status === 200, () => false);
      if (!up) await sleep(2000);
    }
    if (!up) throw new Error(`${name} did not become healthy (see ${path.join(STATE, `${name}.log`)})`);
    log(`${name} is up`);
  }
  log(`ready: the edge is http://127.0.0.1:${PORTS.edge}  (user@orazaka.com / User1234!)  logs in ${STATE}`);
}

async function down(quiet = false) {
  const pidFile = path.join(STATE, "pids.json");
  if (existsSync(pidFile)) {
    for (const pid of Object.values(JSON.parse(readFileSync(pidFile, "utf8")))) {
      try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
    }
    rmSync(pidFile);
  }
  for (const name of [RABBIT, BOUNCER, DB]) {
    try { docker("rm", "-f", name); } catch { /* absent */ }
  }
  try { docker("network", "rm", NET); } catch { /* absent or in use */ }
  if (!quiet) log("stopped");
}

const SHOW = ["exec", DB, "psql", "-h", BOUNCER, "-p", "6432", "-U", "admin", "pgbouncer", "-At", "-F", ",", "-c", "SHOW POOLS"];
function pools() {
  // columns: database,user,cl_active,cl_waiting,cl_active_cancel_req,cl_waiting_cancel_req,sv_active,sv_active_cancel,sv_being_canceled,sv_idle,sv_used,sv_tested,sv_login,maxwait,maxwait_us,pool_mode
  return docker(...SHOW).trim().split("\n").map((l) => l.split(","));
}

async function sample(out, seconds) {
  writeFileSync(out, "t,pool,cl_active,cl_waiting,sv_active,sv_idle,maxwait_s\n");
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const t = Math.round(Date.now() / 1000);
    try {
      for (const c of pools()) {
        if (c[0] === "pgbouncer") continue;
        appendFileSync(out, [t, c[0], c[2], c[3], c[6], c[9], c[13]].join(",") + "\n");
      }
    } catch { /* the console is busy: skip a second */ }
    await sleep(1000);
  }
}

if (command === "up") await up();
else if (command === "down") await down();
else if (command === "pools") console.log(pools().map((c) => c.slice(0, 15).join(",")).join("\n"));
else if (command === "sample") await sample(args[1] ?? "pools.csv", Number(args[2] ?? 60));
else { console.error("usage: local-stack.mjs up|down|pools|sample"); process.exit(2); }
