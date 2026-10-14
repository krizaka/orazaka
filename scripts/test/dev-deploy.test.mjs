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

test("orazaka-dev: only the edge and the web are routed; the broker stays internal", () => {
  const text = spec("orazaka-dev");
  const routed = [...text.matchAll(/- component:\n\s+name: (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(routed.sort(), ["core", "web"]);
  assert.match(text, /name: rabbitmq[\s\S]*internal_ports: \[5672\]/);
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
