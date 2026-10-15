import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walk } from "../lib/walk.mjs";

test("walk lists matching files, skips vendored dirs and survives a dangling symlink (.venv)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walk-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "A.java"), "");
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "B.java"), "");
  fs.symlinkSync("/nonexistent/python", path.join(dir, ".venv"));
  fs.symlinkSync("/nonexistent/x", path.join(dir, "dangling"));
  assert.deepEqual(walk(dir, (p) => p.endsWith(".java")), [path.join(dir, "src", "A.java")]);
});
