import assert from "node:assert/strict";
import test from "node:test";
import { EXCLUDED_DATABASES, bootstrapSql, clearSql, databasesOf, grantsSql, logLine, plan, refusals } from "../lib/dev-reset.mjs";

const DEV = "krizaka-dev-pg-do-user-123456-0.b.db.ondigitalocean.com";
const ok = { product: "orazaka", target: "dev", appEnv: "dev", host: DEV, expectedHost: DEV };

test("the dev cluster's host, APP_ENV=dev and a product: allowed", () => {
  assert.deepEqual(refusals(ok), []);
  assert.deepEqual(refusals({ ...ok, host: `private-${DEV}` }), []);
  assert.deepEqual(refusals({ product: "all", target: "local", appEnv: "local", host: "localhost" }), []);
});

test("a production or commercial host is refused, wherever it appears", () => {
  for (const bad of ["krizaka-prod-pg-do-user-1-0.b.db.ondigitalocean.com", "db.verikora.com", "folioviv.com", "sovkora.com", "kridoc.com"]) {
    assert.match(refusals({ ...ok, host: bad }).join(), /production or commercial/);
  }
  assert.match(refusals({ ...ok, urls: ["https://www.sovkora.com"] }).join(), /production or commercial/);
});

test("a host that is not the dev cluster, or not the one OpenTofu names, is refused", () => {
  assert.match(refusals({ ...ok, host: "other-pg-do-user-1-0.b.db.ondigitalocean.com" }).join(), /not the dev cluster/);
  assert.match(refusals({ ...ok, expectedHost: "krizaka-dev-pg-do-user-999-0.b.db.ondigitalocean.com" }).join(), /OpenTofu/);
  assert.match(refusals({ ...ok, expectedHost: undefined }).join(), /no expected dev host/);
  assert.match(refusals({ ...ok, host: undefined }).join(), /no database host/);
  assert.match(refusals({ ...ok, target: "local", appEnv: "local" }).join(), /local Postgres/);
});

test("APP_ENV must equal the target", () => {
  assert.match(refusals({ ...ok, appEnv: "prod" }).join(), /APP_ENV/);
  assert.match(refusals({ ...ok, appEnv: undefined }).join(), /APP_ENV/);
  assert.match(refusals({ ...ok, target: "prod", appEnv: "prod" }).join(), /target must be local or dev/);
});

test("only the 8 product databases: excluded and foreign ones are refused before connecting", () => {
  for (const db of EXCLUDED_DATABASES) assert.match(refusals({ ...ok, databases: [db] }).join(), /never reset/);
  assert.match(refusals({ ...ok, databases: ["yomizaka_db"] }).join(), /not a database of orazaka/);
  assert.match(refusals({ ...ok, product: "orochia" }).join(), /unknown product/);
  assert.equal(databasesOf("all").length, 8);
  assert.ok(!databasesOf("all").some((d) => EXCLUDED_DATABASES.includes(d)));
});

test("the order: identities, plans, engine, then the apps; each product cleared, deployed, seeded, smoked", () => {
  assert.deepEqual(databasesOf("all"), [
    "krizaka_users_db", "krizaka_billing_db", "orazaka_db", "orazaka_studio_db", "orazaka_knowledge_db", "orazaka_automation_db", "yomizaka_db", "akinaza_db",
  ]);
  assert.deepEqual(plan("akinaza", "dev").map((s) => s.step), ["clear", "deploy", "seed", "smoke"]);
  assert.equal(plan("akinaza", "local")[1].step, "migrate");
});

test("the clear runs as the owner in its own database only, in one transaction, and keeps the database", () => {
  const sql = clearSql("orazaka_db");
  assert.match(sql, /current_database\(\) <> 'orazaka_db' OR current_user <> 'orazaka_db'/);
  assert.match(sql, /BEGIN;[\s\S]*DROP OWNED BY orazaka_db CASCADE;[\s\S]*CREATE SCHEMA IF NOT EXISTS public AUTHORIZATION orazaka_db;[\s\S]*COMMIT;/);
  assert.doesNotMatch(sql, /DROP DATABASE|DROP ROLE|TRUNCATE/);
  assert.throws(() => clearSql("x; DROP DATABASE y"), /not an identifier/);
});

test("extensions and grants come back, idempotent, and the runtime role never gets DDL", () => {
  assert.equal(bootstrapSql("orazaka_db", ["vector", "vector"]).match(/CREATE EXTENSION IF NOT EXISTS vector;/g).length, 1);
  const grants = grantsSql("orazaka_db");
  assert.match(grants, /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'orazaka_db_app'\)/);
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orazaka_db_app/);
  assert.doesNotMatch(grants, /TRUNCATE|CREATE ON|ALL PRIVILEGES/);
});

test("the log line names steps, never a host or a credential", () => {
  const line = logLine({ actor: "a", at: "2026-11-02T00:00:00Z", product: "orazaka", target: "dev", steps: plan("orazaka", "dev"), result: "dry-run" });
  assert.match(line, /orazaka:clear:krizaka_users_db/);
  assert.doesNotMatch(line, /ondigitalocean|password/i);
});
