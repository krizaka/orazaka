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

test("orazaka-dev serves the operator console on admin.orazaka.com: alias domain, its own session and flag, IP allow-list", () => {
  const text = spec("orazaka-dev");
  assert.match(text, /- domain: dev\.orazaka\.com\n    type: PRIMARY/);
  assert.match(text, /- domain: admin\.orazaka\.com\n    type: ALIAS/);
  // Same `web` component: no component of its own, no extra route, nothing paid.
  assert.deepEqual([...text.matchAll(/^  - name: (\S+)/gm)].map((m) => m[1]).sort(), ["core", "gpu-relay", "web"]);
  // The console's own flag, key and allow-list; the public site's NEXTAUTH_SECRET stays a different placeholder.
  assert.match(text, /AUTH_CONSOLE_LOGIN_ENABLED, scope: RUN_TIME, value: "true"/);
  assert.match(text, /AUTH_CONSOLE_SECRET, scope: RUN_TIME, type: SECRET, value: "__NEXTAUTH_SECRET_ADMIN__"/);
  assert.match(text, /NEXTAUTH_SECRET, scope: RUN_TIME, type: SECRET, value: "__NEXTAUTH_SECRET_WEB__"/);
  assert.match(text, /AUTH_ALLOWED_IPS, scope: RUN_TIME, value: "[0-9., ]+"/);
  assert.match(text, /AUTH_TRUST_HOST, scope: RUN_TIME, value: "true"/);
  // The console's BFF reaches the edge inside the app, not through the public address.
  assert.match(text, /ROUTER_URL, scope: RUN_TIME, value: "http:\/\/core:8088"/);
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

test("the GPU relay allows exactly the broker, the job service and the reverse ports of the Mac and the pods (LocalAI 8085, sd-server 8086, pipeline 8188, Ollama 11434)", () => {
  const entry = readFileSync(new URL("../../infra/deploy/gpu-relay/entrypoint.sh", import.meta.url), "utf8");
  const allowed = [...entry.matchAll(/^\s+"(\^[^"]+)",?$/gm)].map((m) => m[1]);
  assert.deepEqual(allowed, ["^broker-dev\\\\\\\\.orazaka\\\\\\\\.com:5671\\$", "^core:8090\\$", "^R:0\\\\\\\\.0\\\\\\\\.0\\\\\\\\.0:(8085|8086|8188|11434)\\$"]);
  assert.match(entry, /-lt 32/);
  const dockerfile = readFileSync(new URL("../../infra/deploy/gpu-relay/Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /sha256sum -c/);
});

test("the relay exposes LocalAI's port to the app as well as allowing it", () => {
  const spec = readFileSync(new URL("../../infra/deploy/orazaka-dev.app.yaml", import.meta.url), "utf8");
  assert.match(spec, /internal_ports: \[8085, 8086, 8188, 11434\]/);
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
  assert.match(dev, /key: KNOWLEDGE_DB_URL, scope: RUN_TIME, value: "jdbc:postgresql:\/\/__DATABASE_HOST__:25061\/pool-knowledge\?sslmode=require&prepareThreshold=0"/);
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

test("the analytics migration (ADR-081) is idempotent, seeds kinds and settings v1, and has its command", () => {
  const sql = readFileSync(new URL("../../infra/migrations/2026-10-17-analytics.sql", import.meta.url), "utf8");
  for (const statement of sql.match(/CREATE (TABLE|INDEX) [^\n]*/g)) assert.match(statement, /IF NOT EXISTS/, statement);
  assert.match(sql, /CREATE OR REPLACE VIEW analytics_event_all/);
  assert.equal(sql.match(/EXCEPTION WHEN duplicate_object THEN NULL/g).length, 2);
  assert.match(sql, /ON CONFLICT \(tenant_id, kind\) DO NOTHING/);
  assert.match(sql, /ON CONFLICT \(tenant_id, version\) DO NOTHING/);
  const script = readFileSync(new URL("../dev-deploy.mjs", import.meta.url), "utf8");
  assert.match(script, /command === "analytics"\) analytics\(\)/);
});

test("orazaka-dev: outputs go to the private Bunny zone, the key is a SECRET, dev keeps them 30 days", () => {
  const text = spec("orazaka-dev");
  assert.match(text, /MEDIA_STORAGE_PROVIDER, scope: RUN_TIME, value: bunny/);
  assert.match(text, /MEDIA_STORAGE_ZONE, scope: RUN_TIME, value: orazaka-media-dev/);
  assert.match(text, /MEDIA_STORAGE_API_KEY, scope: RUN_TIME, type: SECRET, value: "__MEDIA_STORAGE_API_KEY__"/);
  assert.match(text, /MEDIA_STORAGE_ENDPOINT, scope: RUN_TIME, value: ny\.storage\.bunnycdn\.com/); // the zone's own region host
  assert.match(text, /MEDIA_RETENTION_DAYS, scope: RUN_TIME, value: "30"/);
});

test("connection budget: every JVM of the core goes through its PgBouncer pool (25061, prepareThreshold=0), none direct", () => {
  const dev = spec("orazaka-dev");
  const urls = [...dev.matchAll(/key: (\w+_URL|SPRING_DATASOURCE_URL), scope: RUN_TIME, value: "(jdbc:postgresql:[^"]+)"/g)];
  assert.equal(urls.length, 5, "orazaka_db, users, studio, knowledge, billing");
  for (const [, key, url] of urls) {
    assert.match(url, /:25061\/pool-[a-z]+\?sslmode=require&prepareThreshold=0$/, `${key} must use its pool`);
  }
  assert.doesNotMatch(dev, /__DATABASE_PORT__/, "no direct (25060) datasource left in the core");
});

test("service accounts sit on the `service` rate-limit tier, whose migration is idempotent and moves the existing svc_* users", () => {
  assert.equal(serviceAccount("orochia").tier, "service");
  const sql = readFileSync(new URL("../../infra/migrations/2026-10-20-service-rate-tier.sql", import.meta.url), "utf8");
  assert.match(sql, /VALUES \('service', 1000, 20, FALSE\)\s*ON CONFLICT \(tier_key\) DO NOTHING/);
  assert.match(sql, /UPDATE users SET rate_limit_tier = 'service'\s*WHERE username LIKE 'svc\\_%'/);
  assert.match(readFileSync(new URL("../dev-deploy.mjs", import.meta.url), "utf8"), /command === "service-tier"\) serviceTier\(\)/);
});

test("orazaka-dev: the universal-links settings are declared and empty by default (the web app then serves no AASA / assetlinks)", () => {
  const text = spec("orazaka-dev");
  assert.match(text, /key: APP_IOS_TEAM_ID, scope: RUN_TIME, value: "__APP_IOS_TEAM_ID__"/);
  assert.match(text, /key: APP_ANDROID_CERT_SHA256, scope: RUN_TIME, value: "__APP_ANDROID_CERT_SHA256__"/);
  assert.equal(render('X: "__APP_IOS_TEAM_ID__"', {}), 'X: ""');
});

test("the webhook migration is idempotent, seeds its limits as rows, and has its command", () => {
  const sql = readFileSync(new URL("../../infra/migrations/2026-10-20-studio-webhooks.sql", import.meta.url), "utf8");
  for (const statement of sql.match(/CREATE (TABLE|INDEX) [^\n]*/g)) assert.match(statement, /IF NOT EXISTS/, statement);
  assert.match(sql, /ON CONFLICT \(config_key\) DO NOTHING/);
  for (const key of ["max-attempts", "backoff-seconds", "backoff-cap-seconds", "timeout-seconds", "batch-size"]) assert.match(sql, new RegExp(`webhook\\.${key}`));
  assert.match(readFileSync(new URL("../dev-deploy.mjs", import.meta.url), "utf8"), /command === "webhooks"\) webhooks\(\)/);
});

test("dev-deploy reads its secrets through secret.sh @dev or --env-file, never a hard-coded file of the old layout", () => {
  const source = readFileSync(new URL("../dev-deploy.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, new RegExp(["orazaka", "dev\\.env"].join("-")), "the company folder was restructured on 2026-10-18 (env/dev.env, env/org.env)");
  assert.match(source, /envFileFromArgs\(process\.argv/);
  assert.match(source, /devSecrets\(/);
  const audit = readFileSync(new URL("../audit-studio-forms.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(audit, new RegExp(["orazaka", "dev\\.env"].join("-")));
});
