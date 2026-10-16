// node --test scripts/test — the dev deployment tool: specs are filled, never leaked, accounts are sound.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { connectionVars, grantSql, parseScopes, password, readEnvFile, render, seedSql, serviceAccount, upsertEnv } from "../dev-deploy.mjs";

const spec = (name) => readFileSync(new URL(`../../infra/deploy/${name}.app.yaml`, import.meta.url), "utf8");

test("readEnvFile reads KEY=value lines, skips comments, keeps '=' in values", () => {
  assert.deepEqual(readEnvFile("# c\nA=1\n\nB=x=y\n"), { A: "1", B: "x=y" });
});

test("render fills every placeholder and names the missing ones without values", () => {
  assert.equal(render("a: __X__", { X: "1" }), "a: 1");
  assert.throws(() => render("a: __X__ __Y__", { X: "1" }), /missing in the secrets file: Y$/);
  assert.throws(() => render('a: "__X__"', { X: 'b"' }), /cannot quote/);
});

for (const name of ["orazaka-dev", "orazaka-admin-dev"]) {
  test(`${name}: every secret is a SECRET placeholder and sign-up stays closed`, () => {
    const text = spec(name);
    for (const line of text.split("\n").filter((l) => /type: SECRET/.test(l))) {
      assert.match(line, /value: "__[A-Z0-9_]+__"/, line);
    }
    for (const line of text.split("\n").filter((l) => /(PASSWORD|PASS|SECRET|KEY|SALT)\b/.test(l) && /key:/.test(l))) {
      if (/_USERNAME|_USER\b|DEFAULT_USER/.test(line)) continue;
      assert.match(line, /type: SECRET/, `not a SECRET: ${line}`);
    }
    assert.match(text, /AUTH_SIGNUP_ENABLED, scope: [A-Z_]+, value: "false"/);
    assert.doesNotMatch(text, /AUTH_SIGNUP_ENABLED, scope: [A-Z_]+, value: "true"/);
  });
}

test("orazaka-dev: only the edge, the web and the GPU relay are routed; the broker is reached over TLS in the VPC", () => {
  const text = spec("orazaka-dev");
  const routed = [...text.matchAll(/- component:\n\s+name: (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(routed.sort(), ["core", "gpu-relay", "web"]);
  assert.match(text, /^vpc:\n  id: \S+/m);
  assert.match(text, /RABBITMQ_PORT, scope: RUN_TIME, value: "5671"/);
  assert.match(text, /SPRING_RABBITMQ_SSL_ENABLED, scope: RUN_TIME, value: "true"/);
});

test("broker cloud-init: TLS only, bound to the private address, secrets as placeholders", () => {
  const text = readFileSync(new URL("../../infra/deploy/broker/cloud-init.yaml", import.meta.url), "utf8");
  // cloud-init drops the whole file on a non-ASCII byte ("unacceptable character #x0080").
  assert.match(text, /^[\x00-\x7f]*$/);
  assert.match(text, /listeners\.tcp = none/);
  assert.match(text, /listeners\.ssl\.default = 5671/);
  assert.match(text, /-p \$\{PRIVATE_IP\}:5671:5671/);
  for (const p of ["BROKER_USERS_SCRIPT_B64", "BROKER_CA_PEM_B64", "BROKER_SERVER_PEM_B64", "BROKER_SERVER_KEY_B64"]) {
    assert.match(text, new RegExp(`__${p}__`));
  }
});

test("the GPU relay allows exactly the broker, the job service and the two reverse ports", () => {
  const entry = readFileSync(new URL("../../infra/deploy/gpu-relay/entrypoint.sh", import.meta.url), "utf8");
  const allowed = [...entry.matchAll(/^\s+"(\^[^"]+)",?$/gm)].map((m) => m[1]);
  assert.deepEqual(allowed, ["^broker-dev\\\\\\\\.orazaka\\\\\\\\.com:5671\\$", "^core:8090\\$", "^R:0\\\\\\\\.0\\\\\\\\.0\\\\\\\\.0:(8086|8188|11434)\\$"]);
  assert.match(entry, /-lt 32/);
  const dockerfile = readFileSync(new URL("../../infra/deploy/gpu-relay/Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /sha256sum -c/);
});

test("password: long, mixed, different each time", () => {
  const a = password();
  assert.ok(a.length >= 28 && /[A-Za-z]/.test(a) && /\d/.test(a) && /[^A-Za-z0-9]/.test(a));
  assert.notEqual(a, password());
});

test("seedSql gives the admin ROLE_ADMIN, the user only ROLE_USER, and quotes values", () => {
  const sql = seedSql([
    { username: "qa_user", email: "u@x", hash: "$2y$10$h", tier: "free", roles: ["ROLE_USER"] },
    { username: "o'q", email: "a@x", hash: "$2y$10$k", tier: "admin", roles: ["ROLE_USER", "ROLE_ADMIN"] },
  ]);
  assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\n$/);
  assert.equal((sql.match(/'ROLE_ADMIN'/g) ?? []).length, 1);
  assert.match(sql, /'o''q'/);
  assert.match(sql, /ON CONFLICT \(username\) DO UPDATE/);
});


test("brokerUsersScript: two users, the GPU worker confined to orazaka.* names, guest removed, quoting safe", async () => {
  const { brokerUsersScript, BROKER_PERMISSIONS } = await import("../dev-deploy.mjs");
  const script = brokerUsersScript({ orazaka: "core'pw", "gpu-worker": "gpu-pw" });
  assert.match(script, /delete_user guest/);
  assert.match(script, /add_user 'orazaka' 'core'\\''pw'/);
  assert.match(script, /set_permissions -p \/ 'gpu-worker' '\^orazaka\\\..\*'/);
  const re = new RegExp(BROKER_PERMISSIONS["gpu-worker"]);
  assert.ok(re.test("orazaka.jobs.batch") && !re.test("amq.rabbitmq.log"));
});

test("a product's service account is a plain user named after it, never an admin", () => {
  const a = serviceAccount("yomizaka");
  assert.equal(a.username, "svc_yomizaka");
  assert.equal(a.email, "svc+yomizaka@orazaka.com");
  assert.deepEqual(a.roles, ["ROLE_USER"]);
  assert.throws(() => serviceAccount("Yomizaka; DROP"), /not a product id/);
  assert.throws(() => serviceAccount(undefined), /not a product id/);
});

test("the Studio grants are one row per Studio, with a reason, idempotent, injection-proof", () => {
  const sql = grantSql("550e8400-e29b-41d4-a716-446655440002", ["compliance-check", "document-authenticity"], "yomizaka");
  assert.match(sql, /'studio\.compliance-check'/);
  assert.match(sql, /'studio\.document-authenticity'/);
  assert.match(sql, /yomizaka: a Krizaka product runs this Studio through Orazaka/);
  assert.match(sql, /ON CONFLICT \(actor_id, entitlement_key\) DO UPDATE/);
  assert.throws(() => grantSql("x", ["a'); DROP TABLE x; --"], "p"), /not a Studio key/);
  assert.throws(() => grantSql("x", [], "p"), /no Studio/);
  assert.throws(() => grantSql("", ["a"], "p"), /no actor id/);
});

test("upsertEnv replaces a key in place, appends a new one, keeps the rest", () => {
  assert.equal(upsertEnv("A=1\nAI_API_KEY=old\n", { AI_API_KEY: "new", B: "2" }), "A=1\nAI_API_KEY=new\nB=2\n");
  assert.equal(upsertEnv("", { A: "1" }), "A=1\n");
});

test("serverCertExtensions: what Python's strict verification requires of the broker's leaf", async () => {
  const { serverCertExtensions } = await import("../dev-deploy.mjs");
  const ext = serverCertExtensions("broker-dev.orazaka.com");
  assert.match(ext, /^subjectAltName=DNS:broker-dev\.orazaka\.com$/m);
  assert.match(ext, /^authorityKeyIdentifier=keyid,issuer$/m);
  assert.match(ext, /^subjectKeyIdentifier=hash$/m);
  assert.match(ext, /^basicConstraints=critical,CA:FALSE$/m);
});

test("CA_EXTENSIONS: a CA strict verification accepts (key usage present)", async () => {
  const { CA_EXTENSIONS } = await import("../dev-deploy.mjs");
  assert.ok(CA_EXTENSIONS.includes("keyUsage=critical,keyCertSign,cRLSign"));
  assert.ok(CA_EXTENSIONS.includes("basicConstraints=critical,CA:TRUE"));
});

test("connectionVars: the default pair for Studio callers, AI_<NAME>_URL / _API_KEY for an engine client", () => {
  assert.deepEqual(connectionVars(undefined, "https://e/edge", "oz_k"), { AI_PROVIDER: "orazaka", AI_API_URL: "https://e/edge", AI_API_KEY: "oz_k" });
  assert.deepEqual(connectionVars("AI_ENGINE", "https://e/edge", "oz_k"), { AI_ENGINE_URL: "https://e/edge", AI_ENGINE_API_KEY: "oz_k" });
  assert.throws(() => connectionVars("OROCHIA_AI", "u", "k"), /not an AI_ prefix/);
  assert.throws(() => connectionVars("AI_X; rm", "u", "k"), /not an AI_ prefix/);
});

test("parseScopes: area:action only, none = unscoped", () => {
  assert.deepEqual(parseScopes(undefined), []);
  assert.deepEqual(parseScopes("ai:embed, ai:chat"), ["ai:embed", "ai:chat"]);
  assert.throws(() => parseScopes("embed"), /not a scope/);
  assert.throws(() => parseScopes("AI:embed"), /not a scope/);
  assert.throws(() => parseScopes("*:*"), /not a scope/);
});

test("the core image build cache is busted at every apply: CORE_REBUILD is filled, and the Dockerfile reads it", () => {
  const core = spec("orazaka-dev");
  assert.match(core, /key: CORE_REBUILD, scope: BUILD_TIME, value: "__CORE_REBUILD__"/);
  const filled = render('X: "__CORE_REBUILD__"', {});
  assert.match(filled, /X: "\d{4}-\d{2}-\d{2}T[\d-]+Z"/);
  assert.match(readFileSync(new URL("../../infra/deploy/Dockerfile", import.meta.url), "utf8"), /ARG CORE_REBUILD[\s\S]*\$\{CORE_REBUILD\}/);
});

test("the recommender (ADR-078): knowledge runs in core with its own database, its migration is idempotent", () => {
  const dev = spec("orazaka-dev");
  assert.match(dev, /key: KNOWLEDGE_DB_URL, scope: RUN_TIME, value: "jdbc:postgresql:\/\/__DATABASE_HOST__:__DATABASE_PORT__\/orazaka_knowledge_db\?sslmode=require"/);
  assert.match(dev, /key: KNOWLEDGE_DB_PASSWORD, scope: RUN_TIME, type: SECRET, value: "__DATABASE_PASSWORD_ORAZAKA_KNOWLEDGE_DB__"/);
  const docker = readFileSync(new URL("../../infra/deploy/Dockerfile", import.meta.url), "utf8");
  assert.match(docker, /orazaka-apps\/services\/orazaka-knowledge-service \\/);
  assert.match(docker, /\/out\/knowledge\.jar/);
  const runner = readFileSync(new URL("../../infra/deploy/run-services.sh", import.meta.url), "utf8");
  assert.match(runner, /knowledge:knowledge\.jar:\d+ edge:edge\.jar/, "knowledge starts before the edge");
  const sql = readFileSync(new URL("../../infra/migrations/2026-10-15-recommendations.sql", import.meta.url), "utf8");
  for (const statement of sql.match(/CREATE (TABLE|INDEX) [^\n]*/g)) assert.match(statement, /IF NOT EXISTS/, statement);
  assert.match(sql, /EXCEPTION WHEN duplicate_object THEN NULL/);
  assert.match(sql, /ON CONFLICT \(tenant_id, version\) DO NOTHING/);
});
