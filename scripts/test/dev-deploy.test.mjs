// node --test scripts/test — the dev deployment tool: specs are filled, never leaked, accounts are sound.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { password, readEnvFile, render, seedSql } from "../dev-deploy.mjs";

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
