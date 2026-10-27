// node --test scripts/test — a merged migration is never left unapplied on dev unseen: the pure rules of the ledger check.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { datedBefore, migrationFiles, pending } from "../dev-migrations.mjs";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "devmig-"));
  for (const [dir, name] of [
    ["infra/migrations", "2026-09-03-a.sql"],
    ["krizaka/krizaka-billing/infra/migrations", "2026-10-26-price-catalogue.sql"],
    ["krizaka/krizaka-billing/infra/migrations", "README.md"],
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, name), "-- x");
  }
  writeFileSync(join(root, "orazaka.workspace.json"), JSON.stringify({ repositories: [{ path: "krizaka/krizaka-billing" }, { path: "not/cloned" }] }));
  return root;
}

test("migration files: the workspace's and each cloned component's .sql, keyed from the root", () => {
  assert.deepEqual(migrationFiles(workspace()), [
    "infra/migrations/2026-09-03-a.sql",
    "krizaka/krizaka-billing/infra/migrations/2026-10-26-price-catalogue.sql",
  ]);
});

test("pending: exactly the files the ledger lacks", () => {
  const files = ["a/1.sql", "a/2.sql", "b/3.sql"];
  assert.deepEqual(pending(files, ["a/1.sql", "gone.sql"]), ["a/2.sql", "b/3.sql"]);
  assert.deepEqual(pending(files, files), []);
});

test("baseline selects the files dated strictly before the day, and never an undated one", () => {
  const files = ["x/infra/migrations/2026-10-25-a.sql", "x/infra/migrations/2026-10-26-b.sql", "x/infra/migrations/notes.sql"];
  assert.deepEqual(datedBefore(files, "2026-10-26"), ["x/infra/migrations/2026-10-25-a.sql"]);
});
