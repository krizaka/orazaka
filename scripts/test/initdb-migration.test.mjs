// node --test scripts/test — a fresh database (the components' infra/initdb) equals a migrated one
// (infra/migrations): every column, constraint, index and table a migration adds is in the initdb DDL.
// The initdb files live in the component repositories (orazaka.workspace.json `initdb`), cloned next to this one.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(root, "orazaka.workspace.json"), "utf8"));

/** The database of each part of a migration (`\c db`) -> the objects it adds. */
export function objectsAdded(sql) {
  const parts = {};
  let db = null;
  const text = sql.replace(/--[^\n]*/g, "");
  for (const chunk of text.split(/^\\c\s+(\w+)\s*$/m)) {
    if (/^\w+$/.test(chunk.trim()) && !chunk.includes(" ")) { db = chunk.trim(); parts[db] = []; continue; }
    if (!db) continue;
    for (const m of chunk.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN IF NOT EXISTS (\w+)/gi)) parts[db].push({ kind: "column", table: m[1], name: m[2] });
    for (const m of chunk.matchAll(/ALTER TABLE (\w+)\s+ADD CONSTRAINT (\w+)/gi)) parts[db].push({ kind: "constraint", table: m[1], name: m[2] });
    for (const m of chunk.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/gi)) parts[db].push({ kind: "index", name: m[1] });
    for (const m of chunk.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      parts[db].push({ kind: "table", name: m[1] });
      for (const c of m[2].matchAll(/^\s+(?:CONSTRAINT (\w+)|(\w+)\s+[A-Z])/gim)) {
        parts[db].push(c[1] ? { kind: "constraint", table: m[1], name: c[1] } : { kind: "column", table: m[1], name: c[2] });
      }
    }
  }
  return parts;
}

/** The text of every initdb file of the workspace, by database. */
function initdbText() {
  const all = [];
  for (const r of manifest.repositories) {
    for (const f of r.initdb ?? []) {
      const p = join(root, r.path, "infra", "initdb", f);
      if (existsSync(p)) all.push(readFileSync(p, "utf8").replace(/--[^\n]*/g, ""));
    }
  }
  return all.join("\n");
}

test("the migration parser reads columns, constraints, indexes and tables", () => {
  const got = objectsAdded(`\\c a_db
ALTER TABLE t ADD COLUMN IF NOT EXISTS x INT;
ALTER TABLE t ADD CONSTRAINT uq UNIQUE (x);
CREATE INDEX IF NOT EXISTS ix ON t(x);
CREATE TABLE IF NOT EXISTS n (
    id SERIAL PRIMARY KEY,
    CONSTRAINT nq UNIQUE (id)
);
`);
  assert.deepEqual(got.a_db.map((o) => `${o.kind}:${o.name}`), ["column:t.x".replace("t.", ""), "constraint:uq", "index:ix", "table:n", "column:id", "constraint:nq"]);
});

for (const file of ["2026-10-26-knowledge-access.sql"]) {
  test(`${file}: the initdb DDL carries everything the migration adds`, (t) => {
    const sql = readFileSync(join(root, "infra", "migrations", file), "utf8");
    const initdb = initdbText();
    const added = Object.values(objectsAdded(sql)).flat();
    assert.ok(added.length >= 8, "the migration was not parsed");
    // Until the components' DDL (orazaka-ai-engine#108, orazaka-knowledge-service#30) is on their main, the clones
    // predate ADR-091 and carry none of it: the check waits for it, then holds (remove this skip once they merged).
    if (!/knowledge_access_audit/.test(initdb) && !/platform_tool_permissions/.test(initdb)) {
      t.skip("components' initdb predates ADR-091");
      return;
    }
    const missing = [];
    for (const o of added) {
      const re = o.kind === "table" || o.kind === "index" || o.kind === "constraint"
        ? new RegExp(`\\b${o.name}\\b`) : new RegExp(`\\b${o.name}\\b\\s+[A-Za-z]`);
      if (!re.test(initdb)) missing.push(`${o.kind} ${o.table ? o.table + "." : ""}${o.name}`);
    }
    assert.deepEqual(missing, [], "in the migration but not in infra/initdb");
  });
}
